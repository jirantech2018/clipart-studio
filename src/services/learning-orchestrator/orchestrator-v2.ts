// V2 orchestrator — 3단계 (Plan → Document from Plan → Repair item).
//
// 원칙:
//   - subject/topic 코드 분기 없음. 프롬프트도 공통 하나.
//   - 각 함수는 예외를 던지지 않고 { ok:false, reason } 반환 → caller 가 명시적 처리.
//   - normalize/itemId 부여는 shared normalize 함수 사용.

import type { LearningDocument, Section } from '@/services/learning-renderer/schema';
import type { GenerationContext } from '@/services/learning-generation/context-builder';
import type { ContentPlan, ItemBlueprint } from '@/services/learning-generation/types';

import {
  v2SystemPromptCommon,
  v2UserPromptContentPlan,
  v2UserPromptDocumentFromPlan,
  v2UserPromptRepairItem,
  v2UserPromptSingleShot,
} from './prompts-v2';
import { normalizeLearningDocument } from './normalize';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const V2_MODEL = process.env.LEARNING_V2_MODEL || 'gpt-4o';

function baseUrl(): string {
  return process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
}
function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing');
  return key;
}

// ============================================================
// Shared types
// ============================================================
export type StepFailureCode = 'AI_UPSTREAM' | 'AI_TIMEOUT' | 'PARSE_ERROR' | 'SCHEMA_ERROR';

interface StepFailure {
  ok: false;
  reason: string;
  errorCode: StepFailureCode;
}

async function callOpenAI(
  userPrompt: string,
  opts: { timeoutMs?: number; maxTokens?: number; temperature?: number },
): Promise<
  | { ok: true; text: string; inputTokens?: number; outputTokens?: number; durationMs: number }
  | StepFailure
> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: V2_MODEL,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 3000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: v2SystemPromptCommon() },
          { role: 'user', content: userPrompt },
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
          ? `V2 AI 응답 timeout (${Math.round(timeoutMs / 1000)}s)`
          : `V2 AI 호출 실패: ${(err as Error).message}`,
      errorCode: name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_UPSTREAM',
    };
  }
  clearTimeout(timeout);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      reason: `V2 AI 응답 오류 ${res.status}: ${body.slice(0, 200)}`,
      errorCode: 'AI_UPSTREAM',
    };
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const raw = json.choices?.[0]?.message?.content ?? '';
  if (!raw) return { ok: false, reason: 'V2 AI 응답이 비어 있음', errorCode: 'PARSE_ERROR' };
  return {
    ok: true,
    text: raw,
    inputTokens: json.usage?.prompt_tokens,
    outputTokens: json.usage?.completion_tokens,
    durationMs: Date.now() - started,
  };
}

// ============================================================
// Step 1: ContentPlan
// ============================================================
export type PlanResult =
  | {
      ok: true;
      plan: ContentPlan;
      durationMs: number;
      inputTokens?: number;
      outputTokens?: number;
    }
  | StepFailure;

export async function generateContentPlan(context: GenerationContext): Promise<PlanResult> {
  const call = await callOpenAI(v2UserPromptContentPlan(context), {
    timeoutMs: 45_000,
    maxTokens: 2000,
    temperature: 0.3,
  });
  if (!call.ok) return call;

  let parsed: unknown;
  try {
    parsed = JSON.parse(call.text);
  } catch {
    return { ok: false, reason: 'ContentPlan JSON 파싱 실패', errorCode: 'PARSE_ERROR' };
  }

  const plan = normalizeContentPlan(parsed, context.request.amount);
  if (!plan) {
    return {
      ok: false,
      reason: 'ContentPlan 구조가 요구 스키마와 다름',
      errorCode: 'SCHEMA_ERROR',
    };
  }

  return {
    ok: true,
    plan,
    durationMs: call.durationMs,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
  };
}

