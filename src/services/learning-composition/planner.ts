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

  // 결정론적 사전 조판 검증. 페이지별 예측 사용률이 임계값을 초과하면
  // 블록을 자동으로 다음 페이지로 이동. 답안 공간·본문은 축소하지 않는다.
  const rebalanced = rebalanceComposition(plan);
  if (!rebalanced.ok) {
    return {
      ok: false,
      reason: `CompositionPlan 사전 조판 실패: ${rebalanced.reason}`,
      errorCode: 'SCHEMA_ERROR',
    };
  }

  return {
    ok: true,
    plan: rebalanced.plan,
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
  _contentPlan: ContentPlan,
): PageCompositionPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const strategy = normalizeStrategy(o.documentStrategy);
  const pages = normalizePages(o.pages);
  if (pages.length === 0) return null;

  // 이전 버전은 sourceItemIds 미커버 시 fallback 'open-response' 블록을 자동
  // 삽입했다. 이 자동 보정은 계약 위반을 은폐하는 부작용이 있어 제거됐다.
  // 커버리지 검증은 별도 ID 계약 검증기 (verifyCompositionLinkingContract) 가
  // 담당하며, 실패 시 파이프라인이 fail hard 한다.

  // 중복 sourceItemId 자동 dedup: AI 가 같은 blueprint 를 여러 블록에 넣은 경우
  // 첫 등장만 유지. 이 결정론적 정리는 duplicateItemPlacements 오탐을 방지하되
  // AI 가 의도적으로 확장 참조한 흔적을 남기지는 않는다 (계약 검증 후 실패 시
  // 재생성 경로로 복구됨).
  const seenIds = new Set<string>();
  for (const page of pages) {
    for (const block of page.blocks) {
      const kept: string[] = [];
      for (const id of block.sourceItemIds) {
        if (!seenIds.has(id)) {
          seenIds.add(id);
          kept.push(id);
        }
      }
      block.sourceItemIds = kept;
    }
  }

  return {
    version: 'v1',
    documentStrategy: strategy,
    pages,
  };
}

// ============================================================
// 사전 조판 검증 (deterministic pre-composition rebalance).
//
// AI 가 예측한 estimatedHeightMm 를 페이지별 컬럼 사용률로 집계하여
// 임계값 (MAX_FILL_RATIO=0.92) 을 초과하면 블록을 다음 페이지로 자동 이동.
// 답안 공간과 본문 글자 크기는 축소하지 않는다. 2쪽에 안전하게 들어가지
// 않으면 3, 4쪽으로 확장. 단, 총 페이지 상한 MAX_PAGES=4 는 지킨다.
// ============================================================

const MAX_FILL_RATIO = 0.92;
const MIN_LEADING_FILL = 0.35; // 마지막 페이지가 아닌 경우 최소 사용률.
const AVAILABLE_MM = 250; // A4 세로 297mm - 상하 여백 20mm 씩.
const MAX_PAGES = 4;

interface RebalanceResult {
  ok: boolean;
  plan: PageCompositionPlan;
  reason?: string;
}

export function rebalanceComposition(plan: PageCompositionPlan): RebalanceResult {
  const pages: CompositionPage[] = plan.pages.map((p) => ({
    ...p,
    blocks: [...p.blocks].sort((a, b) => a.placement.order - b.placement.order),
  }));

  // 안전 반복. 각 loop 는 한 페이지에서 초과분을 다음 페이지 앞으로 이동.
  for (let iter = 0; iter < 40; iter += 1) {
    let mutated = false;
    for (let i = 0; i < pages.length; i += 1) {
      const page = pages[i]!;
      const fill = computePageFillRatio(page);
      if (fill <= MAX_FILL_RATIO) continue;

      // 초과: 마지막 블록을 다음 페이지 (없으면 새 페이지) 앞으로 이동.
      if (page.blocks.length <= 1) {
        // 단일 블록 페이지가 초과 → 이 블록 자체가 페이지 하나를 넘긴다.
        // 답안 공간·본문을 줄이지 않는 원칙 하에서는 조판 실패.
        return {
          ok: false,
          plan,
          reason: `page=${page.pageId} 단일 블록 (${page.blocks[0]?.blockId}) 이 페이지 상한을 넘음 (estimatedHeightMm=${page.blocks[0]?.estimatedHeightMm}). 블록을 분해하거나 primitive 를 재선택해야 함.`,
        };
      }

      const moved = page.blocks.pop()!;
      // 다음 페이지가 없으면 새로 만든다.
      if (i + 1 >= pages.length) {
        if (pages.length >= MAX_PAGES) {
          // 페이지 상한 도달 — 이동할 곳 없음.
          return {
            ok: false,
            plan,
            reason: `MAX_PAGES=${MAX_PAGES} 도달. 마지막 페이지 사용률 ${Math.round(fill * 100)}% 초과 유지.`,
          };
        }
        pages.push({
          pageId: `page_${String(pages.length + 1).padStart(2, '0')}`,
          pageNumber: pages.length + 1,
          purpose: page.purpose, // 페이지 흐름 유지.
          layout: 'single',
          columns: 1,
          blocks: [],
        });
      }
      const next = pages[i + 1]!;
      // 이동한 블록은 다음 페이지 첫 컬럼 첫 자리에 놓고, 기존 블록 order 를 뒤로 밀기.
      const relocated: CompositionBlock = {
        ...moved,
        placement: {
          column: 1,
          widthFraction: 1.0,
          order: 1,
          columnSpan: 1,
        },
      };
      const shifted = next.blocks.map((b) => ({
        ...b,
        placement: { ...b.placement, order: b.placement.order + 1 },
      }));
      next.blocks = [relocated, ...shifted];
      mutated = true;
      // 한 번의 재배치 후 처음부터 다시 검사 (연쇄 이동 가능).
      break;
    }
    if (!mutated) {
      // 모든 페이지가 임계값 이하 → 성공.
      // 마지막이 아닌 페이지가 너무 비면 (< MIN_LEADING_FILL) 다음 페이지 첫 블록을 당겨온다.
      const pulled = pullUpUnderfilledPages(pages);
      if (pulled.mutated) continue; // 당겼으니 다시 검증.
      break;
    }
  }

  // 페이지 상한을 넘지 않으면서 안정화됐는지 최종 확인.
  const finalFills = pages.map(computePageFillRatio);
  const bad = finalFills.findIndex((r) => r > MAX_FILL_RATIO);
  if (bad >= 0) {
    return {
      ok: false,
      plan,
      reason: `rebalance 안정화 실패: page=${pages[bad]?.pageId} 사용률 ${Math.round(finalFills[bad]! * 100)}%.`,
    };
  }

  // pageNumber 재할당 + pageTarget 을 실제 페이지 수로 갱신.
  pages.forEach((p, i) => {
    p.pageNumber = i + 1;
    p.pageId = `page_${String(i + 1).padStart(2, '0')}`;
  });

  const updatedStrategy = {
    ...plan.documentStrategy,
    pageTarget: pages.length,
  };

  return {
    ok: true,
    plan: {
      version: plan.version,
      documentStrategy: updatedStrategy,
      pages,
    },
  };
}

