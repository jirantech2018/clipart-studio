// Design Ref: §4.2 POST /api/jobs
// Plan SC: FR-05 batch request, FR-12 credit reserve, NFR one active job per user

export const runtime = 'nodejs';
export const maxDuration = 30;

import { ZodError } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import { InsufficientCreditsError, reserveCredits } from '@/services/credit';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';
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

  // 조직 컨텍스트 판별. orgSlug 가 있으면 조직 존재 + 요청자가 active 멤버
  // 인지 확인 후 org_id 를 스냅샷으로 저장. 실패 시 개인 컨텍스트로 폴백
  // 하지 않고 오류 반환 (사용자 명세 Q3(b)).
  let orgIdSnapshot: string | null = null;
  if (body.orgSlug) {
    const { data: orgRow } = await supabase
      .from('organizations')
      .select('id')
      .eq('slug', body.orgSlug)
      .is('deleted_at', null)
      .maybeSingle();
    if (!orgRow) {
      return apiError('VALIDATION_ERROR', '요청한 조직을 찾을 수 없어요');
    }
    const orgId = (orgRow as { id: string }).id;
    const { data: member } = await supabase
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (!member) {
      return apiError('FORBIDDEN', '이 조직의 멤버가 아니에요');
    }
    orgIdSnapshot = orgId;
  }

  // 업로드 참조 이미지 슬롯이 지정됐다면 R2 키를 해석해 job에 스냅샷으로 저장.
  // 이후 사용자가 슬롯을 삭제해도 진행 중인 job은 영향 받지 않는다.
  // 개인/조직 참조 중 하나만 있음 (schema refine 으로 강제).
  let customReferenceR2Key: string | null = null;
  if (body.customReferenceId) {
    const { data: ref } = await supabase
      .from('reference_images')
      .select('r2_key')
      .eq('id', body.customReferenceId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!ref) {
      return apiError('VALIDATION_ERROR', '선택한 참조 이미지를 찾을 수 없어요');
    }
    customReferenceR2Key = ref.r2_key as string;
  } else if (body.orgReferenceId && orgIdSnapshot) {
    // 조직 참조 이미지는 service_role 로 조회 (요청자가 active 멤버임은 위에서 확인).
    const service = createSupabaseServiceClient();
    const { data: orgRef } = await service
      .from('organization_reference_images')
      .select('r2_key, organization_id')
      .eq('id', body.orgReferenceId)
      .maybeSingle();
    if (!orgRef || (orgRef as { organization_id: string }).organization_id !== orgIdSnapshot) {
      return apiError('VALIDATION_ERROR', '선택한 조직 참조 이미지를 찾을 수 없어요');
    }
    customReferenceR2Key = (orgRef as { r2_key: string }).r2_key;
  }

  const { data: job, error: jobError } = await supabase
    .from('generation_jobs')
    .insert({
      user_id: user.id,
      prompt: body.prompt,
      batch_size: body.batchSize,
      diversity_level: body.diversityLevel,
      reference_image_id: body.referenceImageId ?? null,
      custom_reference_r2_key: customReferenceR2Key,
      school_profile_applied: body.schoolProfileApplied,
      aspect_ratio: body.aspectRatio,
      reserved_credits: body.batchSize,
      status: 'queued',
      org_id: orgIdSnapshot,
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