function normalizeContentPlan(raw: unknown, expectedCount: number): ContentPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const bluesRaw = obj.itemBlueprints;
  if (!Array.isArray(bluesRaw)) return null;
  if (bluesRaw.length !== expectedCount) return null;

  const blueprints: ItemBlueprint[] = [];
  const seenIds = new Set<string>();
  for (const b of bluesRaw) {
    if (!b || typeof b !== 'object') return null;
    const r = b as Record<string, unknown>;
    const itemId = typeof r.itemId === 'string' ? r.itemId.trim() : '';
    if (!itemId || seenIds.has(itemId)) return null;
    seenIds.add(itemId);
    blueprints.push({
      itemId,
      intendedLearning: str(r.intendedLearning),
      studentTask: str(r.studentTask),
      itemFormat: str(r.itemFormat),
      informationInsideItem: str(r.informationInsideItem),
      successCriterion: str(r.successCriterion),
      distractorDesignPrinciple: str(r.distractorDesignPrinciple),
      hintPlan: normalizeHintPlan(r.hintPlan, r.hintRole),
      gradeSuitabilityReason: str(r.gradeSuitabilityReason),
      distinctRoleFromOthers: str(r.distinctRoleFromOthers),
      difficultyReason: str(r.difficultyReason),
    });
  }

  return {
    interpretedGoal: str(obj.interpretedGoal),
    learnerAssumptions: Array.isArray(obj.learnerAssumptions)
      ? (obj.learnerAssumptions.filter((s) => typeof s === 'string') as string[])
      : [],
    itemBlueprints: blueprints,
    coverageSummary: str(obj.coverageSummary),
  };
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Normalize hintPlan. Supports two shapes:
 *   - New: { needed, strategy?, rationale }
 *   - Legacy: hintRole string (from an earlier plan schema). Treated as
 *     needed=true with rationale carrying the original string.
 * Default when missing: needed=false with an explanatory rationale.
 */
function normalizeHintPlan(
  raw: unknown,
  legacyHintRole: unknown,
): { needed: boolean; strategy?: string; rationale: string } {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const needed = typeof r.needed === 'boolean' ? r.needed : false;
    const strategy = typeof r.strategy === 'string' && r.strategy.trim() ? r.strategy.trim() : undefined;
    const rationale =
      typeof r.rationale === 'string' && r.rationale.trim()
        ? r.rationale.trim()
        : needed
          ? '힌트가 사고를 도울 수 있다고 판단'
          : '힌트가 정답을 시사할 위험이 있어 생략';
    return needed ? { needed, strategy, rationale } : { needed, rationale };
  }
  if (typeof legacyHintRole === 'string' && legacyHintRole.trim()) {
    return { needed: true, strategy: legacyHintRole.trim(), rationale: 'legacy hintRole 유지' };
  }
  return {
    needed: false,
    rationale: 'hintPlan 미제공 — 기본적으로 힌트 없이 진행',
  };
}

// ============================================================
// Step 2: Document from Plan
// ============================================================
export type DocResult =
  | {
      ok: true;
      document: LearningDocument;
      durationMs: number;
      inputTokens?: number;
      outputTokens?: number;
    }
  | StepFailure;

