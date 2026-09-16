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
import {
  generateCompositionPlan,
  type AppliedComposition,
  type PageCompositionPlan,
} from '@/services/learning-composition';
import { buildAppliedComposition, buildBlockToSection } from '@/services/learning-renderer/composition-render';
import { reviewLayout, type LayoutReviewResult } from '@/services/learning-validators/layout-review';
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
  worksheetPlan?: WorksheetPlan;
  compositionPlan?: PageCompositionPlan;
  appliedComposition?: AppliedComposition;
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

  // Step 2.5: WorksheetPlan — Stage 4 활동형 학습지 조판 계획. **필수** — 실패 시 파이프라인 종료.
  const worksheetStart = Date.now();
  let worksheetPlanTokensIn = 0;
  let worksheetPlanTokensOut = 0;
  const wpResult = await generateWorksheetPlan(context, plan);
  if (!wpResult.ok) {
    const msg = `WorksheetPlan 실패: ${wpResult.reason}`;
    await persistFailureRun({
      jobId: input.jobId,
      code: orchestratorCodeToPipeline(wpResult.errorCode),
      stage: 'plan',
      message: msg,
      context,
      plan,
    });
    throw new LearningPipelineError(
      orchestratorCodeToPipeline(wpResult.errorCode),
      'plan',
      msg,
    );
  }
  const worksheetPlan: WorksheetPlan = wpResult.plan;
  worksheetPlanTokensIn = wpResult.inputTokens ?? 0;
  worksheetPlanTokensOut = wpResult.outputTokens ?? 0;
  const worksheetMs = Date.now() - worksheetStart;

  // Step 2.6: PageCompositionPlan — layout primitive 배치 계획. **필수**.
  const compositionStart = Date.now();
  let compositionTokensIn = 0;
  let compositionTokensOut = 0;
  const cpResult = await generateCompositionPlan(context, plan, worksheetPlan);
  if (!cpResult.ok) {
    const msg = `CompositionPlan 실패: ${cpResult.reason}`;
    await persistFailureRun({
      jobId: input.jobId,
      code: orchestratorCodeToPipeline(cpResult.errorCode),
      stage: 'plan',
      message: msg,
      context,
      plan,
    });
    throw new LearningPipelineError(
      orchestratorCodeToPipeline(cpResult.errorCode),
      'plan',
      msg,
    );
  }
  const compositionPlan: PageCompositionPlan = cpResult.plan;
  compositionTokensIn = cpResult.inputTokens ?? 0;
  compositionTokensOut = cpResult.outputTokens ?? 0;
  const compositionMs = Date.now() - compositionStart;

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
  // Step 6.5: CompositionPlan.pages.blocks 순회하여 visualSlot.needed=true 인 블록에만
  // 이미지 생성. 이미지는 활동 블록 안에 소유 (standalone section 자동 삽입 없음).
  const blockToImages = new Map<string, string[]>();
  try {
    for (const page of compositionPlan.pages) {
      for (const block of page.blocks) {
        if (!block.visualSlot.needed) continue;
        const count = block.visualSlot.count ?? 1;
        // 이 블록이 참조하는 blueprint (첫 번째) 의 visualPlan 을 사용해 이미지 생성.
        // blueprint 자체의 visualPlan 이 null 이면 CompositionBlock.visualSlot.hint 로 fallback.
        const blueprintId = block.sourceItemIds[0];
        const blueprint = blueprintId
          ? plan.itemBlueprints.find((b) => b.itemId === blueprintId)
          : undefined;
        const vp =
          blueprint?.visualPlan ??
          buildFallbackVisualPlanFromSlot(block.visualSlot, count);
        const itemContext = {
          stem:
            (blueprintId &&
              document.sections
                .map((s) => s as { itemId?: string; stem?: string })
                .find((s) => s.itemId === blueprintId)?.stem) ??
            block.instruction,
          answer: undefined,
          hint: undefined,
        };

        const accepted: string[] = [];
        for (let slot = 0; slot < count; slot++) {
          let visual: GeneratedVisual | null = null;
          try {
            visual = await generateVisual({
              itemId: block.blockId,
              visualPlan: vp,
              userId: input.userId,
              organizationId: input.organizationId,
              slotIndex: slot,
            });
          } catch (genErr) {
            console.warn('[learning-doc] visual gen failed:', block.blockId, slot, genErr);
          }
          if (!visual) continue;
          const rv1 = await reviewClipart({
            itemId: block.blockId,
            visualPlan: vp,
            imageUrl: visual.publicUrl,
            itemContext,
          });
          if (rv1.pass) {
            accepted.push(visual.publicUrl);
            clipartUsages.push({
              itemId: blueprintId ?? block.blockId,
              slotIndex: slot,
              visual,
              reviewStatus: 'pass',
              reviewReason: rv1.reason,
              sectionPosition: -1,
            });
            continue;
          }
          generatedButUnused.push(visual);
          // 1회 재생성.
          let retry: GeneratedVisual | null = null;
          try {
            retry = await generateVisual({
              itemId: block.blockId,
              visualPlan: vp,
              userId: input.userId,
              organizationId: input.organizationId,
              slotIndex: slot,
            });
          } catch (genErr) {
            console.warn('[learning-doc] visual retry failed:', block.blockId, slot, genErr);
          }
          if (!retry) continue;
          const rv2 = await reviewClipart({
            itemId: block.blockId,
            visualPlan: vp,
            imageUrl: retry.publicUrl,
            itemContext,
          });
          if (rv2.pass) {
            accepted.push(retry.publicUrl);
            clipartUsages.push({
              itemId: blueprintId ?? block.blockId,
              slotIndex: slot,
              visual: retry,
              reviewStatus: 'retry_pass',
              reviewReason: rv2.reason,
              sectionPosition: -1,
            });
          } else {
            generatedButUnused.push(retry);
          }
        }
        if (accepted.length > 0) {
          blockToImages.set(block.blockId, accepted);
        }
      }
    }
  } catch (clipartErr) {
    console.warn('[learning-doc] visual pipeline error (non-fatal):', clipartErr);
  }

  // Step 6.5b: composition 파이프라인에서 이미지는 blockToImages 로 소유되므로,
  // Doc AI 가 남긴 "__will_be_replaced__" placeholder 는 renderer 가 사용하지 않는다.
  // Layout Review 가 잔존 placeholder 를 이슈로 잡지 않도록, section-level
  // imageAssetRef 필드에서 placeholder 문자열을 제거한다 (구조 유지, 값만 정리).
  document = scrubPlaceholderImageRefs(document);

  // Step 6.6: AppliedComposition 스냅샷 조립 (감사·Layout Review 입력).
  const appliedComposition: AppliedComposition = buildAppliedComposition(
    compositionPlan,
    document,
    blockToImages,
  );

  // Step 6.7: Layout Review — 정적 검사 (렌더 전 · 조판 정합성 판정).
  // 실제 PDF 렌더는 별도 endpoint 에서 이루어지므로 여기서는 감사 로그용 정적 검사만.
  // PDF 렌더 후 재검사는 renderer route 에서 추가 예정 (M4 이후).
  let layoutReview: LayoutReviewResult | undefined;
  try {
    const dummyPdf = Buffer.alloc(0); // 렌더 이전이라 PDF 없음 — page count 등 PDF 지표는 검사 제외.
    layoutReview = reviewLayout({
      applied: appliedComposition,
      document,
      pdfBytes: dummyPdf,
      variant: 'student',
    });
    if (!layoutReview.pass) {
      console.warn(
        '[learning-doc] Layout Review issues (non-fatal, saved to audit):',
        layoutReview.issues.map((x) => `${x.code}@${x.where}`).join(' · '),
      );
    }
  } catch (lrErr) {
    console.warn('[learning-doc] Layout Review exception (non-fatal):', lrErr);
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
      worksheet_plan_snapshot: worksheetPlan,
      composition_plan_snapshot: compositionPlan,
      applied_composition_snapshot: appliedComposition,
      layout_review_result: layoutReview ?? null,
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
    worksheetPlan,
    compositionPlan,
    appliedComposition,
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
// composition 기반 이미지 파이프라인 fallback: blueprint.visualPlan 이 없는 경우
// CompositionBlock.visualSlot 만으로 image-gen 프롬프트를 만들 수 있도록 최소 VisualPlan 생성.
function buildFallbackVisualPlanFromSlot(
  slot: { hint?: string; role?: string; count?: number },
  count: number,
): import('@/services/learning-generation/types').VisualPlan {
  const roleLabel = slot.role ?? 'illustration';
  const subject = slot.hint || `${roleLabel} 이미지`;
  return {
    purpose: `학생 활동을 시각적으로 지원 (${roleLabel})`,
    studentObservation: '이미지를 관찰하여 활동에 반영',
    subjectMatter: subject,
    imageCount: count,
    educationalRoles: Array.from({ length: count }, () => roleLabel),
    composition: '중앙 정렬, 배경 최소화',
    ageAppropriateStyle: '학년 수준에 맞는 단순한 표현',
    textPolicy: '이미지 안에 문자 넣지 않기',
    answerLeakPolicy: '정답 단어·기호를 이미지 안에 넣지 않기',
    styleGuide: '우리학교 클립아트 스타일: 단순하고 밝은 색, 웃는 표정, 배경 최소화',
  };
}

// composition 파이프라인은 blockToImages 로 이미지를 소유한다. section 안의
// imageAssetRef 필드는 이제 placeholder 문자열을 담을 이유가 없으므로 제거한다.
// 파일 URL (https://..., data:..., blob:...) 은 그대로 유지 — legacy Doc AI 가
// 정상 URL 을 넣어놨다면 renderer 가 fallback 으로 활용할 수 있다.
const PLACEHOLDER_REF = '__will_be_replaced__';
function isRealUrl(v: unknown): boolean {
  return typeof v === 'string' && (v.startsWith('http') || v.startsWith('data:') || v.startsWith('blob:'));
}
function stripRef<T extends { imageAssetRef?: string }>(x: T): T {
  if (x.imageAssetRef === PLACEHOLDER_REF || (x.imageAssetRef && !isRealUrl(x.imageAssetRef))) {
    const { imageAssetRef: _r, ...rest } = x;
    void _r;
    return rest as T;
  }
  return x;
}
function scrubPlaceholderImageRefs(doc: LearningDocument): LearningDocument {
  const sections = doc.sections.map((sec) => {
    switch (sec.kind) {
      case 'picture-choice':
        return { ...sec, choices: sec.choices.map((c) => stripRef(c)) };
      case 'matching':
        return {
          ...sec,
          leftColumn: sec.leftColumn.map((c) => stripRef(c)),
          rightColumn: sec.rightColumn.map((c) => stripRef(c)),
        };
      case 'classification':
        return { ...sec, items: sec.items.map((c) => stripRef(c)) };
      case 'guided-practice':
        return {
          ...sec,
          workedExample: stripRef(sec.workedExample),
          practiceProblems: sec.practiceProblems.map((c) => stripRef(c)),
        };
      case 'independent-practice':
        return { ...sec, problems: sec.problems.map((c) => stripRef(c)) };
      case 'sequence':
        return { ...sec, items: sec.items.map((c) => stripRef(c)) };
      case 'observation': {
        // observation.imageAssetRef 은 필수 필드이므로 placeholder 여도 값은 유지
        // 하되, real URL 이 아니면 빈 문자열로 눌러 renderer 가 blockToImages 에
        // 완전히 의존하도록 만든다.
        if (sec.imageAssetRef === PLACEHOLDER_REF || (sec.imageAssetRef && !isRealUrl(sec.imageAssetRef))) {
          return { ...sec, imageAssetRef: '' };
        }
        return sec;
      }
      default:
        return sec;
    }
  });
  return { ...doc, sections };
}
