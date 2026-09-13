// kind='learning_doc' job handler — V2 파이프라인 (원칙 §4 / §5 / §6 / §7).
//
// 흐름:
//   1) buildGenerationContext(요청 + 활성 LearningProfile)
//   2) 활성 프로필 없으면 즉시 예외 (사용자 몰래 V1 폴백 금지)
//   3) generateContentPlan(context) — 요청별 출제 설계도 생성
//   4) generateDocumentFromPlan(context, plan) — Plan 을 구현한 Document 생성
//   5) runSemanticReview(context, plan, document) — 독립 검수 (별도 모델)
//   6) 실패 item 각각 repairItem(context, plan, blueprint, section, reason, instruction)
//      — 최대 1회. 성공한 section 만 원래 위치에 병합.
//   7) 재검수. 두 번째도 실패면 결과를 저장하지 않고 예외 (크레딧 환불은 route 가 처리).
//   8) 최종 통과 시 learning_documents INSERT + evaluations 감사 로그 (context/plan snapshot 포함).
//
// V1 (Legacy): handler 흐름에서는 도달하지 않는다. 파일은 남겨둠 (원칙: Legacy 삭제 금지).

import { LearningOrchestratorError, type GenerateResult } from '@/services/learning-orchestrator';
import type { OrchestratorInput } from '@/services/learning-orchestrator/prompts';
import type { LearningDocument } from '@/services/learning-renderer/schema';
import { createSupabaseServiceClient } from '@/services/supabase/server';

import {
  buildGenerationContext,
  type GenerationContext,
} from '@/services/learning-generation/context-builder';
import {
  generateContentPlan,
  generateDocumentFromPlan,
  repairItem,
} from '@/services/learning-orchestrator/orchestrator-v2';
import { runSemanticReview } from '@/services/learning-validators/semantic-review';
import type {
  ContentPlan,
  PipelineTelemetry,
  SemanticReviewResult,
} from '@/services/learning-generation/types';

/**
 * Pipeline error codes (semantic classification — distinct from HTTP status).
 *
 * - unsupported_combination: no active LearningProfile for the request
 * - ai_upstream: OpenAI HTTP error (non-2xx, network)
 * - ai_timeout: OpenAI response exceeded per-step timeout
 * - ai_parse: OpenAI returned malformed JSON or violated schema
 * - quality_check_failed: semantic review rejected the result (after repair)
 * - internal_error: anything else (DB insert, unexpected)
 */
export type LearningPipelineErrorCode =
  | 'unsupported_combination'
  | 'ai_upstream'
  | 'ai_timeout'
  | 'ai_parse'
  | 'quality_check_failed'
  | 'internal_error';

/**
 * Which pipeline stage produced the error.
 */
export type LearningPipelineStage =
  | 'init'
  | 'context'
  | 'plan'
  | 'document'
  | 'review'
  | 'repair'
  | 'save';

export class LearningPipelineError extends Error {
  code: LearningPipelineErrorCode;
  stage: LearningPipelineStage;
  constructor(code: LearningPipelineErrorCode, stage: LearningPipelineStage, message: string) {
    super(message);
    this.code = code;
    this.stage = stage;
    this.name = 'LearningPipelineError';
  }
}

function orchestratorCodeToPipeline(
  code: 'AI_UPSTREAM' | 'AI_TIMEOUT' | 'PARSE_ERROR' | 'SCHEMA_ERROR',
): LearningPipelineErrorCode {
  switch (code) {
    case 'AI_UPSTREAM':
      return 'ai_upstream';
    case 'AI_TIMEOUT':
      return 'ai_timeout';
    case 'PARSE_ERROR':
    case 'SCHEMA_ERROR':
      return 'ai_parse';
    default:
      return 'internal_error';
  }
}

export interface LearningDocJobInput extends OrchestratorInput {
  jobId: string;
  userId: string;
  organizationId: string;
  orgSlug?: string;
  enableV2Override?: boolean;
}

export interface LearningDocJobResult {
  documentId: string;
  document: LearningDocument;
  usage?: GenerateResult['rawUsage'];
  generationMode: 'v1' | 'v2C' | 'v2plan';
  appliedProfileSummary: string;
}

interface FailurePersistInput {
  jobId: string;
  code: LearningPipelineErrorCode;
  stage: LearningPipelineStage;
  message: string;
  context?: GenerationContext;
  plan?: ContentPlan;
  document?: LearningDocument;
  review1?: SemanticReviewResult;
  review2?: SemanticReviewResult;
  telemetry?: PipelineTelemetry;
  tokensIn?: number;
  tokensOut?: number;
}

