// WorksheetPlanner — ContentPlan → WorksheetPlan.

import type { GenerationContext } from '@/services/learning-generation/context-builder';
import type { ContentPlan } from '@/services/learning-generation/types';

import {
  worksheetPlannerSystemPrompt,
  worksheetPlannerUserPrompt,
} from './prompt';
import { DEFAULT_DESIGN_SYSTEM } from './types';
import type {
  ActivityType,
  LayoutHint,
  LearningFlowStage,
  ResponseAreaPlan,
  VisualRequirement,
  WorksheetBlock,
  WorksheetDesignSystem,
  WorksheetPagePlan,
  WorksheetPlan,
} from './types';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const PLANNER_MODEL = process.env.LEARNING_V2_MODEL || 'gpt-4o';

function baseUrl(): string {
  return process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
}
function apiKey(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error('OPENAI_API_KEY missing');
  return k;
}

export type WorksheetPlannerFailureCode =
  | 'AI_UPSTREAM'
  | 'AI_TIMEOUT'
  | 'PARSE_ERROR'
  | 'SCHEMA_ERROR';

export type WorksheetPlannerResult =
  | {
      ok: true;
      plan: WorksheetPlan;
      durationMs: number;
      inputTokens?: number;
      outputTokens?: number;
    }
  | {
      ok: false;
      reason: string;
      errorCode: WorksheetPlannerFailureCode;
    };

export async function generateWorksheetPlan(
  context: GenerationContext,
  contentPlan: ContentPlan,
): Promise<WorksheetPlannerResult> {
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
        model: PLANNER_MODEL,
        temperature: 0.4,
        max_tokens: 5000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: worksheetPlannerSystemPrompt() },
          {
            role: 'user',
            content: worksheetPlannerUserPrompt(context, contentPlan),
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
          ? 'WorksheetPlanner timeout (60s)'
          : `WorksheetPlanner 호출 실패: ${(err as Error).message}`,
      errorCode: name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_UPSTREAM',
    };
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      reason: `WorksheetPlanner HTTP ${res.status}: ${body.slice(0, 200)}`,
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
      reason: 'WorksheetPlanner 응답이 비어 있음',
      errorCode: 'PARSE_ERROR',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      reason: 'WorksheetPlan JSON 파싱 실패',
      errorCode: 'PARSE_ERROR',
    };
  }

  const plan = normalizeWorksheetPlan(parsed, contentPlan);
  if (!plan) {
    return {
      ok: false,
      reason: 'WorksheetPlan 구조가 요구 스키마와 다름',
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

const ACTIVITY_TYPES: readonly ActivityType[] = [
  'picture-choice',
  'matching',
  'classification',
  'fill-blank',
  'writing-grid',
  'guided-practice',
  'independent-practice',
  'sequence',
  'observation',
  'open-response',
];

const FLOW_ROLES: readonly LearningFlowStage['role'][] = [
  'warmup',
  'guided',
  'practice',
  'assessment',
  'reflection',
];

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && !Number.isNaN(v) ? v : fallback;
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : [];
}

function normalizeWorksheetPlan(
  raw: unknown,
  contentPlan: ContentPlan,
): WorksheetPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const title = str(o.title).trim() || '학습지';
  const subtitle = str(o.subtitle).trim() || undefined;
  const estimatedMinutes = Math.max(5, Math.min(60, Math.round(num(o.estimatedMinutes, 20))));

  const designSystem = normalizeDesignSystem(o.designSystem);
  const learningFlow = normalizeLearningFlow(o.learningFlow);
  const pages = normalizePages(o.pages);
  if (pages.length === 0) return null;

  const studentInstructions = strArr(o.studentInstructions);
  const teacherNotes = strArr(o.teacherNotes);

  // 모든 blueprint.itemId 가 어딘가 sourceItemIds 에 있어야 한다. 없으면 마지막 페이지에
  // fallback 블록을 추가한다 (구조적 안전망).
  const covered = new Set<string>();
  for (const page of pages) {
    for (const blk of page.blocks) {
      for (const id of blk.sourceItemIds) covered.add(id);
    }
  }
  const missing = contentPlan.itemBlueprints
    .map((b) => b.itemId)
    .filter((id) => !covered.has(id));
  if (missing.length > 0) {
    const lastPage = pages[pages.length - 1]!;
    for (const id of missing) {
      lastPage.blocks.push({
        blockId: `blk_missing_${id}`,
        sourceItemIds: [id],
        activityType: 'independent-practice',
        learningRole: 'practice',
        instruction: '',
        responseArea: { type: 'lines', count: 2 },
        visualRequirement: { needed: false },
        layoutHint: { widthFraction: 1.0 },
      });
    }
  }

  return {
    version: 'v1',
    title,
    subtitle,
    estimatedMinutes,
    learningFlow,
    designSystem,
    pages,
    studentInstructions:
      studentInstructions.length > 0
        ? studentInstructions
        : ['이름과 날짜를 먼저 쓰고 안내를 따라 활동을 완성해 봅시다.'],
    teacherNotes: teacherNotes.length > 0 ? teacherNotes : undefined,
  };
}

