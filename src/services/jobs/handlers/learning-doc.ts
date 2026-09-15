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
import { generateVisual, type GeneratedVisual } from '@/services/learning-clipart-gen';
import { reviewClipart } from '@/services/learning-clipart-review';
import { deleteObject } from '@/services/r2/upload';
import { generateWorksheetPlan, type WorksheetPlan } from '@/services/learning-worksheet';
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
  /** 자동 삽입된 클립아트 개수 (라이브러리 매칭 수). */
  clipartInsertedCount?: number;
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
    clipartMode: input.clipartMode,
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

  // Step 2.5: WorksheetPlan — Stage 4 활동형 학습지 조판 계획.
  // 실패해도 Doc 생성이 이전 스타일 (기본 question/activity 나열) 로 진행 가능하도록 non-fatal.
  let worksheetPlan: WorksheetPlan | undefined;
  const worksheetStart = Date.now();
  let worksheetMs = 0;
  let worksheetPlanTokensIn = 0;
  let worksheetPlanTokensOut = 0;
  try {
    const wpResult = await generateWorksheetPlan(context, plan);
    if (wpResult.ok) {
      worksheetPlan = wpResult.plan;
      worksheetPlanTokensIn = wpResult.inputTokens ?? 0;
      worksheetPlanTokensOut = wpResult.outputTokens ?? 0;
    } else {
      console.warn(
        '[learning-doc] WorksheetPlan generation failed (falling back to legacy Doc):',
        wpResult.reason,
      );
    }
  } catch (wpErr) {
    console.warn('[learning-doc] WorksheetPlan exception (non-fatal):', wpErr);
  }
  worksheetMs = Date.now() - worksheetStart;

  // Step 3: Document from Plan (WorksheetPlan 있으면 활동형 스키마로 생성)
  const docResult = await generateDocumentFromPlan(context, plan, worksheetPlan);
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

  // 구조적 hintPlan 준수 강제: blueprint.hintPlan.needed === false 인 문항의 hint 필드 제거.
  // AI 가 계약을 어기고 빈/의미없는 hint 를 추가한 경우 reviewer 가 반복적으로 hintQuality
  // 실패로 판정하는 노이즈를 원천 차단한다 (특정 과목·정답 문자열에 의존하지 않는 일반 규칙).
  document = {
    ...document,
    sections: document.sections.map((sec) => {
      if (sec.kind !== 'question') return sec;
      const secItemId = (sec as { itemId?: string }).itemId;
      if (!secItemId) return sec;
      const bp = plan.itemBlueprints.find((b) => b.itemId === secItemId);
      if (!bp || bp.hintPlan.needed !== false) return sec;
      if (!('hint' in sec) || (sec as { hint?: string }).hint === undefined) return sec;
      const { hint: _hint, ...rest } = sec as typeof sec & { hint?: string };
      void _hint;
      return rest;
    }),
  };

  interface UsedClipart {
    itemId: string;
    slotIndex: number;
    visual: GeneratedVisual;
    reviewStatus: 'pass' | 'retry_pass';
    reviewReason: string;
    sectionPosition: number;
  }
  const clipartUsages: UsedClipart[] = [];

  // Step 4: Semantic Review (텍스트 검수 — 이미지 생성 이전, 비용 절감)
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

  // Step 6.5: 텍스트 검수 통과 후에만 VisualPlan → 신규 클립아트 생성 → Vision Review → 배치.
  //   - 유료 이미지 생성은 텍스트 품질이 확정된 뒤에만 실행 (비용 절감).
  //   - blueprint.visualPlan 이 non-null 이면 최종 문항 텍스트를 함께 Vision Review 에 전달.
  //   - Vision 검수 실패 시 최대 1회 재생성. 통과 이미지만 문항 뒤에 삽입.
  //   - 검수 실패로 최종에 쓰이지 않은 이미지는 R2 + images 테이블에서 삭제 (라이브러리에 남기지 않음).
  const generatedButUnused: GeneratedVisual[] = [];
  try {
    const perItemVisuals = new Map<string, GeneratedVisual[]>();
    const perItemReviews = new Map<
      string,
      Array<{ status: 'pass' | 'retry_pass'; reason: string }>
    >();

    for (const blueprint of plan.itemBlueprints) {
      if (!blueprint.visualPlan) continue;
      const vp = blueprint.visualPlan;
      const sectionForItem = document.sections.find(
        (s) => (s as { itemId?: string }).itemId === blueprint.itemId,
      );
      const itemContext = {
        stem:
          sectionForItem && (sectionForItem as { stem?: string }).stem
            ? String((sectionForItem as { stem?: string }).stem)
            : blueprint.studentTask,
        answer:
          sectionForItem && (sectionForItem as { answer?: string }).answer
            ? String((sectionForItem as { answer?: string }).answer)
            : undefined,
        hint:
          sectionForItem && (sectionForItem as { hint?: string }).hint
            ? String((sectionForItem as { hint?: string }).hint)
            : undefined,
      };

      const acceptedVisuals: GeneratedVisual[] = [];
      const reviewLog: Array<{ status: 'pass' | 'retry_pass'; reason: string }> = [];
      for (let slot = 0; slot < vp.imageCount; slot++) {
        let visual: GeneratedVisual;
        try {
          visual = await generateVisual({
            itemId: blueprint.itemId,
            visualPlan: vp,
            userId: input.userId,
            organizationId: input.organizationId,
            slotIndex: slot,
          });
        } catch (genErr) {
          console.warn('[learning-doc] visual gen failed:', blueprint.itemId, slot, genErr);
          continue;
        }

        const rv1 = await reviewClipart({
          itemId: blueprint.itemId,
          visualPlan: vp,
          imageUrl: visual.publicUrl,
          itemContext,
        });

        if (rv1.pass) {
          acceptedVisuals.push(visual);
          reviewLog.push({ status: 'pass', reason: rv1.reason });
          continue;
        }
        // review1 실패 이미지는 최종 미사용으로 마킹.
        generatedButUnused.push(visual);

        let retryVisual: GeneratedVisual | null = null;
        try {
          retryVisual = await generateVisual({
            itemId: blueprint.itemId,
            visualPlan: vp,
            userId: input.userId,
            organizationId: input.organizationId,
            slotIndex: slot,
          });
        } catch (genErr) {
          console.warn(
            '[learning-doc] visual retry gen failed:',
            blueprint.itemId,
            slot,
            genErr,
          );
        }
        if (!retryVisual) continue;

        const rv2 = await reviewClipart({
          itemId: blueprint.itemId,
          visualPlan: vp,
          imageUrl: retryVisual.publicUrl,
          itemContext,
        });
        if (rv2.pass) {
          acceptedVisuals.push(retryVisual);
          reviewLog.push({ status: 'retry_pass', reason: rv2.reason });
        } else {
          // retry 도 실패 → 최종 미사용.
          generatedButUnused.push(retryVisual);
        }
      }

      if (acceptedVisuals.length > 0) {
        perItemVisuals.set(blueprint.itemId, acceptedVisuals);
        perItemReviews.set(blueprint.itemId, reviewLog);
      }
    }

    if (perItemVisuals.size > 0) {
      // Stage 4: 활동 블록에 __will_be_replaced__ placeholder 가 있으면 인라인 치환.
      // 남은 경우 (레거시 question/activity) 는 뒤에 kind:'image' section 삽입.
      const nextSections: typeof document.sections = [];
      const inlinedForItem = new Set<string>();
      for (const sec of document.sections) {
        const secItemId = (sec as { itemId?: string }).itemId;
        let modified: typeof sec = sec;
        if (secItemId && perItemVisuals.has(secItemId)) {
          const visuals = perItemVisuals.get(secItemId)!;
          modified = inlineReplaceVisuals(sec, visuals);
          if (modified !== sec) {
            inlinedForItem.add(secItemId);
          }
        }
        nextSections.push(modified);
        if (!secItemId) continue;
        if (inlinedForItem.has(secItemId)) {
          // 인라인 치환 성공 → 별도 image 섹션 추가하지 않음.
          const visuals = perItemVisuals.get(secItemId)!;
          const reviews = perItemReviews.get(secItemId) ?? [];
          visuals.forEach((v, i) => {
            const rev = reviews[i] ?? { status: 'pass' as const, reason: '' };
            clipartUsages.push({
              itemId: secItemId,
              slotIndex: v.slotIndex,
              visual: v,
              reviewStatus: rev.status,
              reviewReason: rev.reason,
              sectionPosition: nextSections.length - 1,
            });
          });
          continue;
        }
        const visuals = perItemVisuals.get(secItemId);
        const reviews = perItemReviews.get(secItemId);
        if (!visuals || visuals.length === 0) continue;
        visuals.forEach((v, i) => {
          const sectionPosition = nextSections.length;
          nextSections.push({
            kind: 'image',
            source: 'external',
            assetRef: v.publicUrl,
            widthPct: 45,
          });
          const rev = reviews?.[i] ?? { status: 'pass' as const, reason: '' };
          clipartUsages.push({
            itemId: secItemId,
            slotIndex: v.slotIndex,
            visual: v,
            reviewStatus: rev.status,
            reviewReason: rev.reason,
            sectionPosition,
          });
        });
      }
      document = { ...document, sections: nextSections };
    }
  } catch (clipartErr) {
    console.warn('[learning-doc] visual pipeline error (non-fatal):', clipartErr);
  }

  // Step 6.6: 최종 미사용 (Vision 검수 실패) 이미지 정리.
  //   - R2 object 삭제 + images 테이블 삭제.
  //   - 최종 자료에 사용하지 않은 실패 이미지는 라이브러리에 남기지 않는다 (사용자 지침).
  //   - 정리 실패는 서비스 흐름을 막지 않는다 (감사 로그로만).
  if (generatedButUnused.length > 0) {
    await Promise.all(
      generatedButUnused.map(async (v) => {
        try {
          await deleteObject(v.r2Key);
        } catch (e) {
          console.warn('[learning-doc] unused R2 delete failed:', v.r2Key, e);
        }
        try {
          await service.from('images').delete().eq('id', v.imageId);
        } catch (e) {
          console.warn('[learning-doc] unused images row delete failed:', v.imageId, e);
        }
      }),
    );
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

  // Step 7.5: 클립아트 사용 이력 저장 (감사·재사용 추적)
  if (clipartUsages.length > 0) {
    try {
      const usageRows = clipartUsages.map((u) => ({
        document_id: documentId,
        item_id: u.itemId,
        image_id: u.visual.imageId,
        source: 'generated',
        hint: null,
        section_position: u.sectionPosition,
        visual_plan_snapshot:
          plan.itemBlueprints.find((b) => b.itemId === u.itemId)?.visualPlan ?? null,
        review_status: u.reviewStatus,
        review_reason: u.reviewReason.slice(0, 500),
      }));
      await service.from('learning_document_clipart_usage').insert(usageRows);
    } catch (usageErr) {
      console.error(
        '[learning-doc] clipart usage persist failed (non-fatal):',
        usageErr,
      );
    }
  }

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
    clipartInsertedCount: clipartUsages.length,
  };
}

