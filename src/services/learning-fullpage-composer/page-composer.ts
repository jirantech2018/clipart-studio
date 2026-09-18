// GPT-Image-2.5 Full-Page Worksheet Composer.
//
// 지시서 §4: GPT-Image 가 전체 페이지의 시각·구성·문항 배치·응답 공간까지
// 직접 결정. 우리는 정확한 문구·이미지 asset·골든 참조·금지 문구를 계약으로
// 전달하고 결과 이미지를 최종 시각 원본으로 사용.

import type { FullPageWorksheetInput, WorksheetPageBrief } from './types';

const DEFAULT_MODEL = 'gpt-image-2.5-sunburst';
const DEFAULT_SIZE = '1024x1536';

export interface ComposeFullPageInput {
  input: FullPageWorksheetInput;
  page: WorksheetPageBrief;
  /** 이전 페이지 결과 이미지 (있으면 style reference 로 첨부). */
  previousPageImage?: Buffer;
  model?: string;
  size?: string;
}

export type ComposeFullPageResult =
  | {
      ok: true;
      imageBytes: Buffer;
      contentType: 'image/png';
      model: string;
      durationMs: number;
      promptUsed: string;
    }
  | {
      ok: false;
      reason: string;
      code: 'HTTP_ERROR' | 'NETWORK_ERROR' | 'EMPTY_RESPONSE';
      model: string;
      durationMs: number;
      promptUsed: string;
    };

function apiKey(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error('OPENAI_API_KEY missing');
  return k;
}
function baseUrl(): string {
  return process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
}