function normalizeDesignSystem(raw: unknown): WorksheetDesignSystem {
  if (!raw || typeof raw !== 'object') return DEFAULT_DESIGN_SYSTEM;
  const o = raw as Record<string, unknown>;
  return {
    bodyFontSize: Math.max(9, Math.min(14, num(o.bodyFontSize, DEFAULT_DESIGN_SYSTEM.bodyFontSize))),
    pageMarginMm: Math.max(10, Math.min(25, num(o.pageMarginMm, DEFAULT_DESIGN_SYSTEM.pageMarginMm))),
    blockGapMm: Math.max(2, Math.min(14, num(o.blockGapMm, DEFAULT_DESIGN_SYSTEM.blockGapMm))),
    answerBoxColor: str(o.answerBoxColor) || DEFAULT_DESIGN_SYSTEM.answerBoxColor,
    accentColor: str(o.accentColor) || DEFAULT_DESIGN_SYSTEM.accentColor,
    cardRadiusPt: Math.max(0, Math.min(12, num(o.cardRadiusPt, DEFAULT_DESIGN_SYSTEM.cardRadiusPt))),
  };
}

function normalizeLearningFlow(raw: unknown): LearningFlowStage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => s !== null && typeof s === 'object')
    .map((s, i) => {
      const role = FLOW_ROLES.includes(s.role as LearningFlowStage['role'])
        ? (s.role as LearningFlowStage['role'])
        : 'practice';
      return {
        id: str(s.id) || `stage_${String(i + 1).padStart(2, '0')}`,
        role,
        goal: str(s.goal),
        blockIds: strArr(s.blockIds),
      };
    });
}

function normalizePages(raw: unknown): WorksheetPagePlan[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object')
    .map((p, i) => {
      const layout: WorksheetPagePlan['layout'] =
        p.layout === 'two-column' ||
        p.layout === 'grid' ||
        p.layout === 'mixed'
          ? (p.layout as WorksheetPagePlan['layout'])
          : 'single-column';
      const blocks = normalizeBlocks(p.blocks);
      return {
        pageId: str(p.pageId) || `p_${String(i + 1).padStart(2, '0')}`,
        pageNumber: num(p.pageNumber, i + 1),
        purpose: str(p.purpose),
        layout,
        blocks,
      };
    })
    .filter((p) => p.blocks.length > 0);
}

function normalizeBlocks(raw: unknown): WorksheetBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b): b is Record<string, unknown> => b !== null && typeof b === 'object')
    .map((b, i) => {
      const activityType = ACTIVITY_TYPES.includes(b.activityType as ActivityType)
        ? (b.activityType as ActivityType)
        : 'independent-practice';
      const learningRole = FLOW_ROLES.includes(b.learningRole as LearningFlowStage['role'])
        ? (b.learningRole as LearningFlowStage['role'])
        : 'practice';
      return {
        blockId: str(b.blockId) || `blk_${String(i + 1).padStart(2, '0')}`,
        sourceItemIds: strArr(b.sourceItemIds),
        activityType,
        learningRole,
        instruction: str(b.instruction).trim(),
        responseArea: normalizeResponseArea(b.responseArea),
        visualRequirement: normalizeVisualRequirement(b.visualRequirement),
        layoutHint: normalizeLayoutHint(b.layoutHint),
        teacherOverlay: normalizeTeacherOverlay(b.teacherOverlay),
      };
    });
}

function normalizeResponseArea(raw: unknown): ResponseAreaPlan {
  if (!raw || typeof raw !== 'object') return { type: 'none' };
  const o = raw as Record<string, unknown>;
  const validTypes = ['lines', 'grid', 'box', 'connect', 'select', 'buckets', 'none'];
  const type = validTypes.includes(o.type as string)
    ? (o.type as ResponseAreaPlan['type'])
    : 'none';
  return {
    type,
    count: typeof o.count === 'number' ? Math.max(1, Math.min(20, Math.round(o.count))) : undefined,
    heightRatio:
      typeof o.heightRatio === 'number'
        ? Math.max(0.1, Math.min(0.6, o.heightRatio))
        : undefined,
  };
}

function normalizeVisualRequirement(raw: unknown): VisualRequirement {
  if (!raw || typeof raw !== 'object') return { needed: false };
  const o = raw as Record<string, unknown>;
  const needed = o.needed === true;
  if (!needed) return { needed: false };
  const count = typeof o.count === 'number' ? Math.max(1, Math.min(6, Math.round(o.count))) : 1;
  const validRoles = ['choice', 'observation', 'illustration', 'reference'];
  const role = validRoles.includes(o.role as string)
    ? (o.role as VisualRequirement['role'])
    : 'illustration';
  return {
    needed,
    count,
    role,
    hint: str(o.hint) || undefined,
  };
}

function normalizeLayoutHint(raw: unknown): LayoutHint {
  if (!raw || typeof raw !== 'object') return { widthFraction: 1.0 };
  const o = raw as Record<string, unknown>;
  return {
    widthFraction: Math.max(0.3, Math.min(1.0, num(o.widthFraction, 1.0))),
    minHeightMm:
      typeof o.minHeightMm === 'number' ? Math.max(10, Math.min(240, o.minHeightMm)) : undefined,
    keepWithNext: o.keepWithNext === true,
  };
}

function normalizeTeacherOverlay(
  raw: unknown,
): WorksheetBlock['teacherOverlay'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const answerNote = str(o.answerNote).trim() || undefined;
  const guidanceNote = str(o.guidanceNote).trim() || undefined;
  if (!answerNote && !guidanceNote) return undefined;
  return { answerNote, guidanceNote };
}
