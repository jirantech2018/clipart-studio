// POST /api/learning/documents — LearningDocument 생성.
//
// 흐름:
//   1) 인증 · 조직 멤버십 확인
//   2) generation_jobs(kind='learning_doc') INSERT (placeholder prompt/batch_size=1)
//   3) 크레딧 use_tokens (M1: 3 크레딧, MVP 값)
//   4) dispatchLearningDoc → orchestrator → learning_documents INSERT
//   5) 실패 시 크레딧 환불 + job status='failed' 로 업데이트
//   6) 성공 시 { documentId, document } 반환
//
// M1 은 SSE 없이 동기 응답. 30~60초 소요 → maxDuration 90.

export const runtime = 'nodejs';
// Stage 4.4: ai_designed 는 페이지당 30~60s 이미지 생성 + edit + vision OCR 로
// 케이스당 3~8분 소요. Vercel serverless 최대 300s 를 넘길 수 있으므로 프로덕션은
// Railway (Node persistent) 에서 실행. Vercel 재활용 시 async worker 로 이관 필요.
export const maxDuration = 800;

import { ZodError } from 'zod';

import { apiError, apiOk, type ErrorCode } from '@/lib/api-error';
import {
  InsufficientPoolBalanceError,
  PoolNotFoundError,
  refundOrgTokens,
  useOrgTokens,
} from '@/services/credit';
import { dispatchLearningDoc } from '@/services/jobs/dispatcher';
import { LearningOrchestratorError } from '@/services/learning-orchestrator';
import { LearningPipelineError } from '@/services/jobs/handlers/learning-doc';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

import { SUBJECT_LABEL } from '@/features/learning-helper/domain/subjects';
import { materialTypeLabel } from '@/features/learning-helper/domain/material-types';
import { createLearningDocumentSchema } from '@/features/learning-helper/lib/schemas';
import { isAdmin } from '@/lib/admin';

// M1 크레딧 정책: 임시로 3 (Phase 1 관측 후 §7.3 매트릭스 반영).
const STANDARD_CREDITS = 3;
// Stage 4.4: ai_designed 는 페이지당 이미지·비전 호출이 5~10회 발생 → 실비 훨씬 큼.
// 기본 base 15 크레딧 + 페이지 target 반영은 estimate API 로 확장 예정. 우선 30 고정.
const AI_DESIGNED_CREDITS = 30;

