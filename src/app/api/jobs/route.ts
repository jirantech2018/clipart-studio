// Design Ref: §4.2 POST /api/jobs
// Plan SC: FR-05 batch request, FR-12 credit reserve, NFR one active job per user

import { ZodError } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import { InsufficientCreditsError, reserveCredits } from '@/services/credit';
import { createSupabaseServerClient } from '@/services/supabase/server';
import { createJobSchema } from '@/types/schemas';

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  let body;
  try {
    body = createJobSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  // Ensure no active job (partial index also enforces this at DB level)
  const { data: active } = await supabase
    .from('generation_jobs')
    .select('id, status')
    .eq('user_id', user.id)
    .in('status', ['queued', 'running'])
    .maybeSingle();

  if (active) {
    return apiError('ACTIVE_JOB_EXISTS', '이전 생성이 진행 중입니다', { activeJobId: active.id });
  }

  // Reserve credits atomically. Throws InsufficientCreditsError on shortfall.
  let remainingCredits: number;
  try {
    remainingCredits = await reserveCredits(user.id, body.batchSize);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('credits, credits_reset_at')
        .eq('id', user.id)
        .single();
      return apiError('INSUFFICIENT_CREDITS', '이번 달 크레딧이 부족합니다', {
        remainingCredits: profile?.credits ?? 0,
        requiredCredits: body.batchSize,
        nextResetAt: profile?.credits_reset_at ?? null,
      });
    }
    throw err;
  }

  const { data: job, error: jobError } = await supabase
    .from('generation_jobs')
    .insert({
      user_id: user.id,
      prompt: body.prompt,
      batch_size: body.batchSize,
      diversity_level: body.diversityLevel,
      reference_image_id: body.referenceImageId ?? null,
      school_profile_applied: body.schoolProfileApplied,
      reserved_credits: body.batchSize,
      status: 'queued',
    })
    .select('id')
    .single();

  if (jobError || !job) {
    // Refund on job insert failure
    const { refundCredits } = await import('@/services/credit');
    await refundCredits(user.id, body.batchSize);
    return apiError('INTERNAL_ERROR', 'Job 생성 실패');
  }

  return apiOk(
    {
      jobId: job.id,
      reservedCredits: body.batchSize,
      remainingCredits,
      streamUrl: `/api/jobs/${job.id}/stream`,
    },
    201,
  );
}
