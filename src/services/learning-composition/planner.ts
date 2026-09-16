// PageCompositionPlan generator.

import type { GenerationContext } from '@/services/learning-generation/context-builder';
import type { ContentPlan } from '@/services/learning-generation/types';
import type { WorksheetPlan } from '@/services/learning-worksheet';

import { compositionSystemPrompt, compositionUserPrompt } from './prompt';
import type {
  CompositionBlock,
  CompositionPage,
  DocumentStrategy,
  LayoutKey,
  LayoutPrimitive,
  PageCompositionPlan,
  Placement,
  ResponseSpacePlan,
  VisualSlotPlan,
} from './types';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const COMPOSITION_MODEL = process.env.LEARNING_V2_MODEL || 'gpt-4o';

function baseUrl(): string {
  return process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
}
function apiKey(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error('OPENAI_API_KEY missing');
  return k;
}

export type CompositionFailureCode =
  | 'AI_UPSTREAM'
  | 'AI_TIMEOUT'
  | 'PARSE_ERROR'
  | 'SCHEMA_ERROR';

export type CompositionResult =
  | {
      ok: true;
      plan: PageCompositionPlan;
      durationMs: number;
      inputTokens?: number;
      outputTokens?: number;
    }
  | { ok: false; reason: string; errorCode: CompositionFailureCode };

export async function generateCompositionPlan(
  context: GenerationContext,
  contentPlan: ContentPlan,
  worksheetPlan: WorksheetPlan,
): Promise<CompositionResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: COMPOSITION_MODEL,
        temperature: 0.4,
        max_tokens: 6000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: compositionSystemPrompt() },
          {
            role: 'user',
            content: compositionUserPrompt(context, contentPlan, worksheetPlan),
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const name = (err as { name?: string }).name;
    return {
      ok: false,
      reason:
        name === 'AbortError'
          ? 'CompositionPlan timeout (60s)'
          : `CompositionPlan 호출 실패: ${(err as Error).message}`,
      errorCode: name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_UPSTREAM',
    };
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      reason: `CompositionPlan HTTP ${res.status}: ${body.slice(0, 200)}`,
      errorCode: 'AI_UPSTREAM',
    };
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const raw = json.choices?.[0]?.message?.content ?? '';
  if (!raw) {
    return {
      ok: false,
      reason: 'CompositionPlan 응답이 비어 있음',
      errorCode: 'PARSE_ERROR',
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      reason: 'CompositionPlan JSON 파싱 실패',
      errorCode: 'PARSE_ERROR',
    };
  }

  const plan = normalizeCompositionPlan(parsed, contentPlan);
  if (!plan) {
    return {
      ok: false,
      reason: 'CompositionPlan 구조가 요구 스키마와 다름',
      errorCode: 'SCHEMA_ERROR',
    };
  }

  return {
    ok: true,
    plan,
    durationMs: Date.now() - started,
    inputTokens: json.usage?.prompt_tokens,
    outputTokens: json.usage?.completion_tokens,
  };
}

const PRIMITIVES: readonly LayoutPrimitive[] = [
  'instruction-strip',
  'concept-panel',
  'example-panel',
  'matching-board',
  'choice-grid',
  'image-observation',
  'compare-panel',
  'sequence-steps',
  'writing-practice',
  'calculation-practice',
  'open-response',
  'reflection-strip',
  'visual-canvas',
];

const LAYOUTS: readonly LayoutKey[] = ['single', 'split', 'grid', 'sequence', 'canvas'];

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function num(v: unknown, fb: number): number {
  return typeof v === 'number' && !Number.isNaN(v) ? v : fb;
}

