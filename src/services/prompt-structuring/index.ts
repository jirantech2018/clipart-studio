// 사용자 자연어 프롬프트를 gpt-image-2 가 잘 따르도록 다섯 필드로 구조화한다.
//   keep        - 원본에서 그대로 유지할 요소 (참조 이미지 있을 때 특히 중요)
//   change      - 명시적으로 바꾸고 싶은 부분
//   composition - 구도 지시 ("원본 유지", "정면 클로즈업" 등)
//   style       - 렌더링 톤 ("따뜻한 실사", "파스텔 일러스트" 등)
//   forbid      - 금지 지시 ("자세 변경 금지", "얼굴 변형 금지" 등)
//
// 이 서비스는 gpt-4o-mini 로 한 번의 chat completion 을 돌린다. 배치당 1회만 호출되므로
// 이미지 30장 생성이라도 비용/지연은 사실상 상수. 실패해도 원본 프롬프트를 그대로 반환해
// 이미지 생성은 절대 막지 않는다.

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const MODEL = 'gpt-4o-mini';

export interface StructuredPrompt {
  keep: string[];
  change: string[];
  composition: string;
  style: string;
  forbid: string[];
}

export interface StructureInput {
  prompt: string;
  hasReferenceImage: boolean;
  schoolContext?: string | null;
}

function baseUrl(): string {
  return process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
}

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing');
  return key;
}

function systemPrompt(hasReferenceImage: boolean): string {
  const referenceGuidance = hasReferenceImage
    ? [
        'A user-supplied reference image WILL be attached to the image generation call.',
        'The "keep" list should preserve identifying traits of that reference (pose, facial features,',
        'clothing shape, character identity) unless the user explicitly asked to change them.',
        'The "forbid" list should aggressively call out anything the reference image accidentally',
        'implies changing (e.g. "얼굴 변형 금지", "자세 변경 금지").',
      ].join(' ')
    : [
        'There is NO reference image; this is a pure text-to-image call.',
        'The "keep" list can be empty or hold only the core subject that must appear.',
      ].join(' ');

  return [
    'You are a Korean prompt-structuring assistant for gpt-image-2, an OpenAI image model.',
    'The user gives a short Korean prompt in natural language. Your job is to split it into five fields',
    'that the image model can follow more reliably.',
    '',
    referenceGuidance,
    '',
    'Return valid JSON with EXACTLY these keys, in Korean:',
    '{',
    '  "keep":        string[],  // 유지할 요소 (2~5개, 각 20자 이내)',
    '  "change":      string[],  // 변경할 요소 (0~5개, 각 30자 이내)',
    '  "composition": string,    // 구도 지시 한 문장 (30자 이내)',
    '  "style":       string,    // 스타일 지시 한 문장 (30자 이내)',
    '  "forbid":      string[]   // 금지 지시 (0~4개, 각 20자 이내)',
    '}',
    '',
    'Rules:',
    '- Never invent facts not implied by the prompt. If a field has no relevant content, use [] or "".',
    '- Do not translate to English.',
    '- Do not include punctuation like quotes inside the strings.',
    '- If the user mentions "그대로", "유지", "바꾸지마" style negative instructions, put them in "forbid".',
  ].join('\n');
}

function sanitizeStringList(raw: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed.length > maxLen) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out;
}

function sanitizeString(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed.length > maxLen) return trimmed.slice(0, maxLen);
  return trimmed;
}

/**
 * gpt-4o-mini 를 호출해 프롬프트를 구조화한다. 실패 시 빈 구조체를 반환하므로 caller 는
 * `assembleFinalPrompt` 결과가 원본과 크게 다르지 않은지에 상관없이 항상 계속 진행할 수 있다.
 */
export async function structurePrompt(input: StructureInput): Promise<StructuredPrompt> {
  const empty: StructuredPrompt = {
    keep: [],
    change: [],
    composition: '',
    style: '',
    forbid: [],
  };

  const userMessage = [
    `사용자 프롬프트: ${input.prompt}`,
    input.schoolContext ? `학교 스타일 힌트: ${input.schoolContext}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt(input.hasReferenceImage) },
          { role: 'user', content: userMessage },
        ],
      }),
    });

    if (!res.ok) {
      console.error('[prompt-structuring] upstream', res.status);
      return empty;
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = json.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    return {
      keep: sanitizeStringList(parsed.keep, 5, 20),
      change: sanitizeStringList(parsed.change, 5, 30),
      composition: sanitizeString(parsed.composition, 30),
      style: sanitizeString(parsed.style, 30),
      forbid: sanitizeStringList(parsed.forbid, 4, 20),
    };
  } catch (err) {
    console.error('[prompt-structuring] parse/network', err);
    return empty;
  }
}

/**
 * 구조화된 프롬프트를 gpt-image-2 가 잘 이해하는 형태의 자연어 텍스트로 조립한다.
 * 원본 프롬프트를 맨 앞에 그대로 두어 fallback 정보 손실을 방지한다.
 */
export function assembleFinalPrompt(
  originalPrompt: string,
  structured: StructuredPrompt,
): string {
  const parts: string[] = [originalPrompt.trim()];

  if (structured.keep.length > 0) {
    parts.push(`유지: ${structured.keep.join(', ')}`);
  }
  if (structured.change.length > 0) {
    parts.push(`변경: ${structured.change.join(', ')}`);
  }
  if (structured.composition) {
    parts.push(`구도: ${structured.composition}`);
  }
  if (structured.style) {
    parts.push(`스타일: ${structured.style}`);
  }
  if (structured.forbid.length > 0) {
    parts.push(`금지: ${structured.forbid.join(', ')}`);
  }

  return parts.filter(Boolean).join('\n');
}
