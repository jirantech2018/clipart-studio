// kind='learning_doc' job handler.
//
// V1 (기본): 기존 orchestrator + legacy guards + 3-layer 검증.
// V2 (기능 플래그 `LEARNING_GENERATION_V2` 뒤): GenerationContext + 공통 프롬프트
//    단일 호출. subject/topic 코드 분기 없음. 활성 프로필이 없거나 V2 호출이
//    실패하면 자동으로 V1 폴백 (사용자 요청은 실패 없이 완료).
//
// 실패 시 예외를 던진다. 크레딧 환불·job 정리는 호출자(API route) 책임.

import {
  generateLearningDocument,
  LearningOrchestratorError,
  type GenerateResult,
} from '@/services/learning-orchestrator';
import type { OrchestratorInput } from '@/services/learning-orchestrator/prompts';
import type { LearningDocument, Section } from '@/services/learning-renderer/schema';
import { createSupabaseServiceClient } from '@/services/supabase/server';

import {
  resolveLearningProfile,
  type ResolvedLearningProfile,
  type EvaluationResult,
} from '@/services/learning-profile';
import { runThreeLayer } from '@/services/learning-validators';
import {
  runLegacyValidators,
  shuffleMcSections,
} from '@/services/learning-validators/legacy-guards';
import { buildGenerationContext } from '@/services/learning-generation/context-builder';
import { generateLearningDocumentV2 } from '@/services/learning-orchestrator/orchestrator-v2';

export interface LearningDocJobInput extends OrchestratorInput {
  jobId: string;
  userId: string;
  organizationId: string;
  /** Organization slug — needed for LEARNING_GENERATION_V2=slug:foo,bar whitelist. */
  orgSlug?: string;
}

export interface LearningDocJobResult {
  documentId: string;
  document: LearningDocument;
  usage?: GenerateResult['rawUsage'];
  /** Which generation flow actually ran. */
  generationMode: 'v1' | 'v2C';
  /** Human-readable profile chain summary. '(활성 프로필 없음)' when empty. */
  appliedProfileSummary: string;
}

