// Stage 4.2 §5.1: GPT-Image-2.5 는 페이지 art director 로만 사용.
// reference 이미지에는 실제 문항·정답을 넣지 않고 blockId + 역할 태그만 사용.
// 골든 참조는 스타일 계열의 힌트로만 첨부. 콘텐츠 복제 금지.

import type { CompositionPage } from '@/services/learning-composition';

const DEFAULT_MODEL = 'gpt-image-2.5-sunburst';

export interface GenerateReferenceInput {
  page: CompositionPage;
  goldenReferences: Array<{ bytes: Buffer; label: string }>;
  model?: string;
  size?: string; // 예: '1024x1536'
}

export type GenerateReferenceResult =
  | {
      ok: true;
      imageBytes: Buffer;
      contentType: 'image/png';
      model: string;
      durationMs: number;
    }
  | {
      ok: false;
      reason: string;
      code: 'HTTP_ERROR' | 'EMPTY_RESPONSE' | 'NETWORK_ERROR';
      model: string;
      durationMs: number;
    };

function apiKey(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error('OPENAI_API_KEY missing');
  return k;
}
function baseUrl(): string {
  return process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
}

export async function generateArtDirectorReference(
  input: GenerateReferenceInput,
): Promise<GenerateReferenceResult> {
  const model = input.model ?? DEFAULT_MODEL;
  const size = input.size ?? '1024x1536';
  const started = Date.now();
  const prompt = buildPrompt(input.page);

  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('n', '1');
  form.append('size', size);

  input.goldenReferences.forEach((ref, i) => {
    const blob = new Blob([new Uint8Array(ref.bytes)], { type: 'image/png' });
    form.append('image[]', blob, `golden-${i + 1}.png`);
  });

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey()}` },
      body: form,
    });
  } catch (err) {
    return { ok: false, reason: `network: ${(err as Error).message}`, code: 'NETWORK_ERROR', model, durationMs: Date.now() - started };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, reason: `HTTP ${res.status}: ${body.slice(0, 400)}`, code: 'HTTP_ERROR', model, durationMs: Date.now() - started };
  }
  const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const first = json.data?.[0];
  if (!first) return { ok: false, reason: 'empty', code: 'EMPTY_RESPONSE', model, durationMs: Date.now() - started };
  let imageBytes: Buffer;
  if (first.b64_json) imageBytes = Buffer.from(first.b64_json, 'base64');
  else if (first.url) {
    const r = await fetch(first.url);
    imageBytes = Buffer.from(await r.arrayBuffer());
  } else return { ok: false, reason: 'missing image data', code: 'EMPTY_RESPONSE', model, durationMs: Date.now() - started };
  return { ok: true, imageBytes, contentType: 'image/png', model, durationMs: Date.now() - started };
}

function buildPrompt(page: CompositionPage): string {
  const roles = page.blocks
    .map((b) => {
      const image = b.visualSlot.needed ? '이미지 필요' : '이미지 없음';
      const resp = b.responseSpace.type === 'none' ? '응답 없음' : `응답 ${b.responseSpace.type}`;
      return `  - ${b.blockId}: primitive=${b.primitive}, ${image}, ${resp}`;
    })
    .join('\n');
  return [
    `A4 세로 초등 학습지 페이지의 art direction reference image 를 만들어라.`,
    `이 이미지는 최종 학습지가 아니라 renderer 가 참조할 시각 계약이다.`,
    ``,
    `첨부 골든: 스타일 계열·밀도·시각 위계·이미지-답안 결합·인쇄 친화적 색상만 참조. 콘텐츠 복제 금지.`,
    ``,
    `페이지 목적: ${page.purpose}`,
    `블록 (지시된 blockId 만 노출, 실제 한글 텍스트 금지):`,
    roles,
    ``,
    `요구:`,
    `- 각 블록의 상대적 강조, 이미지 스케일, 응답 공간 크기, 카드 강조, 배지 형태, 색상 역할을 시각적으로 표현.`,
    `- 실제 한글 문항·낱말·자음·수식·정답을 그리지 마라. blockId (예: ${page.blocks[0]?.blockId ?? 'blk_01'}) 또는 역할 태그 (지시문·이미지·응답·자기점검 등) 만 사용.`,
    `- 페이지 전체의 시각 리듬과 자연스러운 시선 흐름을 갖게 한다.`,
    `- 저학년 대상: 여백 넉넉, 큰 배지, 대비 완화.`,
    `- 인쇄 친화적 저채도.`,
  ].join('\n');
}