function computePageFillRatio(page: CompositionPage): number {
  const columnUsed = new Array(Math.max(1, page.columns)).fill(0);
  for (const b of page.blocks) {
    const col = Math.max(0, Math.min(page.columns - 1, b.placement.column - 1));
    columnUsed[col] += b.estimatedHeightMm;
  }
  const maxUse = Math.max(...columnUsed, 0);
  return maxUse / AVAILABLE_MM;
}

function pullUpUnderfilledPages(pages: CompositionPage[]): { mutated: boolean } {
  let mutated = false;
  for (let i = 0; i < pages.length - 1; i += 1) {
    const page = pages[i]!;
    const next = pages[i + 1]!;
    if (next.blocks.length === 0) continue;
    const currentFill = computePageFillRatio(page);
    if (currentFill >= MIN_LEADING_FILL) continue;
    const candidate = next.blocks[0]!;
    // 시도: 이 블록을 현재 페이지 마지막에 붙였을 때 임계값 이하인가?
    const trialPage: CompositionPage = {
      ...page,
      blocks: [
        ...page.blocks,
        {
          ...candidate,
          placement: {
            column: 1,
            widthFraction: 1.0,
            order: page.blocks.length + 1,
            columnSpan: 1,
          },
        },
      ],
    };
    const trialFill = computePageFillRatio(trialPage);
    if (trialFill > MAX_FILL_RATIO) continue;
    // 채택.
    page.blocks = trialPage.blocks;
    next.blocks = next.blocks.slice(1).map((b, idx) => ({
      ...b,
      placement: { ...b.placement, order: idx + 1 },
    }));
    mutated = true;
    // 다음 페이지가 비었으면 제거.
    if (next.blocks.length === 0) {
      pages.splice(i + 1, 1);
    }
    break;
  }
  return { mutated };
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
      const rawVisual = normalizeVisualSlot(b.visualSlot);
      // 결정론적 안전망: writing/calculation/open-response/reflection/instruction 은
      // 이미지가 학생 행동에 기능적으로 필요하지 않은 primitive.
      // AI 가 실수로 needed=true 라 표시해도 강제로 false 로 눌러 IMAGE_NOT_LINKED
      // 리젝트를 예방한다 (composition prompt 로도 안내되나 이중 안전).
      const visualSlot = shouldSuppressVisualSlot(primitive) ? { needed: false } : rawVisual;
      return {
        blockId: str(b.blockId) || `blk_${String(i + 1).padStart(2, '0')}`,
        sourceItemIds,
        primitive,
        instruction: str(b.instruction).trim(),
        placement: normalizePlacement(b.placement, pageColumns, i + 1),
        estimatedHeightMm: Math.max(15, Math.min(240, Math.round(num(b.estimatedHeightMm, 80)))),
        visualSlot,
        responseSpace: finalResponse,
        teacherOverlay: normalizeTeacherOverlay(b.teacherOverlay),
      };
    });
}

const NON_VISUAL_PRIMITIVES = new Set<LayoutPrimitive>([
  'writing-practice',
  'calculation-practice',
  'open-response',
  'reflection-strip',
  'instruction-strip',
]);

function shouldSuppressVisualSlot(primitive: LayoutPrimitive): boolean {
  return NON_VISUAL_PRIMITIVES.has(primitive);
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
