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
export const maxDuration = 90;

import { ZodError } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import {
  InsufficientPoolBalanceError,
  PoolNotFoundError,
  refundOrgTokens,
  useOrgTokens,
} from '@/services/credit';
import { dispatchLearningDoc } from '@/services/jobs/dispatcher';
import { LearningOrchestratorError } from '@/services/learning-orchestrator';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

import { SUBJECT_LABEL } from '@/features/learning-helper/domain/subjects';
import { materialTypeLabel } from '@/features/learning-helper/domain/material-types';
import { createLearningDocumentSchema } from '@/features/learning-helper/lib/schemas';

// M1 크레딧 정책: 임시로 3 (Phase 1 관측 후 §7.3 매트릭스 반영).
const LEARNING_DOC_CREDITS = 3;

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
      reserved_credits: LEARNING_DOC_CREDITS,
      status: 'queued',
      org_id: organizationId,
      kind: 'learning_doc',
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

  // 크레딧 차감. 실패 시 job 삭제.
  try {
    await useOrgTokens({
      organizationId,
      amount: LEARNING_DOC_CREDITS,
      jobId,
      actorUserId: user.id,
    });
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
        requiredCredits: LEARNING_DOC_CREDITS,
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
    const result = await dispatchLearningDoc({
      jobId,
      userId: user.id,
      organizationId,
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
    });

    return apiOk(
      {
        jobId,
        documentId: result.documentId,
        document: result.document,
        creditsUsed: LEARNING_DOC_CREDITS,
      },
      201,
    );
  } catch (err) {
    // 실패 → job status='failed' + 크레딧 환불.
    await service
      .from('generation_jobs')
      .update({
        status: 'failed',
        error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);
    try {
      await refundOrgTokens({
        organizationId,
        amount: LEARNING_DOC_CREDITS,
        jobId,
        reason: 'learning-doc generation failed',
      });
    } catch (refundErr) {
      console.error('[learning/documents POST] refund failed', refundErr);
    }

    if (err instanceof LearningOrchestratorError) {
      const message =
        err.code === 'AI_TIMEOUT'
          ? 'AI 응답이 너무 오래 걸렸어요. 잠시 후 다시 시도해주세요.'
          : err.code === 'AI_UPSTREAM'
            ? 'AI 서비스에 일시적 문제가 있어요. 잠시 후 다시 시도해주세요.'
            : err.code === 'PARSE_ERROR' || err.code === 'SCHEMA_ERROR'
              ? 'AI 응답 형식이 올바르지 않아 다시 만들어야 해요. 다시 시도해주세요.'
              : 'AI 생성 중 오류가 발생했어요.';
      return apiError('UPSTREAM_UNAVAILABLE', message);
    }
    console.error('[learning/documents POST] dispatch failed', err);
    return apiError('INTERNAL_ERROR', '학습자료 생성 중 오류가 발생했어요. 다시 시도해주세요.');
  }
}