function normalizeCompositionPlan(
  raw: unknown,
  contentPlan: ContentPlan,
): PageCompositionPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const strategy = normalizeStrategy(o.documentStrategy);
  const pages = normalizePages(o.pages);
  if (pages.length === 0) return null;

  // sourceItemIds 커버리지 검증. 부족하면 마지막 페이지에 fallback 블록 추가.
  const covered = new Set<string>();
  for (const p of pages) for (const b of p.blocks) for (const id of b.sourceItemIds) covered.add(id);
  const missing = contentPlan.itemBlueprints
    .map((b) => b.itemId)
    .filter((id) => !covered.has(id));
  if (missing.length > 0) {
    const last = pages[pages.length - 1]!;
    let order = last.blocks.length;
    for (const id of missing) {
      order += 1;
      last.blocks.push({
        blockId: `blk_missing_${id}`,
        sourceItemIds: [id],
        primitive: 'open-response',
        instruction: '',
        placement: { column: 1, widthFraction: 1.0, order, columnSpan: 1 },
        estimatedHeightMm: 80,
        visualSlot: { needed: false },
        responseSpace: { type: 'line', size: 'medium', lines: 3 },
      });
    }
  }

  return {
    version: 'v1',
    documentStrategy: strategy,
    pages,
  };
}

function normalizeStrategy(raw: unknown): DocumentStrategy {
  if (!raw || typeof raw !== 'object') {
    return {
      learningFlow: '관찰 → 이해 → 연습 → 자기 표현',
      visualHierarchy: '제목 → 활동 안내 → 학생 응답',
      density: 'medium',
      pageTarget: 2,
      designDirection: '카드 최소화 · 활동별 배치 차별화',
      designRationale: 'default',
    };
  }
  const s = raw as Record<string, unknown>;
  const density = s.density === 'low' || s.density === 'high' ? s.density : 'medium';
  return {
    learningFlow: str(s.learningFlow) || '관찰 → 이해 → 연습 → 자기 표현',
    visualHierarchy: str(s.visualHierarchy) || '제목 → 활동 → 응답',
    density: density as DocumentStrategy['density'],
    pageTarget: Math.max(1, Math.min(4, Math.round(num(s.pageTarget, 2)))),
    designDirection: str(s.designDirection) || '학생 행동에 맞춘 배치',
    designRationale: str(s.designRationale) || '',
  };
}

function normalizePages(raw: unknown): CompositionPage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object')
    .map((p, i) => {
      const layout: LayoutKey = LAYOUTS.includes(p.layout as LayoutKey)
        ? (p.layout as LayoutKey)
        : 'single';
      const columns = Math.max(1, Math.min(3, Math.round(num(p.columns, 1))));
      const blocks = normalizeBlocks(p.blocks, columns);
      return {
        pageId: str(p.pageId) || `page_${String(i + 1).padStart(2, '0')}`,
        pageNumber: num(p.pageNumber, i + 1),
        purpose: str(p.purpose),
        layout,
        columns,
        blocks,
      };
    })
    .filter((p) => p.blocks.length > 0);
}

function normalizeBlocks(raw: unknown, pageColumns: number): CompositionBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b): b is Record<string, unknown> => b !== null && typeof b === 'object')
    .map((b, i) => {
      const primitive: LayoutPrimitive = PRIMITIVES.includes(b.primitive as LayoutPrimitive)
        ? (b.primitive as LayoutPrimitive)
        : 'open-response';
      const sourceItemIds = Array.isArray(b.sourceItemIds)
        ? (b.sourceItemIds.filter((x) => typeof x === 'string') as string[])
        : [];
      const rs = normalizeResponseSpace(b.responseSpace);
      // Interactive primitive 에는 responseSpace.type=none 을 허용하지 않는다.
      const finalResponse = ensureResponseSpaceForPrimitive(primitive, rs);
      return {
        blockId: str(b.blockId) || `blk_${String(i + 1).padStart(2, '0')}`,
        sourceItemIds,
        primitive,
        instruction: str(b.instruction).trim(),
        placement: normalizePlacement(b.placement, pageColumns, i + 1),
        estimatedHeightMm: Math.max(15, Math.min(240, Math.round(num(b.estimatedHeightMm, 80)))),
        visualSlot: normalizeVisualSlot(b.visualSlot),
        responseSpace: finalResponse,
        teacherOverlay: normalizeTeacherOverlay(b.teacherOverlay),
      };
    });
}