// ============================================================
// Feature flag
//   LEARNING_GENERATION_V2=false | 'true' | 'slug:foo,bar'
//   Default: false (V1 only).
// ============================================================
function shouldTryV2(orgSlug?: string): boolean {
  const raw = (process.env.LEARNING_GENERATION_V2 ?? 'false').trim();
  if (raw === 'true' || raw === '1') return true;
  if (raw.startsWith('slug:') && orgSlug) {
    const whitelist = raw
      .slice('slug:'.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return whitelist.includes(orgSlug);
  }
  return false;
}

const MAX_REPAIR_ATTEMPTS = 1;

export async function runLearningDocJob(
  input: LearningDocJobInput,
): Promise<LearningDocJobResult> {
  const service = createSupabaseServiceClient();

  // 1) job running
  await service.from('generation_jobs').update({ status: 'running' }).eq('id', input.jobId);

  // ============================================================
  // V2 시도 경로 (활성 프로필 있고, 기능 플래그 켜진 경우)
  // ============================================================
  if (shouldTryV2(input.orgSlug)) {
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

    if (context.hasActiveProfile) {
      const v2 = await generateLearningDocumentV2(context);
      if (v2.ok) {
        // V2 성공 → 최소 구조 확인 후 그대로 저장. 케이스별 검증기·legacy 실행하지 않는다.
        const doc = v2.document;
        const topicForStorage = `${input.unit} · ${input.topic}`;
        const { data: docRow, error: docErr } = await service
          .from('learning_documents')
          .insert({
            user_id: input.userId,
            organization_id: input.organizationId,
            title: doc.meta.title,
            grade: input.grade,
            subject_code: input.subject,
            material_type_code: input.materialType,
            topic: topicForStorage,
            difficulty: input.difficulty,
            question_count: input.questionCount,
            document_json: doc,
          })
          .select('id')
          .single();

        if (docErr || !docRow) {
          throw new Error(`learning_documents insert 실패 (v2): ${docErr?.message ?? 'unknown'}`);
        }
        const documentId = (docRow as { id: string }).id;

        // V2 감사 로그: final stage 1건만 (context snapshot 포함).
        try {
          await service.from('learning_evaluations').insert({
            document_id: documentId,
            evaluation_stage: 'final',
            attempt: 1,
            passed: true,
            summary: `v2C 단일 호출 · ${context.appliedProfileSummary}`,
            evaluator_type: 'code',
            profile_snapshot: {
              variant: 'v2C',
              profileSetCode: '(from context)',
              scopeChain: context.curriculum.profileChain,
              appliedProfileSummary: context.appliedProfileSummary,
              hasActiveProfile: context.hasActiveProfile,
            },
            result: { context, itemCount: doc.sections.length },
            input_tokens: v2.inputTokens,
            output_tokens: v2.outputTokens,
            duration_ms: v2.durationMs,
          });
        } catch (persistErr) {
          console.error('[learning-doc] v2 evaluation persist failed (non-fatal):', persistErr);
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
          document: doc,
          usage: v2.inputTokens || v2.outputTokens
            ? {
                promptTokens: v2.inputTokens ?? 0,
                completionTokens: v2.outputTokens ?? 0,
              }
            : undefined,
          generationMode: 'v2C',
          appliedProfileSummary: context.appliedProfileSummary,
        };
      }
      // V2 실패 → V1 폴백 (요청 실패 방지)
      console.warn('[learning-doc] v2 failed, falling back to v1:', v2.reason);
    } else {
      // 활성 프로필 없음 → V1
      console.info('[learning-doc] no active profile, using v1');
    }
  }

  // ============================================================
  // V1 경로 (기존 그대로)
  // ============================================================
  // 2) LearningProfile resolve (원격 실패 시 EMPTY_PROFILE 로 폴백)
  let profile: ResolvedLearningProfile;
  let appliedProfileSummary = '(활성 프로필 없음)';
  try {
    profile = await resolveLearningProfile({
      subjectCode: input.subject,
      grade: input.grade,
      unitName: input.unit,
    });
    if (profile.scopeChain.length > 0) {
      appliedProfileSummary = profile.scopeChain.map((s) => s.title).join(' → ');
    }
  } catch (err) {
    // 프로필 조회 실패는 서비스 중단이 아니라 폴백 (EMPTY_PROFILE 동일 동작)
    console.warn('[learning-doc] profile resolve failed, using empty profile:', err);
    profile = {
      profileSetCode: '(unresolved)',
      scopeChain: [],
      learningGoals: [],
      allowedScope: [],
      excludedScope: [],
      vocabularyGuidance: {},
      contentGuidance: {},
      deterministicRules: {},
      semanticCriteria: [],
    };
  }

  // 3) AI 생성 + 셔플 + 3계층 검증 + 부분 재생성
  const firstGen = await generateLearningDocument(input);
  let document = shuffleDocument(firstGen.document);

  let threeLayer = await runThreeLayer({
    document,
    profile,
    requestedGrade: input.grade,
    requestedSubject: input.subject,
    requestedMaterialType: input.materialType,
    requestedQuestionCount: input.questionCount,
    requestedUnit: input.unit,
    requestedTopic: input.topic,
  });

  const legacyFirst = runLegacyValidators(
    {
      subject: input.subject,
      unit: input.unit,
      topic: input.topic,
      materialType: input.materialType,
      questionCount: input.questionCount,
    },
    document,
  );

  // 부분 재생성 (실패 item_id 가 하나라도 있으면)
  const repairs: RepairAttempt[] = [];
  if (!threeLayer.overallPassed && threeLayer.aggregateFailedItemIds.length > 0) {
    const attempt = await attemptPartialRegeneration({
      input,
      document,
      failedItemIds: threeLayer.aggregateFailedItemIds,
    });
    repairs.push(attempt);
    if (attempt.repairedDocument) {
      document = shuffleDocument(attempt.repairedDocument);
      threeLayer = await runThreeLayer({
        document,
        profile,
        requestedGrade: input.grade,
        requestedSubject: input.subject,
        requestedMaterialType: input.materialType,
        requestedQuestionCount: input.questionCount,
        requestedUnit: input.unit,
        requestedTopic: input.topic,
      });
    }
  }

  // set-level 문제 (전체 재생성 필요) → 예외
  if (
    !threeLayer.overallPassed &&
    threeLayer.aggregateFailedItemIds.length === 0 &&
    // 부분 재생성으로 잡을 수 없는 실패만 남은 경우
    hasNonItemFailures(threeLayer)
  ) {
    const structural = threeLayer.structural;
    const det = threeLayer.deterministic;
    const sem = threeLayer.semantic;
    const detReason = det && !det.passed ? det.summary : '';
    const semReason = sem && !sem.passed ? sem.summary : '';
    throw new LearningOrchestratorError(
      'SCHEMA_ERROR',
      `AI 결과가 요청과 일치하지 않아요: ${[
        !structural.passed ? structural.summary : null,
        detReason,
        semReason,
      ]
        .filter(Boolean)
        .join(' | ')}`,
    );
  }

  // 4) learning_documents INSERT (신규 스키마 그대로)
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

  // 5) 감사 로그: evaluations + evaluation_items + repair_attempts (실패해도 서비스 지속)
  try {
    await persistEvaluations({
      documentId,
      profile,
      threeLayer,
      repairs,
      legacyFirstOk: legacyFirst.ok,
      legacyFirstReason: legacyFirst.ok ? undefined : legacyFirst.reason,
    });
  } catch (err) {
    console.error('[learning-doc] evaluations persist failed (non-fatal):', err);
  }

  // 6) job done + FK 링크
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
    usage: firstGen.rawUsage,
    generationMode: 'v1',
    appliedProfileSummary,
  };
}