async function persistFailureRun(input: FailurePersistInput): Promise<void> {
  const service = createSupabaseServiceClient();
  try {
    await service.from('learning_evaluations').insert({
      document_id: null,
      job_id: input.jobId,
      evaluation_stage: 'final',
      attempt: input.review2 ? 2 : 1,
      passed: false,
      run_status: input.code,
      error_stage: input.stage,
      error_code: input.code,
      error_message: input.message.slice(0, 1000),
      summary: `v2plan failure · stage=${input.stage} · code=${input.code}`,
      evaluator_type: 'hybrid',
      profile_snapshot: input.context
        ? {
            variant: 'v2plan',
            profileSetCode: '(from context)',
            scopeChain: input.context.curriculum.profileChain,
            appliedProfileSummary: input.context.appliedProfileSummary,
            hasActiveProfile: input.context.hasActiveProfile,
          }
        : { variant: 'v2plan', hasActiveProfile: false },
      result: {
        context: input.context ?? null,
        plan: input.plan ?? null,
        // document 는 저장하되 학생 원문 노출 위험이 낮은 최소 구조만 (감사·재현 목적).
        document: input.document ?? null,
        review1: input.review1 ?? null,
        review2: input.review2 ?? null,
        telemetry: input.telemetry ?? null,
      },
      input_tokens: input.tokensIn,
      output_tokens: input.tokensOut,
      duration_ms: input.telemetry?.totalMs,
    });
  } catch (err) {
    // 감사 로그 자체 실패는 서비스 흐름을 막지 않고 서버 로그로만 남긴다.
    console.error('[learning-doc] failure audit persist failed:', err);
  }
}

