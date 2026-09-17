// Stage 4.2 §5.2: Vision 은 reference 이미지에서 좌표를 추출하지 않는다.
// 대신 시각적 시그널(파레트·타이포그래피·배지·카드·이미지 스케일·응답 공간·
// layout intent·장식 수준) 을 enum + token 조합의 PageArtDirection 으로 변환.
//
// 실제 x/y/width/height 는 renderer 가 콘텐츠 크기와 A4 safe area 를 근거로
// 스스로 결정.

import type { CompositionPage } from '@/services/learning-composition';
import { verifyArtDirectionContract } from './contract-validator';
import type { PageArtDirection, DirectionContractReport } from './types';

const DEFAULT_MODEL = 'gpt-4o';

function apiKey(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error('OPENAI_API_KEY missing');
  return k;
}
function baseUrl(): string {
  return process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
}

export interface ExtractDirectionInput {
  page: CompositionPage;
  referenceImageBytes: Buffer;
  styleFamilyHint?: string;
  model?: string;
}

export type ExtractDirectionResult =
  | {
      ok: true;
      direction: PageArtDirection;
      contract: DirectionContractReport;
      durationMs: number;
      inputTokens?: number;
      outputTokens?: number;
      model: string;
    }
  | {
      ok: false;
      reason: string;
      code: 'HTTP_ERROR' | 'PARSE_ERROR' | 'SCHEMA_ERROR' | 'CONTRACT_ERROR' | 'NETWORK_ERROR';
      contract?: DirectionContractReport;
      model: string;
      durationMs: number;
    };

export async function extractArtDirection(input: ExtractDirectionInput): Promise<ExtractDirectionResult> {
  return callExtractOnce(input);
}

/** contract 실패 시 1회 재시도 후 판정. */
export async function extractArtDirectionWithRetry(
  input: ExtractDirectionInput,
): Promise<ExtractDirectionResult> {
  const first = await callExtractOnce(input);
  if (first.ok || first.code !== 'CONTRACT_ERROR') return first;
  const second = await callExtractOnce({ ...input, styleFamilyHint: (input.styleFamilyHint ?? '') + ' (retry)' });
  return second;
}