export async function generateDocumentFromPlan(
  context: GenerationContext,
  plan: ContentPlan,
): Promise<DocResult> {
  const call = await callOpenAI(v2UserPromptDocumentFromPlan(context, plan), {
    timeoutMs: 60_000,
    maxTokens: 3500,
    temperature: 0.4,
  });
  if (!call.ok) return call;

  let parsed: unknown;
  try {
    parsed = JSON.parse(call.text);
  } catch {
    return { ok: false, reason: 'Document JSON 파싱 실패', errorCode: 'PARSE_ERROR' };
  }

  let document: LearningDocument;
  try {
    document = normalizeLearningDocument(parsed, {
      grade: context.learner.grade as 1 | 2 | 3 | 4 | 5 | 6,
      subject: context.curriculum.subject,
      materialType: context.material.type,
      difficulty: context.request.difficulty as 'easy' | 'normal' | 'hard',
      topic: `${context.curriculum.unit} · ${context.curriculum.topic}`,
    });
  } catch (err) {
    return {
      ok: false,
      reason: `Document 정규화 실패: ${(err as Error).message}`,
      errorCode: 'SCHEMA_ERROR',
    };
  }

  // Blueprint 와 실제 item 개수 정합 확인 (원칙 §8 허용 검증)
  const producedItemIds = new Set(
    document.sections
      .filter((s) => ['question', 'activity'].includes(s.kind))
      .map((s) => (s as { itemId?: string }).itemId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  const planIds = new Set(plan.itemBlueprints.map((b) => b.itemId));
  const missing = Array.from(planIds).filter((id) => !producedItemIds.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Blueprint 대비 미생성 itemId: ${missing.join(', ')}`,
      errorCode: 'SCHEMA_ERROR',
    };
  }

  return {
    ok: true,
    document,
    durationMs: call.durationMs,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
  };
}

// ============================================================
// Step 3: Repair a single item
// ============================================================
export type RepairResult =
  | {
      ok: true;
      section: Section;
      durationMs: number;
      inputTokens?: number;
      outputTokens?: number;
    }
  | StepFailure;

export async function repairItem(
  context: GenerationContext,
  plan: ContentPlan,
  blueprint: ItemBlueprint,
  originalSection: Section,
  reviewReason: string,
  repairInstruction: string,
): Promise<RepairResult> {
  const call = await callOpenAI(
    v2UserPromptRepairItem(
      context,
      plan,
      blueprint,
      originalSection,
      reviewReason,
      repairInstruction,
    ),
    { timeoutMs: 45_000, maxTokens: 1500, temperature: 0.4 },
  );
  if (!call.ok) return call;

  let parsed: unknown;
  try {
    parsed = JSON.parse(call.text);
  } catch {
    return { ok: false, reason: 'Repaired item JSON 파싱 실패', errorCode: 'PARSE_ERROR' };
  }

  const section = normalizeRepairedSection(parsed, blueprint.itemId);
  if (!section) {
    return {
      ok: false,
      reason: 'Repaired item 이 유효한 section 이 아님',
      errorCode: 'SCHEMA_ERROR',
    };
  }

  return {
    ok: true,
    section,
    durationMs: call.durationMs,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
  };
}

/**
 * Repaired item 정규화. 최소 필드 검증만 수행하고 itemId 는 blueprint 값으로 강제.
 * 세부 필드는 normalizeLearningDocument 의 로직과 동일한 원칙을 따르지만 여기서는
 * 하나의 section 만 처리하기 위해 축약형 정규화를 인라인으로 구현.
 */
function normalizeRepairedSection(raw: unknown, blueprintItemId: string): Section | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const kind = s.kind;

  switch (kind) {
    case 'question': {
      const stem = typeof s.stem === 'string' ? s.stem.trim() : '';
      if (!stem) return null;
      const qtype =
        s.qtype === 'ox' ||
        s.qtype === 'mc' ||
        s.qtype === 'short' ||
        s.qtype === 'blank' ||
        s.qtype === 'essay'
          ? (s.qtype as 'ox' | 'mc' | 'short' | 'blank' | 'essay')
          : 'short';
      const choices = Array.isArray(s.choices)
        ? (s.choices.filter((c) => typeof c === 'string') as string[])
        : undefined;
      const answer = typeof s.answer === 'string' ? s.answer : undefined;
      const hint = typeof s.hint === 'string' ? s.hint : undefined;
      const number = typeof s.number === 'number' ? s.number : undefined;
      return {
        kind: 'question',
        itemId: blueprintItemId,
        qtype,
        stem,
        choices,
        answer,
        hint,
        number,
      };
    }
    case 'activity': {
      const steps = Array.isArray(s.steps)
        ? (s.steps.filter((x) => typeof x === 'string') as string[])
        : [];
      if (steps.length === 0) return null;
      const title = typeof s.title === 'string' ? s.title : undefined;
      const materials = Array.isArray(s.materials)
        ? (s.materials.filter((x) => typeof x === 'string') as string[])
        : undefined;
      const estimatedMinutes =
        typeof s.estimatedMinutes === 'number' ? s.estimatedMinutes : undefined;
      return {
        kind: 'activity',
        itemId: blueprintItemId,
        steps,
        title,
        materials,
        estimatedMinutes,
      };
    }
    default:
      return null;
  }
}

// ============================================================
// Legacy: single-shot variant C
// ============================================================
export interface V2Result {
  ok: true;
  document: LearningDocument;
  variant: 'v2C';
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}
export interface V2Failure {
  ok: false;
  reason: string;
  errorCode: StepFailureCode;
}

export async function generateLearningDocumentV2(
  context: GenerationContext,
): Promise<V2Result | V2Failure> {
  const call = await callOpenAI(v2UserPromptSingleShot(context), {
    timeoutMs: 60_000,
    maxTokens: 3000,
    temperature: 0.5,
  });
  if (!call.ok) return call;

  let parsed: unknown;
  try {
    parsed = JSON.parse(call.text);
  } catch {
    return { ok: false, reason: 'V2 AI 응답 JSON 파싱 실패', errorCode: 'PARSE_ERROR' };
  }
  let document: LearningDocument;
  try {
    document = normalizeLearningDocument(parsed, {
      grade: context.learner.grade as 1 | 2 | 3 | 4 | 5 | 6,
      subject: context.curriculum.subject,
      materialType: context.material.type,
      difficulty: context.request.difficulty as 'easy' | 'normal' | 'hard',
      topic: `${context.curriculum.unit} · ${context.curriculum.topic}`,
    });
  } catch (err) {
    return {
      ok: false,
      reason: `V2 결과 정규화 실패: ${(err as Error).message}`,
      errorCode: 'SCHEMA_ERROR',
    };
  }
  return {
    ok: true,
    document,
    variant: 'v2C',
    durationMs: call.durationMs,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
  };
}