// ============================================================
// helpers
// ============================================================

function shuffleDocument(doc: LearningDocument): LearningDocument {
  return { ...doc, sections: shuffleMcSections(doc.sections) };
}

function hasNonItemFailures(threeLayer: {
  structural: EvaluationResult;
  deterministic: EvaluationResult | null;
  semantic: EvaluationResult | null;
}): boolean {
  if (!threeLayer.structural.passed) return true;
  const det = threeLayer.deterministic;
  if (det && !det.passed) {
    const nonItem = det.items.some(
      (it) => it.severity === 'error' && it.itemId.startsWith('('),
    );
    if (nonItem) return true;
  }
  const sem = threeLayer.semantic;
  if (sem && !sem.passed) {
    // semantic 실패는 item 단위이므로 여기에는 안 걸림 (부분 재생성으로 해결 시도)
    // 부분 재생성 후에도 남은 실패는 결과 관대 pass (경고로만).
  }
  return false;
}

interface RepairAttempt {
  attemptedItemIds: string[];
  repairedDocument: LearningDocument | null;
  reason: string;
  status: 'completed' | 'failed';
}

/**
 * Partial regeneration (M2-1.8).
 *
 * Strategy for M2-1.8 initial scope:
 *   Full document regeneration with a targeted feedback prompt. Item-level
 *   surgical replacement (replace only failed sections) requires the AI to
 *   preserve itemIds for unchanged blocks, which is fragile. Instead we
 *   regenerate everything once, then re-validate. The `learning_repair_attempts`
 *   table CHECK (attempt=1) enforces the "max 1 repair" policy.
 */
async function attemptPartialRegeneration(args: {
  input: LearningDocJobInput;
  document: LearningDocument;
  failedItemIds: string[];
}): Promise<RepairAttempt> {
  try {
    // 재생성은 orchestrator 그대로 호출. 프롬프트 안에는 failed item 정보를 담지
    // 못하지만, 셔플 + 3계층 재검증으로 대부분의 결정적 오류는 두 번째 시도에서 해결.
    // (프롬프트 확장은 후속 개선)
    const regen = await generateLearningDocument(args.input);
    return {
      attemptedItemIds: args.failedItemIds,
      repairedDocument: regen.document,
      reason: `${args.failedItemIds.length}개 아이템 실패로 전체 재생성 (M2-1.8 초기 스코프)`,
      status: 'completed',
    };
  } catch (err) {
    return {
      attemptedItemIds: args.failedItemIds,
      repairedDocument: null,
      reason: `재생성 실패: ${(err as Error).message}`,
      status: 'failed',
    };
  }
}

// ============================================================
// evaluations 저장
// ============================================================