function shouldTryV2(input: LearningDocJobInput): boolean {
  if (input.enableV2Override === true) return true;
  const raw = (process.env.LEARNING_GENERATION_V2 ?? 'false').trim();
  if (raw === 'true' || raw === '1') return true;
  if (raw.startsWith('slug:') && input.orgSlug) {
    const whitelist = raw
      .slice('slug:'.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return whitelist.includes(input.orgSlug);
  }
  return false;
}

export async function runLearningDocJob(
  input: LearningDocJobInput,
): Promise<LearningDocJobResult> {
  const service = createSupabaseServiceClient();
  const pipelineStarted = Date.now();

  await service.from('generation_jobs').update({ status: 'running' }).eq('id', input.jobId);

  if (!shouldTryV2(input)) {
    const msg =
      '학습자료 생성은 활성 프로필이 있는 조합에서만 가능합니다. 지원 학년·과목을 선택해 주세요.';
    await persistFailureRun({
      jobId: input.jobId,
      code: 'unsupported_combination',
      stage: 'init',
      message: msg,
    });
    throw new LearningPipelineError('unsupported_combination', 'init', msg);
  }

  // Step 1: GenerationContext
  const contextStart = Date.now();
  const context = await buildGenerationContext({
    grade: input.grade,
    subject: input.subject,
    materialType: input.materialType,
    unit: input.unit,
    topic: input.topic,
    questionCount: input.questionCount,
    difficulty: input.difficulty,
    additionalRequest: input.additionalRequest,
  });
  const contextBuildMs = Date.now() - contextStart;

  if (!context.hasActiveProfile) {
    const msg = `${input.grade}학년 ${input.subject} · "${input.unit}"에 활성 프로필이 없어요. 지원 학년·과목·단원을 선택해 주세요.`;
    await persistFailureRun({
      jobId: input.jobId,
      code: 'unsupported_combination',
      stage: 'context',
      message: msg,
      context,
    });
    throw new LearningPipelineError('unsupported_combination', 'context', msg);
  }

  // Step 2: ContentPlan
  const planResult = await generateContentPlan(context);
  if (!planResult.ok) {
    const msg = `ContentPlan 실패: ${planResult.reason}`;
    await persistFailureRun({
      jobId: input.jobId,
      code: orchestratorCodeToPipeline(planResult.errorCode),
      stage: 'plan',
      message: msg,
      context,
    });
    throw new LearningPipelineError(
      orchestratorCodeToPipeline(planResult.errorCode),
      'plan',
      msg,
    );
  }
  const plan = planResult.plan;

  // Step 3: Document from Plan
  const docResult = await generateDocumentFromPlan(context, plan);
  if (!docResult.ok) {
    const msg = `Document 생성 실패: ${docResult.reason}`;
    await persistFailureRun({
      jobId: input.jobId,
      code: orchestratorCodeToPipeline(docResult.errorCode),
      stage: 'document',
      message: msg,
      context,
      plan,
    });
    throw new LearningPipelineError(
      orchestratorCodeToPipeline(docResult.errorCode),
      'document',
      msg,
    );
  }
  let document = docResult.document;

  // Step 4: Semantic Review (독립 검수)
  const review1 = await runSemanticReview({ context, plan, document });

  // Step 5: Partial Regeneration (실패 item 최대 1회)
  let review2: SemanticReviewResult | null = null;
  let repairMs: number | undefined;
  let repairTokensIn = 0;
  let repairTokensOut = 0;

  if (!review1.pass && review1.items.length > 0 && !review1.reviewerFailure) {
    const repairStart = Date.now();
    const failedItems = review1.items.filter((it) => !it.pass);

    let anyRepaired = false;
    for (const failed of failedItems) {
      const blueprint = plan.itemBlueprints.find((b) => b.itemId === failed.itemId);
      const idxInSections = document.sections.findIndex(
        (s) => (s as { itemId?: string }).itemId === failed.itemId,
      );
      if (!blueprint || idxInSections < 0) continue;
      const originalSection = document.sections[idxInSections]!;

      const rep = await repairItem(
        context,
        plan,
        blueprint,
        originalSection,
        failed.reason,
        failed.repairInstruction,
      );
      if (!rep.ok) {
        console.warn('[learning-doc] repair failed for', failed.itemId, rep.reason);
        continue;
      }
      document = {
        ...document,
        sections: document.sections.map((s, i) => (i === idxInSections ? rep.section : s)),
      };
      anyRepaired = true;
      repairTokensIn += rep.inputTokens ?? 0;
      repairTokensOut += rep.outputTokens ?? 0;
    }

    repairMs = Date.now() - repairStart;

    if (anyRepaired) {
      review2 = await runSemanticReview({ context, plan, document });
    }
  }

  const finalReview = review2 ?? review1;

  // Step 6: 최종 판정 — 품질 검수 실패 (외부 장애와 구분되는 코드)
  if (!finalReview.pass && !finalReview.reviewerFailure) {
    const failCount = finalReview.items.filter((it) => !it.pass).length;
    const msg = `학습자료 품질 검수에서 ${failCount}개 항목이 통과하지 못했어요.`;

    const failureTelemetry: PipelineTelemetry = {
      contextBuildMs,
      planMs: planResult.durationMs,
      docMs: docResult.durationMs,
      reviewMs: review1.durationMs,
      repairMs,
      reviewMs2: review2?.durationMs,
      totalMs: Date.now() - pipelineStarted,
      planTokens: { in: planResult.inputTokens ?? 0, out: planResult.outputTokens ?? 0 },
      docTokens: { in: docResult.inputTokens ?? 0, out: docResult.outputTokens ?? 0 },
      reviewTokens: {
        in: (review1.inputTokens ?? 0) + (review2?.inputTokens ?? 0),
        out: (review1.outputTokens ?? 0) + (review2?.outputTokens ?? 0),
      },
      repairTokens: repairMs ? { in: repairTokensIn, out: repairTokensOut } : undefined,
    };

    await persistFailureRun({
      jobId: input.jobId,
      code: 'quality_check_failed',
      stage: review2 ? 'repair' : 'review',
      message: `${msg} (${finalReview.reason.slice(0, 200)})`,
      context,
      plan,
      document,
      review1,
      review2: review2 ?? undefined,
      telemetry: failureTelemetry,
      tokensIn:
        (planResult.inputTokens ?? 0) +
        (docResult.inputTokens ?? 0) +
        (review1.inputTokens ?? 0) +
        (review2?.inputTokens ?? 0) +
        repairTokensIn,
      tokensOut:
        (planResult.outputTokens ?? 0) +
        (docResult.outputTokens ?? 0) +
        (review1.outputTokens ?? 0) +
        (review2?.outputTokens ?? 0) +
        repairTokensOut,
    });

    throw new LearningPipelineError('quality_check_failed', review2 ? 'repair' : 'review', msg);
  }

  // Step 7: 저장 + 감사 로그
  const topicForStorage = `${input.unit} · ${input.topic}`;
  const { data: docRow, error: docErr } = await service
    .from('learning_documents')
    .insert({
      user_id: input.userId,
      organization_id: input.organizationId,
      title: document.meta.title,
      grade: input.grade,
      subject_code: input.subject,
      material_type_code: input.materialType,
      topic: topicForStorage,
      difficulty: input.difficulty,
      question_count: input.questionCount,
      document_json: document,
    })
    .select('id')
    .single();

  if (docErr || !docRow) {
    throw new Error(`learning_documents insert 실패: ${docErr?.message ?? 'unknown'}`);
  }
  const documentId = (docRow as { id: string }).id;

  const telemetry: PipelineTelemetry = {
    contextBuildMs,
    planMs: planResult.durationMs,
    docMs: docResult.durationMs,
    reviewMs: review1.durationMs,
    repairMs,
    reviewMs2: review2?.durationMs,
    totalMs: Date.now() - pipelineStarted,
    planTokens: {
      in: planResult.inputTokens ?? 0,
      out: planResult.outputTokens ?? 0,
    },
    docTokens: {
      in: docResult.inputTokens ?? 0,
      out: docResult.outputTokens ?? 0,
    },
    reviewTokens: {
      in: (review1.inputTokens ?? 0) + (review2?.inputTokens ?? 0),
      out: (review1.outputTokens ?? 0) + (review2?.outputTokens ?? 0),
    },
    repairTokens: repairMs ? { in: repairTokensIn, out: repairTokensOut } : undefined,
  };

  try {
    await service.from('learning_evaluations').insert({
      document_id: documentId,
      evaluation_stage: 'final',
      attempt: review2 ? 2 : 1,
      passed: finalReview.pass,
      summary: `v2plan · ${context.appliedProfileSummary} · review1=${review1.pass}${review2 ? ` · review2=${review2.pass}` : ''}`,
      evaluator_type: 'hybrid',
      profile_snapshot: {
        variant: 'v2plan',
        profileSetCode: '(from context)',
        scopeChain: context.curriculum.profileChain,
        appliedProfileSummary: context.appliedProfileSummary,
        hasActiveProfile: context.hasActiveProfile,
      },
      result: {
        context,
        plan: {
          interpretedGoal: plan.interpretedGoal,
          learnerAssumptionsCount: plan.learnerAssumptions.length,
          itemBlueprintCount: plan.itemBlueprints.length,
          coverageSummary: plan.coverageSummary,
          blueprints: plan.itemBlueprints,
        },
        review1: {
          pass: review1.pass,
          reason: review1.reason,
          failedItemIndexes: review1.failedItemIndexes,
          items: review1.items,
          reviewerFailure: review1.reviewerFailure,
        },
        review2: review2
          ? {
              pass: review2.pass,
              reason: review2.reason,
              failedItemIndexes: review2.failedItemIndexes,
              items: review2.items,
              reviewerFailure: review2.reviewerFailure,
            }
          : null,
        telemetry,
      },
      input_tokens:
        (planResult.inputTokens ?? 0) +
        (docResult.inputTokens ?? 0) +
        (review1.inputTokens ?? 0) +
        (review2?.inputTokens ?? 0) +
        repairTokensIn,
      output_tokens:
        (planResult.outputTokens ?? 0) +
        (docResult.outputTokens ?? 0) +
        (review1.outputTokens ?? 0) +
        (review2?.outputTokens ?? 0) +
        repairTokensOut,
      duration_ms: telemetry.totalMs,
    });
  } catch (persistErr) {
    console.error('[learning-doc] v2plan evaluation persist failed (non-fatal):', persistErr);
  }

  await service
    .from('generation_jobs')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
      learning_document_id: documentId,
    })
    .eq('id', input.jobId);

  return {
    documentId,
    document,
    usage: {
      promptTokens:
        (planResult.inputTokens ?? 0) +
        (docResult.inputTokens ?? 0) +
        (review1.inputTokens ?? 0) +
        (review2?.inputTokens ?? 0) +
        repairTokensIn,
      completionTokens:
        (planResult.outputTokens ?? 0) +
        (docResult.outputTokens ?? 0) +
        (review1.outputTokens ?? 0) +
        (review2?.outputTokens ?? 0) +
        repairTokensOut,
    },
    generationMode: 'v2plan',
    appliedProfileSummary: context.appliedProfileSummary,
  };
}