function aiDesignedFeatureEnabled(orgSlug: string, userEmail: string | undefined): boolean {
  if (process.env.LEARNING_AI_DESIGNED_KILL_SWITCH === '1') return false;
  if (process.env.LEARNING_AI_DESIGNED_ENABLED === '1') return true;
  if (isAdmin(userEmail)) return true;
  const pilot = (process.env.LEARNING_AI_DESIGNED_PILOT_ORG_SLUGS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return pilot.includes(orgSlug);
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  let body;
  try {
    body = createLearningDocumentSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  // 조직 멤버십 확인.
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', body.orgSlug)
    .is('deleted_at', null)
    .maybeSingle();
  if (!orgRow) {
    return apiError('VALIDATION_ERROR', '요청한 조직을 찾을 수 없어요');
  }
  const organizationId = (orgRow as { id: string }).id;

  const { data: member } = await supabase
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();
  if (!member) {
    return apiError('FORBIDDEN', '이 조직의 멤버가 아니에요');
  }

  // 이전 학습자료 job 진행 중인지 확인 (kind='learning_doc' 만; 이미지 job 은 별도).
  const { data: active } = await supabase
    .from('generation_jobs')
    .select('id, status')
    .eq('user_id', user.id)
    .eq('kind', 'learning_doc')
    .in('status', ['queued', 'running'])
    .maybeSingle();
  if (active) {
    return apiError('ACTIVE_JOB_EXISTS', '이전 학습자료 생성이 진행 중입니다', {
      activeJobId: (active as { id: string }).id,
    });
  }

  // Stage 4.4: renderMode 검증 + feature flag 체크.
  const requestedRenderMode = body.renderMode ?? 'standard';
  if (requestedRenderMode === 'ai_designed' && !aiDesignedFeatureEnabled(body.orgSlug, user.email)) {
    return apiError('FORBIDDEN', 'AI 디자인 학습지는 파일럿 조직에만 활성화되어 있어요');
  }
  const creditsRequired = requestedRenderMode === 'ai_designed' ? AI_DESIGNED_CREDITS : STANDARD_CREDITS;

  // Job insert — placeholder prompt / batch_size=1 로 기존 CHECK 만족.
  const promptSummary = `${body.grade}학년 ${SUBJECT_LABEL[body.subject as 'KOR' | 'MATH']} · ${materialTypeLabel(body.materialType as 'multiple_choice' | 'individual_activity' | 'ox_quiz' | 'concept_summary' | 'reading_material')} · ${body.unit} · ${body.topic}`;
  const service = createSupabaseServiceClient();
  const { data: job, error: jobError } = await service
    .from('generation_jobs')
    .insert({
      user_id: user.id,
      prompt: promptSummary.slice(0, 500),
      batch_size: 1,
      diversity_level: 0,
      reference_image_id: null,
      school_profile_applied: false,
      reserved_credits: creditsRequired,
      status: 'queued',
      org_id: organizationId,
      kind: 'learning_doc',
      render_mode: requestedRenderMode,
    })
    .select('id')
    .single();

  if (jobError || !job) {
    console.error('[learning/documents POST] job insert failed', {
      code: jobError?.code,
      message: jobError?.message,
    });
    return apiError('INTERNAL_ERROR', 'Job 생성 실패');
  }
  const jobId = (job as { id: string }).id;

  // 관리자 무과금 검증 경로.
  //   - LEARNING_DEV_BYPASS_CREDITS=1 && 요청자 = ADMIN_EMAIL 일 때만 크레딧 차감·환불 스킵.
  //   - 프로덕션과 동일한 handler 경로를 사용자 pool 소비 없이 실행하기 위한 감사된 우회.
  //   - Non-admin 이나 flag 미설정 시 기존 정책 그대로 (useOrgTokens/refundOrgTokens).
  const bypassCredits =
    process.env.LEARNING_DEV_BYPASS_CREDITS === '1' && isAdmin(user.email);

  // 크레딧 차감. 실패 시 job 삭제. (bypass 인 경우 스킵)
  try {
    if (!bypassCredits) {
      await useOrgTokens({
        organizationId,
        amount: creditsRequired,
        jobId,
        actorUserId: user.id,
      });
    }
  } catch (err) {
    await service.from('generation_jobs').delete().eq('id', jobId);
    if (err instanceof InsufficientPoolBalanceError) {
      const { data: poolRow } = await service
        .from('token_pools')
        .select('balance')
        .eq('organization_id', organizationId)
        .maybeSingle();
      return apiError('INSUFFICIENT_CREDITS', '이 워크스페이스의 크레딧이 부족합니다', {
        remainingCredits: (poolRow as { balance: number } | null)?.balance ?? 0,
        requiredCredits: creditsRequired,
      });
    }
    if (err instanceof PoolNotFoundError) {
      return apiError('INTERNAL_ERROR', '워크스페이스 크레딧 풀이 준비되지 않았어요');
    }
    console.error('[learning/documents POST] use_tokens failed', err);
    return apiError('INTERNAL_ERROR', '크레딧 차감 실패');
  }

  // Dispatch — orchestrator 호출 (동기).
  try {
    // Admin 사용자에게 V2 자동 활성화 (Railway env 설정 없이 검증 가능).
    // 활성 프로필이 없거나 V2 호출 실패 시 handler 가 자동으로 V1 로 폴백.
    const enableV2ForAdmin = isAdmin(user.email);

    const result = await dispatchLearningDoc({
      jobId,
      userId: user.id,
      organizationId,
      orgSlug: body.orgSlug,
      enableV2Override: enableV2ForAdmin,
      grade: body.grade as 1 | 2 | 3 | 4 | 5 | 6,
      subject: body.subject as 'KOR' | 'MATH',
      materialType: body.materialType as
        | 'multiple_choice'
        | 'individual_activity'
        | 'ox_quiz'
        | 'concept_summary'
        | 'reading_material',
      unit: body.unit,
      topic: body.topic,
      questionCount: body.questionCount,
      difficulty: body.difficulty,
      additionalRequest: body.additionalRequest,
      clipartMode: body.clipartMode,
      renderMode: requestedRenderMode,
    });

    return apiOk(
      {
        jobId,
        documentId: result.documentId,
        document: result.document,
        creditsUsed: bypassCredits ? 0 : creditsRequired,
        generationMode: result.generationMode,
        renderMode: result.renderMode ?? 'standard',
        aiDesigned: result.aiDesigned ?? null,
        appliedProfile: result.appliedProfileSummary,
        clipartInsertedCount: result.clipartInsertedCount ?? 0,
      },
      201,
    );
  } catch (err) {
    // 실패 → job status='failed' + 크레딧 환불 (bypass 인 경우 refund 도 스킵).
    await service
      .from('generation_jobs')
      .update({
        status: 'failed',
        error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);
    let refunded = false;
    if (!bypassCredits) {
      try {
        await refundOrgTokens({
          organizationId,
          amount: creditsRequired,
          jobId,
          reason: 'learning-doc generation failed',
        });
        refunded = true;
      } catch (refundErr) {
        console.error('[learning/documents POST] refund failed', refundErr);
      }
    }

    // 상세 원인은 감사 로그로만 (내부 err.message). 사용자에게는 짧은 안내.
    console.error('[learning/documents POST] pipeline failed:', err);

    // 오류 분류: 품질 검수 실패 vs 외부 장애 vs 지원 안됨 vs 내부 오류 (사용자 지시).
    if (err instanceof LearningPipelineError) {
      const map: Record<
        LearningPipelineError['code'],
        { apiCode: ErrorCode; message: string; canRetry: boolean }
      > = {
        unsupported_combination: {
          apiCode: 'UNSUPPORTED_COMBINATION',
          message: '이 학년·과목 조합은 아직 준비 중이라 생성할 수 없어요.',
          canRetry: false,
        },
        ai_upstream: {
          apiCode: 'UPSTREAM_UNAVAILABLE',
          message: 'AI 서비스에 일시적인 문제가 있어요.',
          canRetry: true,
        },
        ai_timeout: {
          apiCode: 'UPSTREAM_TIMEOUT',
          message: 'AI 응답이 너무 오래 걸렸어요.',
          canRetry: true,
        },
        ai_parse: {
          apiCode: 'UPSTREAM_INVALID_RESPONSE',
          message: 'AI 응답 형식이 올바르지 않아 다시 생성해야 해요.',
          canRetry: true,
        },
        quality_check_failed: {
          apiCode: 'QUALITY_CHECK_FAILED',
          message: '생성한 자료가 품질 기준을 통과하지 못해 제공하지 않았어요.',
          canRetry: true,
        },
        internal_error: {
          apiCode: 'INTERNAL_ERROR',
          message: '학습자료 생성 중 문제가 발생했어요.',
          canRetry: true,
        },
      };
      const mapped = map[err.code];
      return apiError(mapped.apiCode, mapped.message, {
        creditsRefunded: refunded,
        refundedAmount: refunded ? creditsRequired : 0,
        failedStage: err.stage,
        errorCode: err.code,
        canRetry: mapped.canRetry,
      });
    }

    // 하위호환: LearningOrchestratorError 경로 (dead code, 남겨둠)
    if (err instanceof LearningOrchestratorError) {
      return apiError('UPSTREAM_UNAVAILABLE', 'AI 서비스에 일시적인 문제가 있어요.', {
        creditsRefunded: refunded,
        refundedAmount: refunded ? creditsRequired : 0,
        failedStage: 'ai-upstream',
        errorCode: 'ai_upstream',
        canRetry: true,
      });
    }
    return apiError('INTERNAL_ERROR', '학습자료 생성 중 오류가 발생했어요.', {
      creditsRefunded: refunded,
      refundedAmount: refunded ? creditsRequired : 0,
      failedStage: 'unknown',
      errorCode: 'internal_error',
      canRetry: true,
    });
  }
}