// ============================================================
// Stage 4 인라인 이미지 치환 헬퍼.
//
// 활동 블록 (picture-choice / observation / matching / classification / sequence /
// guided-practice / independent-practice) 은 이미지 자체가 블록 안에 삽입된다.
// Plan/Doc 은 자리표시자 "__will_be_replaced__" 를 두고, 이 함수가 실제 R2 URL 로 치환한다.
// 치환한 경우 원본과 다른 객체를 반환; 치환할 곳이 없으면 원본 그대로 반환.
// ============================================================
function inlineReplaceVisuals<T extends { kind: string }>(
  section: T,
  visuals: Array<{ publicUrl: string }>,
): T {
  const urls = visuals.map((v) => v.publicUrl);
  if (urls.length === 0) return section;
  let cursor = 0;
  // 유일한 URL 배분. 남는 placeholder 는 undefined 로 두어 label-only 로 렌더 (중복 이미지 방지).
  const takeUrl = (): string | undefined =>
    cursor < urls.length ? urls[cursor++]! : undefined;

  const isPlaceholder = (v: unknown): boolean =>
    typeof v === 'string' && v === '__will_be_replaced__';

  switch (section.kind) {
    case 'picture-choice': {
      const s = section as unknown as import('@/services/learning-renderer/schema').Section & {
        kind: 'picture-choice';
      };
      let mutated = false;
      const choices = s.choices.map((c) => {
        if (isPlaceholder(c.imageAssetRef)) {
          mutated = true;
          const url = takeUrl();
          return { ...c, imageAssetRef: url };
        }
        return c;
      });
      return mutated ? ({ ...s, choices } as unknown as T) : section;
    }
    case 'observation': {
      const s = section as unknown as import('@/services/learning-renderer/schema').Section & {
        kind: 'observation';
      };
      if (isPlaceholder(s.imageAssetRef)) {
        const url = takeUrl();
        // observation 은 이미지 없이는 무의미하므로 URL 이 없으면 원본 유지 (렌더러가 오류 처리).
        if (url) return { ...s, imageAssetRef: url } as unknown as T;
      }
      return section;
    }
    case 'matching': {
      const s = section as unknown as import('@/services/learning-renderer/schema').Section & {
        kind: 'matching';
      };
      let mutated = false;
      const left = s.leftColumn.map((x) => {
        if (isPlaceholder(x.imageAssetRef)) {
          mutated = true;
          const url = takeUrl();
          return { ...x, imageAssetRef: url };
        }
        return x;
      });
      const right = s.rightColumn.map((x) => {
        if (isPlaceholder(x.imageAssetRef)) {
          mutated = true;
          const url = takeUrl();
          return { ...x, imageAssetRef: url };
        }
        return x;
      });
      return mutated ? ({ ...s, leftColumn: left, rightColumn: right } as unknown as T) : section;
    }
    case 'classification': {
      const s = section as unknown as import('@/services/learning-renderer/schema').Section & {
        kind: 'classification';
      };
      let mutated = false;
      const items = s.items.map((x) => {
        if (isPlaceholder(x.imageAssetRef)) {
          mutated = true;
          const url = takeUrl();
          return { ...x, imageAssetRef: url };
        }
        return x;
      });
      return mutated ? ({ ...s, items } as unknown as T) : section;
    }
    case 'sequence': {
      const s = section as unknown as import('@/services/learning-renderer/schema').Section & {
        kind: 'sequence';
      };
      let mutated = false;
      const items = s.items.map((x) => {
        if (isPlaceholder(x.imageAssetRef)) {
          mutated = true;
          const url = takeUrl();
          return { ...x, imageAssetRef: url };
        }
        return x;
      });
      return mutated ? ({ ...s, items } as unknown as T) : section;
    }
    case 'guided-practice': {
      const s = section as unknown as import('@/services/learning-renderer/schema').Section & {
        kind: 'guided-practice';
      };
      let mutated = false;
      let workedExample = s.workedExample;
      if (isPlaceholder(workedExample.imageAssetRef)) {
        mutated = true;
        const url = takeUrl();
        workedExample = { ...workedExample, imageAssetRef: url };
      }
      const practiceProblems = s.practiceProblems.map((p) => {
        if (isPlaceholder(p.imageAssetRef)) {
          mutated = true;
          const url = takeUrl();
          return { ...p, imageAssetRef: url };
        }
        return p;
      });
      return mutated
        ? ({ ...s, workedExample, practiceProblems } as unknown as T)
        : section;
    }
    case 'independent-practice': {
      const s = section as unknown as import('@/services/learning-renderer/schema').Section & {
        kind: 'independent-practice';
      };
      let mutated = false;
      const problems = s.problems.map((p) => {
        if (isPlaceholder(p.imageAssetRef)) {
          mutated = true;
          const url = takeUrl();
          return { ...p, imageAssetRef: url };
        }
        return p;
      });
      return mutated ? ({ ...s, problems } as unknown as T) : section;
    }
    default:
      return section;
  }
}
