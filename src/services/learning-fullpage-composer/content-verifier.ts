// gpt-4o vision OCR + exactVisibleTexts 대조 → PageContentVerification.
//
// 지시서 §9: 문자열 유사도만으로 통과시키지 않는다. 자모/숫자/수식 1글자
// 차이는 hard failure. 새 텍스트가 등장하면 unexpectedTexts. 정답 문구가
// 학생용에 등장하면 answerLeakage.

import type {
  CharacterIssue,
  ExactVisibleText,
  FullPageWorksheetInput,
  NumberIssue,
  PageContentVerification,
  TextMatchResult,
  WorksheetPageBrief,
} from './types';

const DEFAULT_MODEL = 'gpt-4o';

function apiKey(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error('OPENAI_API_KEY missing');
  return k;
}
function baseUrl(): string {
  return process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
}

export interface VerifyPageInput {
  input: FullPageWorksheetInput;
  page: WorksheetPageBrief;
  imageBytes: Buffer;
  model?: string;
}

export interface VerifyPageResult {
  verification: PageContentVerification;
  ocrDurationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  model: string;
}

export async function verifyPageContent(input: VerifyPageInput): Promise<VerifyPageResult> {
  const model = input.model ?? DEFAULT_MODEL;
  const started = Date.now();

  // gpt-4o vision 에 이미지 OCR 요청 (구조화 응답).
  const dataUrl = `data:image/png;base64,${input.imageBytes.toString('base64')}`;
  const systemMsg = [
    `너는 초등 학습지 이미지를 문자 단위 정확도로 OCR 하는 시각 분석기다.`,
    `이미지에서 보이는 모든 텍스트를 원문 그대로 옮겨라. 자모·숫자·수식·기호를 임의로 정정하지 마라.`,
    `응답은 순수 JSON. 마크다운·설명 금지.`,
  ].join('\n');

  const expectedList = input.page.exactVisibleTexts
    .map((t) => `  ${t.id}: "${t.text}"`)
    .join('\n');
  const prohibitedList = input.page.prohibitedVisibleTexts.length
    ? input.page.prohibitedVisibleTexts.map((s) => `  - "${s}"`).join('\n')
    : '  (없음)';

  const userMsg = [
    `<expected>`,
    expectedList,
    `</expected>`,
    ``,
    `<prohibited>`,
    prohibitedList,
    `</prohibited>`,
    ``,
    `첨부된 학습지 이미지에서 다음 항목을 판정해 JSON 으로 응답:`,
    ``,
    `{`,
    `  "ocrText": "이미지 전체 텍스트 (줄바꿈 유지)",`,
    `  "foundExpected": [{"id":"...","present":true|false,"observed":"실제 관찰된 문자열 (다르면)","approxLocation":"top-left|top-right|middle|bottom|... 자유"}],`,
    `  "unexpectedTexts": ["이미지에 있으나 expected 에 없는 뚜렷한 문구"],`,
    `  "prohibitedFound": ["prohibited 목록 중 이미지에 나타난 문구"],`,
    `  "characterIssues": [{"expected":"자모/수식","observed":"실제","contextExpectedTextId":"..."}],`,
    `  "numberIssues": [{"expected":"12+3","observed":"12+8","contextExpectedTextId":"..."}],`,
    `  "imageMappingIssues": [{"imageAssetId":"...","expectedLabel":"...","observedLabel":"...","detail":"..."}],`,
    `  "responseSpaceIssues": [{"blockId":"...","detail":"쓰기 격자/답 줄/선택 원 등이 실제 사용 가능한 형태로 존재하는가"}]`,
    `}`,
  ].join('\n');

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 3500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemMsg },
          {
            role: 'user',
            content: [
              { type: 'text', text: userMsg },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    return errorVerification(input, `network: ${(err as Error).message}`, started, model);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return errorVerification(input, `HTTP ${res.status}: ${body.slice(0, 200)}`, started, model);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const raw = json.choices?.[0]?.message?.content ?? '';
  if (!raw) return errorVerification(input, 'empty OCR response', started, model);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return errorVerification(input, 'OCR JSON parse fail', started, model); }
  const verification = assembleVerification(input.input, input.page, parsed as Record<string, unknown>);
  return {
    verification,
    ocrDurationMs: Date.now() - started,
    inputTokens: json.usage?.prompt_tokens,
    outputTokens: json.usage?.completion_tokens,
    model,
  };
}

function errorVerification(input: VerifyPageInput, reason: string, started: number, model: string): VerifyPageResult {
  return {
    verification: {
      pageNumber: input.page.pageNumber,
      pass: false,
      ocrText: '',
      exactTextMatches: input.page.exactVisibleTexts.map((t) => ({ id: t.id, expected: t.text, found: false })),
      missingTexts: input.page.exactVisibleTexts.map((t) => t.text),
      unexpectedTexts: [],
      incorrectCharacters: [],
      incorrectNumbers: [],
      incorrectImageMappings: [],
      answerLeakage: [{ detail: 'verification 자체 실패', leakedText: reason }],
      missingResponseSpaces: [],
    },
    ocrDurationMs: Date.now() - started,
    model,
  };
}