async function callExtractOnce(input: ExtractDirectionInput): Promise<ExtractDirectionResult> {
  const model = input.model ?? DEFAULT_MODEL;
  const started = Date.now();
  const dataUrl = `data:image/png;base64,${input.referenceImageBytes.toString('base64')}`;

  const validBlockIds = input.page.blocks.map((b) => b.blockId);
  const blockPrimitives = input.page.blocks.map((b) => ({
    blockId: b.blockId,
    primitive: b.primitive,
    visualNeeded: b.visualSlot.needed,
  }));

  const systemMsg = [
    `너는 초등 학습지 페이지 reference image 를 분석해 semantic PageArtDirection JSON 을 반환하는 시각 분석기다.`,
    `절대 좌표·픽셀·퍼센트 위치를 답하지 마라. 대신 시각적 시그널(색상 역할·타이포그래피 위계·배지 형태·카드 강조·이미지 스케일·응답 공간·layout intent·장식 수준) 을 아래 스키마의 enum 및 token 으로 변환한다.`,
    ``,
    `엄격 규칙:`,
    `- blocks[].sourceBlockId 는 반드시 validBlockIds 안에서만 사용 (새 ID 금지, 동일 ID 반복 금지, 모든 valid ID 가 반드시 한 번 등장).`,
    `- 한 blockId 를 instruction/activity 등으로 쪼개지 마라.`,
    `- readingOrder 는 validBlockIds 의 순열.`,
    `- 문항·정답·낱말·수식을 재현하지 마라 (OCR 금지).`,
    `- 좌표/크기/폭/높이/여백을 pixel 이나 percent 로 답하지 마라 — 스키마에 그 필드가 없다.`,
    ``,
    `응답은 순수 JSON. 마크다운·설명 금지.`,
  ].join('\n');

  const userMsg = [
    `<page>`,
    `pageId: ${input.page.pageId}`,
    `blocks: ${JSON.stringify(blockPrimitives)}`,
    `</page>`,
    ``,
    `<validBlockIds>${JSON.stringify(validBlockIds)}</validBlockIds>`,
    ``,
    `첨부 image 는 이 페이지의 layout reference. 다음 스키마로 응답:`,
    ``,
    `{`,
    `  "version": "1.0",`,
    `  "pageId": "${input.page.pageId}",`,
    `  "styleFamily": "<자유 문자열: 예: soft-pastel-rounded, calm-flat, playful-bold 등>",`,
    `  "pageIntent": "stacked|image-left-response-right|image-right-response-left|image-top-response-bottom|balanced-split|activity-grid|hero-then-practice|comparison-pair|sequence-flow",`,
    `  "density": "airy|comfortable|compact",`,
    `  "decorationLevel": "minimal|soft|playful",`,
    `  "readingOrder": ${JSON.stringify(validBlockIds)},`,
    `  "paletteRoles": {`,
    `    "pageBackground": "<hex>", "surface": "<hex>", "surfaceAlt": "<hex>",`,
    `    "primary": "<hex>", "secondary": "<hex>", "accent": "<hex>",`,
    `    "textPrimary": "<hex>", "textSecondary": "<hex>",`,
    `    "answerArea": "<hex>", "border": "<hex>"`,
    `  },`,
    `  "typographyRoles": {`,
    `    "displayScale": "small|medium|large|hero",`,
    `    "instructionScale": "small|medium|large|hero",`,
    `    "bodyScale": "small|medium|large",`,
    `    "weightContrast": "soft|clear|strong"`,
    `  },`,
    `  "shapeRoles": {`,
    `    "radiusScale": "small|medium|large",`,
    `    "badgeStyle": "circle|pill|rounded-square",`,
    `    "borderStyle": "none|soft|clear",`,
    `    "shadowLevel": "none|soft"`,
    `  },`,
    `  "blocks": [`,
    `    { "sourceBlockId": "<validBlockIds[N]>",`,
    `      "layoutIntent": "stacked|image-left-response-right|...",`,
    `      "hierarchy": "low|medium|high|hero",`,
    `      "imageScale": "small|medium|large|hero",`,
    `      "responseSpace": "none|small|medium|large",`,
    `      "cardEmphasis": "none|soft|primary|contrast",`,
    `      "preferredColumns": 1,`,
    `      "imagePosition": "top|left|right|inline",`,
    `      "decorationRole": "none|badge|soft-shape|divider" }`,
    `  ]`,
    `}`,
  ].join('\n');

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 2500,
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
    return { ok: false, reason: `network: ${(err as Error).message}`, code: 'NETWORK_ERROR', model, durationMs: Date.now() - started };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, reason: `HTTP ${res.status}: ${body.slice(0, 400)}`, code: 'HTTP_ERROR', model, durationMs: Date.now() - started };
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const raw = json.choices?.[0]?.message?.content ?? '';
  if (!raw) return { ok: false, reason: 'empty', code: 'PARSE_ERROR', model, durationMs: Date.now() - started };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, reason: 'JSON parse fail', code: 'PARSE_ERROR', model, durationMs: Date.now() - started }; }

  const direction = normalizeArtDirection(parsed, input.page, input.styleFamilyHint);
  if (!direction) {
    return { ok: false, reason: 'schema normalize failed', code: 'SCHEMA_ERROR', model, durationMs: Date.now() - started };
  }
  const contract = verifyArtDirectionContract(direction, input.page);
  if (!contract.pass) {
    return {
      ok: false,
      reason: `contract violation: missing=${contract.missingBlockIds.join(',')} duplicate=${contract.duplicateBlockIds.join(',')} unknown=${contract.unknownBlockIds.join(',')}`,
      code: 'CONTRACT_ERROR',
      contract,
      model,
      durationMs: Date.now() - started,
    };
  }
  return {
    ok: true,
    direction,
    contract,
    durationMs: Date.now() - started,
    inputTokens: json.usage?.prompt_tokens,
    outputTokens: json.usage?.completion_tokens,
    model,
  };
}

const LAYOUT_INTENTS: PageArtDirection['pageIntent'][] = [
  'stacked', 'image-left-response-right', 'image-right-response-left',
  'image-top-response-bottom', 'balanced-split', 'activity-grid',
  'hero-then-practice', 'comparison-pair', 'sequence-flow',
];

function enumOr<T extends string>(v: unknown, allowed: readonly T[], fb: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fb;
}

function str(v: unknown, fb = ''): string {
  return typeof v === 'string' ? v : fb;
}