export async function composeFullPageWorksheet(input: ComposeFullPageInput): Promise<ComposeFullPageResult> {
  const model = input.model ?? DEFAULT_MODEL;
  const size = input.size ?? DEFAULT_SIZE;
  const started = Date.now();
  const prompt = buildComposerPrompt(input.input, input.page, Boolean(input.previousPageImage));

  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('n', '1');
  form.append('size', size);

  // 첨부: 골든 참조 + 이 페이지에서 사용할 이미지 asset + 이전 페이지 (스타일 계승).
  for (let i = 0; i < input.input.goldenReferences.length; i += 1) {
    const g = input.input.goldenReferences[i]!;
    const blob = new Blob([new Uint8Array(g.bytes)], { type: g.contentType });
    form.append('image[]', blob, g.filename);
  }
  const assetsThisPage = collectPageAssets(input.input, input.page);
  for (const a of assetsThisPage) {
    const blob = new Blob([new Uint8Array(a.bytes)], { type: a.contentType });
    form.append('image[]', blob, a.filename);
  }
  if (input.previousPageImage) {
    const blob = new Blob([new Uint8Array(input.previousPageImage)], { type: 'image/png' });
    form.append('image[]', blob, 'previous-page-style.png');
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey()}` },
      body: form,
    });
  } catch (err) {
    return { ok: false, reason: `network: ${(err as Error).message}`, code: 'NETWORK_ERROR', model, durationMs: Date.now() - started, promptUsed: prompt };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, reason: `HTTP ${res.status}: ${body.slice(0, 400)}`, code: 'HTTP_ERROR', model, durationMs: Date.now() - started, promptUsed: prompt };
  }
  const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const first = json.data?.[0];
  if (!first) return { ok: false, reason: 'empty', code: 'EMPTY_RESPONSE', model, durationMs: Date.now() - started, promptUsed: prompt };
  let imageBytes: Buffer;
  if (first.b64_json) imageBytes = Buffer.from(first.b64_json, 'base64');
  else if (first.url) {
    const r = await fetch(first.url);
    imageBytes = Buffer.from(await r.arrayBuffer());
  } else return { ok: false, reason: 'missing image data', code: 'EMPTY_RESPONSE', model, durationMs: Date.now() - started, promptUsed: prompt };
  return { ok: true, imageBytes, contentType: 'image/png', model, durationMs: Date.now() - started, promptUsed: prompt };
}

function collectPageAssets(input: FullPageWorksheetInput, page: WorksheetPageBrief) {
  const wanted = new Set<string>();
  for (const b of page.blocks) for (const id of b.imageAssetIds) wanted.add(id);
  return input.visualAssets.filter((a) => wanted.has(a.assetId));
}

function buildComposerPrompt(
  input: FullPageWorksheetInput,
  page: WorksheetPageBrief,
  hasPreviousPage: boolean,
): string {
  const gradeBand = input.grade <= 2 ? '저학년 (큰 글자·넓은 여백·부드러운 대비)' : input.grade <= 4 ? '중학년' : '고학년';
  const exactList = page.exactVisibleTexts
    .map((t) => `  [${t.role}] (${t.id}) "${t.text}"`)
    .join('\n');
  const prohibitedList = page.prohibitedVisibleTexts.length
    ? page.prohibitedVisibleTexts.map((s) => `  - "${s}"`).join('\n')
    : '  (없음)';
  const blockList = page.blocks
    .map((b) => `  - ${b.blockId}: type=${b.activityType}, mode=${b.answerMode}, response=${b.requiredResponseSpace}, images=${b.imageAssetIds.length}`)
    .join('\n');

  return [
    `첨부 골든 샘플과 같은 수준의 A4 세로 초등 학습지 한 페이지 (${input.grade}학년, ${gradeBand}) 를 완성된 형태로 직접 디자인해 그려라.`,
    `이 결과 이미지가 그대로 최종 학생용 PDF 의 시각 원본으로 인쇄된다.`,
    ``,
    `과목/제목/학습 목적:`,
    `  과목: ${input.subject}`,
    `  제목: ${input.title}`,
    `  학습 목적: ${input.learningGoal}`,
    `  이 페이지 목적: ${page.pagePurpose}`,
    `  페이지 번호: ${page.pageNumber} / ${input.pageTarget}`,
    ``,
    `활동 흐름 (순서대로):`,
    page.activityFlow.map((a) => `  - ${a}`).join('\n'),
    ``,
    `블록:`,
    blockList,
    ``,
    `학생이 실제로 볼 정확한 문구 (반드시 이 문자열 그대로 페이지에 인쇄):`,
    exactList,
    ``,
    `학생용에 절대 노출 금지 (문서 어디에도 그려지면 안 됨):`,
    prohibitedList,
    ``,
    `첨부 이미지 사용 규칙:`,
    `  - 골든 참조 PDF 이미지 (파일명 시작이 "golden-") 는 스타일·밀도·시각 위계 참조용. 내용/자음/낱말 복제 금지.`,
    `  - assetId 로 이름 붙은 첨부는 실제 문제 상황 이미지. 반드시 문서에 그 자체로 인쇄. 지운 뒤 다시 그리지 말 것.`,
    hasPreviousPage ? `  - "previous-page-style.png" 는 같은 문서의 앞 페이지. 같은 디자인 시스템 (색·배지·서체·여백) 을 유지.` : '',
    ``,
    `구성 규칙:`,
    `  - 위 exactVisibleTexts 는 반드시 정확한 문자열로 그려라. 한 글자·숫자·기호도 바꾸지 말 것.`,
    `  - exactVisibleTexts 에 없는 새 낱말·문항·정답을 만들지 말 것.`,
    `  - 학생 응답 공간 (쓰기 격자, 답 줄, 선 긋기 앵커, 선택 버튼 등) 을 실제로 그려라. 장식이 아니라 학생이 손으로 사용할 실사용 공간이어야 한다.`,
    `  - 페이지 가장자리 여백을 두고 잘림 방지.`,
    `  - 이미지 · 문항 · 응답 공간이 하나의 활동으로 결합돼 있어야 한다.`,
    `  - 활동 사이 시각 리듬과 시선 흐름이 자연스럽게 이어져야 한다.`,
    `  - 이 문서의 모든 페이지가 하나의 디자인 시스템으로 보이도록.`,
    `  - 인쇄 친화적 색상 (저채도 · 강한 대비 지양).`,
    ``,
    `A4 세로 1024x1536 캔버스에 그려라. 결과는 그대로 인쇄 가능한 완성 학습지 이미지.`,
  ].filter(Boolean).join('\n');
}

// ============================================================
// Edit repair — 오류 영역만 부분 재생성.
// ============================================================
export interface EditPageInput {
  imageBytes: Buffer;
  editInstruction: string;
  model?: string;
  size?: string;
}

export async function editComposedPage(input: EditPageInput): Promise<ComposeFullPageResult> {
  const model = input.model ?? DEFAULT_MODEL;
  const size = input.size ?? DEFAULT_SIZE;
  const started = Date.now();
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', input.editInstruction);
  form.append('n', '1');
  form.append('size', size);
  const blob = new Blob([new Uint8Array(input.imageBytes)], { type: 'image/png' });
  form.append('image[]', blob, 'source.png');

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey()}` },
      body: form,
    });
  } catch (err) {
    return { ok: false, reason: `network: ${(err as Error).message}`, code: 'NETWORK_ERROR', model, durationMs: Date.now() - started, promptUsed: input.editInstruction };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, reason: `HTTP ${res.status}: ${body.slice(0, 400)}`, code: 'HTTP_ERROR', model, durationMs: Date.now() - started, promptUsed: input.editInstruction };
  }
  const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const first = json.data?.[0];
  if (!first) return { ok: false, reason: 'empty', code: 'EMPTY_RESPONSE', model, durationMs: Date.now() - started, promptUsed: input.editInstruction };
  let imageBytes: Buffer;
  if (first.b64_json) imageBytes = Buffer.from(first.b64_json, 'base64');
  else if (first.url) {
    const r = await fetch(first.url);
    imageBytes = Buffer.from(await r.arrayBuffer());
  } else return { ok: false, reason: 'missing image data', code: 'EMPTY_RESPONSE', model, durationMs: Date.now() - started, promptUsed: input.editInstruction };
  return { ok: true, imageBytes, contentType: 'image/png', model, durationMs: Date.now() - started, promptUsed: input.editInstruction };
}