function assembleVerification(
  fullInput: FullPageWorksheetInput,
  page: WorksheetPageBrief,
  parsed: Record<string, unknown>,
): PageContentVerification {
  const ocrText = typeof parsed.ocrText === 'string' ? parsed.ocrText : '';
  const foundExpected = Array.isArray(parsed.foundExpected) ? parsed.foundExpected : [];
  const unexpectedTexts = (Array.isArray(parsed.unexpectedTexts) ? parsed.unexpectedTexts : []).filter((s): s is string => typeof s === 'string');
  const prohibitedFound = (Array.isArray(parsed.prohibitedFound) ? parsed.prohibitedFound : []).filter((s): s is string => typeof s === 'string');
  const characterIssues = (Array.isArray(parsed.characterIssues) ? parsed.characterIssues : []) as CharacterIssue[];
  const numberIssues = (Array.isArray(parsed.numberIssues) ? parsed.numberIssues : []) as NumberIssue[];
  const imageMappingIssues = (Array.isArray(parsed.imageMappingIssues) ? parsed.imageMappingIssues : []) as PageContentVerification['incorrectImageMappings'];
  const responseSpaceIssues = (Array.isArray(parsed.responseSpaceIssues) ? parsed.responseSpaceIssues : []) as PageContentVerification['missingResponseSpaces'];

  const idToExpected = new Map<string, ExactVisibleText>();
  for (const t of page.exactVisibleTexts) idToExpected.set(t.id, t);

  const matches: TextMatchResult[] = [];
  const missing: string[] = [];
  const foundIds = new Set<string>();
  for (const fe of foundExpected) {
    if (!fe || typeof fe !== 'object') continue;
    const fo = fe as { id?: string; present?: boolean; observed?: string; approxLocation?: string };
    const expected = idToExpected.get(String(fo.id));
    if (!expected) continue;
    const found = Boolean(fo.present) && (typeof fo.observed !== 'string' || fo.observed === '' || fuzzyEqual(fo.observed, expected.text));
    matches.push({ id: expected.id, expected: expected.text, found, approxLocation: fo.approxLocation });
    if (found) foundIds.add(expected.id);
    else missing.push(expected.text);
  }
  // vision 이 응답에 넣지 않은 expected 도 missing.
  for (const t of page.exactVisibleTexts) {
    if (!matches.find((m) => m.id === t.id)) {
      matches.push({ id: t.id, expected: t.text, found: false });
      missing.push(t.text);
    }
  }

  const answerLeakage = prohibitedFound.map((leakedText) => ({ detail: 'prohibited text 노출', leakedText }));

  const pass =
    missing.length === 0 &&
    characterIssues.length === 0 &&
    numberIssues.length === 0 &&
    answerLeakage.length === 0 &&
    imageMappingIssues.length === 0 &&
    responseSpaceIssues.length === 0;

  void fullInput;
  return {
    pageNumber: page.pageNumber,
    pass,
    ocrText,
    exactTextMatches: matches,
    missingTexts: missing,
    unexpectedTexts,
    incorrectCharacters: characterIssues,
    incorrectNumbers: numberIssues,
    incorrectImageMappings: imageMappingIssues,
    answerLeakage,
    missingResponseSpaces: responseSpaceIssues,
  };
}

function normalize(s: string): string {
  return s.replace(/\s+/g, '').trim();
}

function fuzzyEqual(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

/** Verification 결과에서 문자 단위 오류만 골라 edit 지시문을 만든다. */
export function buildEditInstruction(v: PageContentVerification): string | null {
  const parts: string[] = [];
  if (v.missingTexts.length > 0) {
    parts.push(`다음 문구가 이 페이지에 정확한 문자열로 인쇄되어야 하는데 누락되었다. 각 문구를 원래 있어야 할 자리에 정확한 한글/숫자로 추가하라 (한 글자·기호도 바꾸지 말 것):`);
    for (const t of v.missingTexts.slice(0, 20)) parts.push(`  - "${t}"`);
  }
  if (v.incorrectCharacters.length > 0) {
    parts.push(`잘못 쓰인 문자를 수정하라. 대상 위치의 자모/한글을 지우고 정확한 글자로 교체:`);
    for (const c of v.incorrectCharacters.slice(0, 10)) parts.push(`  - 관찰됨 "${c.observed}" → 정답 "${c.expected}"`);
  }
  if (v.incorrectNumbers.length > 0) {
    parts.push(`잘못 쓰인 숫자/수식을 수정하라. 대상 위치의 숫자를 지우고 정확한 값으로 교체:`);
    for (const n of v.incorrectNumbers.slice(0, 10)) parts.push(`  - 관찰됨 "${n.observed}" → 정답 "${n.expected}"`);
  }
  if (v.answerLeakage.length > 0) {
    parts.push(`학생용에 노출되면 안 되는 정답 문구가 있다. 즉시 삭제하라 (덮어쓰기 아니라 완전 제거):`);
    for (const a of v.answerLeakage.slice(0, 10)) parts.push(`  - "${a.leakedText}"`);
  }
  if (v.unexpectedTexts.length > 0) {
    parts.push(`계약에 없는 새 문구가 그려져 있다. 삭제하라:`);
    for (const u of v.unexpectedTexts.slice(0, 10)) parts.push(`  - "${u}"`);
  }
  if (v.missingResponseSpaces.length > 0) {
    parts.push(`다음 블록의 응답 공간이 부족하거나 없다. 학생이 실제로 손으로 쓰거나 표시할 수 있는 형태로 정확한 위치에 추가하라:`);
    for (const r of v.missingResponseSpaces.slice(0, 5)) parts.push(`  - ${r.blockId}: ${r.detail}`);
  }
  if (parts.length === 0) return null;
  parts.unshift(`이 이미지는 초등 학생용 학습지의 최종 인쇄본이다. 다른 영역·문항·이미지·색상·레이아웃은 절대 바꾸지 말고 아래 수정만 정확히 적용하라.`);
  return parts.join('\n');
}