function normalizeArtDirection(
  raw: unknown,
  page: CompositionPage,
  styleFamilyHint?: string,
): PageArtDirection | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const paletteRaw = (r.paletteRoles ?? {}) as Record<string, unknown>;
  const typoRaw = (r.typographyRoles ?? {}) as Record<string, unknown>;
  const shapeRaw = (r.shapeRoles ?? {}) as Record<string, unknown>;
  const readingOrderRaw = Array.isArray(r.readingOrder) ? r.readingOrder : [];
  const blocksRaw = Array.isArray(r.blocks) ? r.blocks : [];

  const validIds = new Set(page.blocks.map((b) => b.blockId));
  const readingOrder = readingOrderRaw
    .filter((x): x is string => typeof x === 'string')
    .filter((x) => validIds.has(x));
  // reading order 가 부족하면 composition 순서로 채운다 (contract 는 별도로 판정).
  for (const id of page.blocks.map((b) => b.blockId)) {
    if (!readingOrder.includes(id)) readingOrder.push(id);
  }

  const blocks = blocksRaw
    .filter((b): b is Record<string, unknown> => b !== null && typeof b === 'object')
    .map((b) => ({
      sourceBlockId: str(b.sourceBlockId),
      layoutIntent: enumOr(b.layoutIntent, LAYOUT_INTENTS, 'stacked'),
      hierarchy: enumOr(b.hierarchy, ['low', 'medium', 'high', 'hero'] as const, 'medium'),
      imageScale: enumOr(b.imageScale, ['small', 'medium', 'large', 'hero'] as const, 'medium'),
      responseSpace: enumOr(b.responseSpace, ['none', 'small', 'medium', 'large'] as const, 'medium'),
      cardEmphasis: enumOr(b.cardEmphasis, ['none', 'soft', 'primary', 'contrast'] as const, 'soft'),
      preferredColumns: typeof b.preferredColumns === 'number' && [1, 2, 3, 4].includes(b.preferredColumns)
        ? (b.preferredColumns as 1 | 2 | 3 | 4)
        : undefined,
      imagePosition: enumOr(b.imagePosition, ['top', 'left', 'right', 'inline'] as const, 'inline'),
      decorationRole: enumOr(b.decorationRole, ['none', 'badge', 'soft-shape', 'divider'] as const, 'none'),
    }));

  // 누락된 blockId 를 fallback 으로 채우지 않는다. contract validator 가 판정.
  return {
    version: '1.0',
    pageId: str(r.pageId, page.pageId),
    styleFamily: str(r.styleFamily, styleFamilyHint ?? 'default'),
    pageIntent: enumOr(r.pageIntent, LAYOUT_INTENTS, 'stacked'),
    density: enumOr(r.density, ['airy', 'comfortable', 'compact'] as const, 'comfortable'),
    decorationLevel: enumOr(r.decorationLevel, ['minimal', 'soft', 'playful'] as const, 'soft'),
    readingOrder,
    paletteRoles: {
      pageBackground: str(paletteRaw.pageBackground, '#ffffff'),
      surface: str(paletteRaw.surface, '#f8fafc'),
      surfaceAlt: str(paletteRaw.surfaceAlt, '#eef2ff'),
      primary: str(paletteRaw.primary, '#f472b6'),
      secondary: str(paletteRaw.secondary, '#60a5fa'),
      accent: str(paletteRaw.accent, '#fbbf24'),
      textPrimary: str(paletteRaw.textPrimary, '#111827'),
      textSecondary: str(paletteRaw.textSecondary, '#4b5563'),
      answerArea: str(paletteRaw.answerArea, '#ffffff'),
      border: str(paletteRaw.border, '#e5e7eb'),
    },
    typographyRoles: {
      displayScale: enumOr(typoRaw.displayScale, ['small', 'medium', 'large', 'hero'] as const, 'large'),
      instructionScale: enumOr(typoRaw.instructionScale, ['small', 'medium', 'large', 'hero'] as const, 'medium'),
      bodyScale: enumOr(typoRaw.bodyScale, ['small', 'medium', 'large'] as const, 'medium'),
      weightContrast: enumOr(typoRaw.weightContrast, ['soft', 'clear', 'strong'] as const, 'clear'),
    },
    shapeRoles: {
      radiusScale: enumOr(shapeRaw.radiusScale, ['small', 'medium', 'large'] as const, 'medium'),
      badgeStyle: enumOr(shapeRaw.badgeStyle, ['circle', 'pill', 'rounded-square'] as const, 'circle'),
      borderStyle: enumOr(shapeRaw.borderStyle, ['none', 'soft', 'clear'] as const, 'soft'),
      shadowLevel: enumOr(shapeRaw.shadowLevel, ['none', 'soft'] as const, 'soft'),
    },
    blocks,
  };
}