// Interactive primitive 는 학생이 응답할 공간이 필수. 기본값 부여.
function ensureResponseSpaceForPrimitive(
  primitive: LayoutPrimitive,
  rs: ResponseSpacePlan,
): ResponseSpacePlan {
  if (rs.type !== 'none') return rs;
  switch (primitive) {
    case 'writing-practice':
      return { type: 'grid', size: 'medium', cells: 10 };
    case 'calculation-practice':
      return { type: 'line', size: 'small', lines: 1 };
    case 'open-response':
      return { type: 'line', size: 'medium', lines: 4 };
    case 'image-observation':
      return { type: 'line', size: 'medium', lines: 3 };
    default:
      return rs;
  }
}

function normalizePlacement(raw: unknown, pageColumns: number, defaultOrder: number): Placement {
  if (!raw || typeof raw !== 'object') {
    return { column: 1, widthFraction: 1.0, order: defaultOrder, columnSpan: 1 };
  }
  const p = raw as Record<string, unknown>;
  const column = Math.max(1, Math.min(pageColumns, Math.round(num(p.column, 1))));
  const widthFraction = Math.max(0.3, Math.min(1.0, num(p.widthFraction, 1.0)));
  const order = Math.max(1, Math.round(num(p.order, defaultOrder)));
  const columnSpan = Math.max(
    1,
    Math.min(pageColumns - column + 1, Math.round(num(p.columnSpan, 1))),
  );
  return { column, widthFraction, order, columnSpan };
}

function normalizeVisualSlot(raw: unknown): VisualSlotPlan {
  if (!raw || typeof raw !== 'object') return { needed: false };
  const s = raw as Record<string, unknown>;
  const needed = s.needed === true;
  if (!needed) return { needed: false };
  const validRoles = ['observation', 'choice', 'illustration', 'reference', 'process'];
  const validPlacements = ['inline', 'side', 'background', 'choice-grid', 'top', 'bottom'];
  return {
    needed,
    role: validRoles.includes(s.role as string)
      ? (s.role as VisualSlotPlan['role'])
      : 'illustration',
    placement: validPlacements.includes(s.placement as string)
      ? (s.placement as VisualSlotPlan['placement'])
      : 'inline',
    widthFraction: typeof s.widthFraction === 'number'
      ? Math.max(0.15, Math.min(1.0, s.widthFraction))
      : 0.4,
    count: typeof s.count === 'number' ? Math.max(1, Math.min(6, Math.round(s.count))) : 1,
    hint: str(s.hint) || undefined,
  };
}

function normalizeResponseSpace(raw: unknown): ResponseSpacePlan {
  if (!raw || typeof raw !== 'object') return { type: 'none' };
  const s = raw as Record<string, unknown>;
  const validTypes = ['none', 'line', 'box', 'grid', 'manuscript', 'drawing'];
  const type = validTypes.includes(s.type as string)
    ? (s.type as ResponseSpacePlan['type'])
    : 'none';
  const size = s.size === 'small' || s.size === 'large' ? s.size : 'medium';
  return {
    type,
    size: size as ResponseSpacePlan['size'],
    cells: typeof s.cells === 'number' ? Math.max(1, Math.min(50, Math.round(s.cells))) : undefined,
    lines: typeof s.lines === 'number' ? Math.max(1, Math.min(20, Math.round(s.lines))) : undefined,
  };
}

function normalizeTeacherOverlay(raw: unknown): CompositionBlock['teacherOverlay'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Record<string, unknown>;
  const answerNote = str(s.answerNote).trim() || undefined;
  const guidanceNote = str(s.guidanceNote).trim() || undefined;
  if (!answerNote && !guidanceNote) return undefined;
  return { answerNote, guidanceNote };
}