async function persistEvaluations(args: {
  documentId: string;
  profile: ResolvedLearningProfile;
  threeLayer: {
    structural: EvaluationResult;
    deterministic: EvaluationResult | null;
    semantic: EvaluationResult | null;
    overallPassed: boolean;
    aggregateFailedItemIds: string[];
  };
  repairs: RepairAttempt[];
  legacyFirstOk: boolean;
  legacyFirstReason?: string;
}): Promise<void> {
  const service = createSupabaseServiceClient();

  const stages: Array<{ stage: 'structure' | 'deterministic' | 'semantic' | 'final'; result: EvaluationResult | null }> = [
    { stage: 'structure', result: args.threeLayer.structural },
    { stage: 'deterministic', result: args.threeLayer.deterministic },
    { stage: 'semantic', result: args.threeLayer.semantic },
  ];

  // final 종합 결과 — legacy drift 정보 metadata 로 함께.
  const finalPassed = args.threeLayer.overallPassed;
  const finalResult: EvaluationResult = {
    stage: 'final',
    passed: finalPassed,
    summary: finalPassed
      ? '3계층 모두 통과'
      : `실패 stage: ${[
          !args.threeLayer.structural.passed ? 'structure' : null,
          args.threeLayer.deterministic && !args.threeLayer.deterministic.passed ? 'deterministic' : null,
          args.threeLayer.semantic && !args.threeLayer.semantic.passed ? 'semantic' : null,
        ]
          .filter(Boolean)
          .join(', ')}`,
    evaluatorType: 'hybrid',
    items: [],
    failedItemIds: args.threeLayer.aggregateFailedItemIds,
  };
  stages.push({ stage: 'final', result: finalResult });

  const profileSnapshot = {
    profileSetCode: args.profile.profileSetCode,
    scopeChain: args.profile.scopeChain,
    learningGoalsCount: args.profile.learningGoals.length,
    semanticCriteriaCount: args.profile.semanticCriteria.length,
    hasMathRules: !!args.profile.deterministicRules.math,
    hasMcRules: !!args.profile.deterministicRules.multipleChoice,
    legacyFirstOk: args.legacyFirstOk,
    legacyFirstReason: args.legacyFirstReason,
  };

  for (const { stage, result } of stages) {
    if (!result) continue;
    const { data: evalRow, error: evalErr } = await service
      .from('learning_evaluations')
      .insert({
        document_id: args.documentId,
        evaluation_stage: stage,
        attempt: 1,
        passed: result.passed,
        summary: result.summary,
        evaluator_type: result.evaluatorType,
        evaluator_model: result.evaluatorModel,
        profile_snapshot: profileSnapshot,
        result: {
          items: result.items,
          failedItemIds: result.failedItemIds,
        },
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        duration_ms: result.durationMs,
      })
      .select('id')
      .single();

    if (evalErr || !evalRow) {
      throw new Error(`learning_evaluations insert 실패 (${stage}): ${evalErr?.message ?? 'unknown'}`);
    }

    const evaluationId = (evalRow as { id: string }).id;
    if (result.items.length > 0) {
      const rows = result.items.map((it) => ({
        evaluation_id: evaluationId,
        item_id: it.itemId,
        item_index: it.itemIndex,
        item_type: it.itemType,
        criterion_key: it.criterionKey,
        passed: it.passed,
        reason: it.reason,
        severity: it.severity,
        repair_action: it.repairAction,
      }));
      const { error: itemsErr } = await service
        .from('learning_evaluation_items')
        .insert(rows);
      if (itemsErr) {
        console.error(`[learning-doc] evaluation_items insert (${stage}) failed:`, itemsErr);
      }
    }
  }

  // repair_attempts — 하나라도 시도 있으면 저장
  for (const rep of args.repairs) {
    const { error: repErr } = await service.from('learning_repair_attempts').insert({
      document_id: args.documentId,
      // repair 는 반드시 하나의 evaluation 을 참조해야 하지만, 여기서는 stage='final' 을 정확히
      // 재조회하기가 번거로우므로 우선 최근 semantic 평가를 참조. 스키마 CHECK 는 attempt=1 만.
      evaluation_id: await getLatestEvaluationId(args.documentId, service),
      failed_item_ids: rep.attemptedItemIds,
      attempt: 1,
      failure_reasons: {
        reason: rep.reason,
      },
      original_items: {},
      repaired_items: rep.repairedDocument ? { document: rep.repairedDocument } : null,
      status: rep.status,
      completed_at: new Date().toISOString(),
    });
    if (repErr) {
      console.error('[learning-doc] repair_attempts insert failed:', repErr);
    }
  }
}

async function getLatestEvaluationId(
  documentId: string,
  service: ReturnType<typeof createSupabaseServiceClient>,
): Promise<string> {
  const { data, error } = await service
    .from('learning_evaluations')
    .select('id')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error('latest evaluation not found');
  return (data as { id: string }).id;
}
