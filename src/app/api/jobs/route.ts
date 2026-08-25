// Design Ref: §4.2 POST /api/jobs
// Plan SC: FR-05 batch request, FR-12 credit reserve, NFR one active job per user
//
// Phase 2 — body 에 kind='package' 가 있으면 패키지 job 분기.
// 두 경로 모두 같은 활성 Job 제약 (unique partial index) 을 공유한다.

export const runtime = 'nodejs';
export const maxDuration = 30;

import { ZodError } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import {
  InsufficientPoolBalanceError,
  PoolNotFoundError,
  refundOrgTokens,
  useOrgTokens,
} from '@/services/credit';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';
import {
  createJobSchema,
  createPackageJobSchema,
  type CreatePackageJobInput,
  PACKAGE_JOB_TOTAL_MAX,
} from '@/types/schemas';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * PostgreSQL SQLSTATE 로 스키마 미준비 상태를 감지한다.
 *   42P01 = undefined_table
 *   42703 = undefined_column
 * 이 두 코드가 나오면 Migration 052~055 가 아직 DB 에 적용되지 않았다는
 * 의미. 클라이언트에는 PACKAGE_SCHEMA_NOT_READY 로 응답한다.
 */
function isSchemaNotReadyError(code: string | undefined | null): boolean {
  return code === '42P01' || code === '42703';
}

/**
 * Conversation server storage 링크 (conversation_id / message_id) 는 클라이언트가
 * async fire-and-forget 로 conversation/message 를 upsert 하는 구조라, 사용자가
 * 매우 빠르게 생성 버튼을 누르면 job insert 가 서버 등록보다 먼저 도착해서
 * FK 위반 (23503) 이 발생할 수 있다. 특히 Package UI 는 이미 채워진 form 이라
 * 재현률이 높다.
 *
 * 그래서 job insert 전에 두 id 가 실제로 서버에 존재하는지 확인하고, 없거나
 * 소유권이 맞지 않으면 링크 없이 (NULL) job 을 만들어 최소 회귀만 방어한다.
 * 링크는 UX 편의 (사이드바 재조회 시 어느 대화의 어느 메시지에서 나온 결과인지
 * 추적) 이지, 이미지/크레딧/Job 자체의 필수 요소가 아님 — 지시서 §13.
 */
async function resolveConversationLink(
  service: SupabaseClient,
  userId: string,
  conversationId: string | null | undefined,
  messageId: string | null | undefined,
): Promise<{ conversationId: string | null; messageId: string | null }> {
  if (!conversationId) return { conversationId: null, messageId: null };
  const { data: conv } = await service
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!conv) return { conversationId: null, messageId: null };

  if (!messageId) return { conversationId, messageId: null };
  const { data: msg } = await service
    .from('conversation_messages')
    .select('id')
    .eq('id', messageId)
    .eq('conversation_id', conversationId)
    .maybeSingle();
  if (!msg) return { conversationId, messageId: null };
  return { conversationId, messageId };
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

  // Kind 분기 — package 는 별도 스키마로 파싱. kind 없거나 'single' 이면 기존 경로.
  const kind =
    typeof raw === 'object' && raw !== null && (raw as { kind?: unknown }).kind === 'package'
      ? 'package'
      : 'single';

  if (kind === 'package') {
    return handlePackage(supabase, user.id, raw);
  }

  return handleSingle(supabase, user.id, raw);
}

// ============================================================
// Single job — 기존 로직 그대로 유지 (회귀 방지).
// ============================================================
async function handleSingle(
  supabase: SupabaseClient,
  userId: string,
  raw: unknown,
) {
  let body;
  try {
    body = createJobSchema.parse(raw);
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
    .eq('user_id', userId)
    .in('status', ['queued', 'running'])
    .maybeSingle();

  if (active) {
    return apiError('ACTIVE_JOB_EXISTS', '이전 생성이 진행 중입니다', { activeJobId: active.id });
  }

  // Plan v0.2.8 §M3-3: workspace 확정을 크레딧 조작보다 먼저 한다.
  // Job.organization_id → Pool 이라는 원칙을 유지하기 위해, org 검증 → job
  // insert → use_tokens(job_id) 순으로 진행한다.
  let orgIdSnapshot: string;
  let orgIdSchoolContext: string | null = null;
  if (body.orgSlug) {
    const { data: orgRow } = await supabase
      .from('organizations')
      .select('id, type')
      .eq('slug', body.orgSlug)
      .is('deleted_at', null)
      .maybeSingle();
    if (!orgRow) {
      return apiError('VALIDATION_ERROR', '요청한 조직을 찾을 수 없어요');
    }
    const orgId = (orgRow as { id: string }).id;
    const orgType = (orgRow as { type: string }).type;
    const { data: member } = await supabase
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    if (!member) {
      return apiError('FORBIDDEN', '이 조직의 멤버가 아니에요');
    }
    orgIdSnapshot = orgId;
    if (orgType !== 'personal') orgIdSchoolContext = orgId;
  } else {
    const { data: myOrg } = await supabase
      .from('organizations')
      .select('id')
      .eq('owner_id', userId)
      .eq('type', 'personal')
      .is('deleted_at', null)
      .maybeSingle();
    if (!myOrg) {
      return apiError('INTERNAL_ERROR', '워크스페이스가 아직 준비되지 않았어요');
    }
    orgIdSnapshot = (myOrg as { id: string }).id;
  }

  let customReferenceR2Key: string | null = null;
  if (body.customReferenceId) {
    const { data: ref } = await supabase
      .from('reference_images')
      .select('r2_key')
      .eq('id', body.customReferenceId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!ref) {
      return apiError('VALIDATION_ERROR', '선택한 참조 이미지를 찾을 수 없어요');
    }
    customReferenceR2Key = ref.r2_key as string;
  } else if (body.orgReferenceId && orgIdSchoolContext) {
    const service = createSupabaseServiceClient();
    const { data: orgRef } = await service
      .from('organization_reference_images')
      .select('r2_key, organization_id')
      .eq('id', body.orgReferenceId)
      .maybeSingle();
    if (!orgRef || (orgRef as { organization_id: string }).organization_id !== orgIdSchoolContext) {
      return apiError('VALIDATION_ERROR', '선택한 조직 참조 이미지를 찾을 수 없어요');
    }
    customReferenceR2Key = (orgRef as { r2_key: string }).r2_key;
  }

  // Conversation 링크가 async 등록 완료 전이면 FK 실패하니 존재 확인 후 반영.
  const linkService = createSupabaseServiceClient();
  const resolvedLink = await resolveConversationLink(
    linkService,
    userId,
    body.conversationId,
    body.messageId,
  );

  const { data: job, error: jobError } = await supabase
    .from('generation_jobs')
    .insert({
      user_id: userId,
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
      slot_prompts: body.slotPrompts ?? null,
      kind: 'single',
      // Migration 076: 대화 컨텍스트 링크. resolveConversationLink 가 유효성
      // 확인해 없는 값이면 NULL 로 fallback (링크 유실 허용, job 은 계속 성공).
      conversation_id: resolvedLink.conversationId,
      message_id: resolvedLink.messageId,
    })
    .select('id')
    .single();

  if (jobError || !job) {
    // handlePackage 와 동일하게 원본 supabase 에러를 그대로 로그로 남긴다.
    // 42P01 / 42703 (schema not ready) 은 사용자에게도 알기 쉽게 별도 코드로
    // 응답 — 다음 배포 사이클에서 정확한 원인을 확보하기 위함.
    console.error('[jobs POST single] job insert failed', {
      code: jobError?.code,
      message: jobError?.message,
      hint: jobError?.hint,
      details: jobError?.details,
      conversationId: resolvedLink.conversationId,
      messageId: resolvedLink.messageId,
    });
    if (jobError && isSchemaNotReadyError(jobError.code)) {
      return apiError(
        'INTERNAL_ERROR',
        'DB 스키마 준비 중이에요. 잠시 후 다시 시도해주세요.',
      );
    }
    return apiError('INTERNAL_ERROR', 'Job 생성 실패');
  }

  // 크레딧 차감. Job insert 이후 원자적으로 use_tokens 를 호출 — 실패 시
  // orphan job 이 남지 않도록 즉시 삭제한다.
  let remainingCredits: number;
  try {
    const useResult = await useOrgTokens({
      organizationId: orgIdSnapshot,
      amount: body.batchSize,
      jobId: job.id as string,
      actorUserId: userId,
    });
    remainingCredits = useResult.balance;
  } catch (err) {
    const service = createSupabaseServiceClient();
    await service.from('generation_jobs').delete().eq('id', job.id);
    if (err instanceof InsufficientPoolBalanceError) {
      const { data: poolRow } = await service
        .from('token_pools')
        .select('balance')
        .eq('organization_id', orgIdSnapshot)
        .maybeSingle();
      return apiError('INSUFFICIENT_CREDITS', '이 워크스페이스의 크레딧이 부족합니다', {
        remainingCredits: (poolRow as { balance: number } | null)?.balance ?? 0,
        requiredCredits: body.batchSize,
      });
    }
    if (err instanceof PoolNotFoundError) {
      return apiError('INTERNAL_ERROR', '워크스페이스 크레딧 풀이 준비되지 않았어요');
    }
    throw err;
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

// ============================================================
// Package job — Phase 2.
// 검증 → 활성 Job 확인 → 크레딧 예약 → job insert → slot bulk insert.
// 각 실패 지점에서 이미 예약된 크레딧을 완전 환불한다.
// ============================================================
async function handlePackage(
  supabase: SupabaseClient,
  userId: string,
  raw: unknown,
) {
  let body: CreatePackageJobInput;
  try {
    body = createPackageJobSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  // 총 슬롯 수 재검증 (클라이언트 검증만 신뢰하지 않는다 — 지시서 §2).
  const enabledItems = body.items.filter((it) => it.enabled);
  const totalSlots = enabledItems.reduce((sum, it) => sum + it.quantity, 0);
  if (totalSlots < 1 || totalSlots > PACKAGE_JOB_TOTAL_MAX) {
    return apiError('VALIDATION_ERROR', `패키지 총 이미지 수는 1~${PACKAGE_JOB_TOTAL_MAX}장이어야 해요`);
  }

  // 활성 Job 1개 제약 — single/package 공용.
  const { data: active } = await supabase
    .from('generation_jobs')
    .select('id, status')
    .eq('user_id', userId)
    .in('status', ['queued', 'running'])
    .maybeSingle();
  if (active) {
    return apiError('ACTIVE_JOB_EXISTS', '이전 생성이 진행 중입니다', { activeJobId: active.id });
  }

  // Plan v0.2.6 M3-1: 모든 package job 도 workspace (organization) 컨텍스트를
  // 갖는다. orgSlug 없으면 MY organization 으로 default.
  let orgIdSnapshot: string;
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
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    if (!member) {
      return apiError('FORBIDDEN', '이 조직의 멤버가 아니에요');
    }
    orgIdSnapshot = orgId;
  } else {
    const { data: myOrg } = await supabase
      .from('organizations')
      .select('id')
      .eq('owner_id', userId)
      .eq('type', 'personal')
      .is('deleted_at', null)
      .maybeSingle();
    if (!myOrg) {
      return apiError('INTERNAL_ERROR', '워크스페이스가 아직 준비되지 않았어요');
    }
    orgIdSnapshot = (myOrg as { id: string }).id;
  }

  // Plan v0.2.8 §M3-3: package 도 workspace pool 에서 차감. Job insert 이후
  // use_tokens 를 원자적으로 호출. 실패 시 job + 이미 삽입된 slot 정리.
  // version 은 Zod default(1) 가 이미 채워두지만 명시적으로 저장.
  const packagePlanSnapshot = {
    version: body.packagePlan.version,
    purpose: body.packagePlan.purpose,
    topicOrEvent: body.packagePlan.topicOrEvent,
    target: body.packagePlan.target,
    styleTone: body.packagePlan.styleTone,
    additionalRequest: body.packagePlan.additionalRequest,
    usageChannels: body.packagePlan.usageChannels,
    keywords: body.packagePlan.keywords,
  };

  const jobService = createSupabaseServiceClient();

  // Conversation 링크 유효성 확인 — Package 는 UI 가 채워진 form 이라 사용자가
  // 즉시 submit 하는 경우 message POST 등록이 job insert 보다 늦게 도착해
  // FK 위반이 발생하기 쉬웠음. 존재하지 않으면 NULL 로 저장.
  const resolvedLink = await resolveConversationLink(
    jobService,
    userId,
    body.conversationId,
    body.messageId,
  );

  const { data: job, error: jobError } = await jobService
    .from('generation_jobs')
    .insert({
      user_id: userId,
      prompt: buildPackagePromptSummary(body),
      batch_size: totalSlots,
      diversity_level: 0,
      reference_image_id: null,
      custom_reference_r2_key: null,
      school_profile_applied: body.schoolProfileApplied,
      aspect_ratio: 'square',
      reserved_credits: totalSlots,
      status: 'queued',
      org_id: orgIdSnapshot,
      slot_prompts: null,
      kind: 'package',
      package_plan: packagePlanSnapshot,
      conversation_id: resolvedLink.conversationId,
      message_id: resolvedLink.messageId,
    })
    .select('id')
    .single();

  if (jobError || !job) {
    console.error('[jobs POST package] job insert failed', {
      code: jobError?.code,
      message: jobError?.message,
      hint: jobError?.hint,
      details: jobError?.details,
    });
    if (jobError && isSchemaNotReadyError(jobError.code)) {
      return apiError(
        'PACKAGE_SCHEMA_NOT_READY',
        '패키지 생성 기능이 아직 준비되지 않았어요. 관리자에게 문의해주세요.',
      );
    }
    return apiError(
      'PACKAGE_JOB_INSERT_FAILED',
      '패키지 생성 요청에 실패했어요. 잠시 후 다시 시도해주세요.',
    );
  }

  const jobId = job.id as string;

  // Job insert 성공 후 크레딧 차감. 실패 시 job 삭제.
  let remainingCredits: number;
  try {
    const useResult = await useOrgTokens({
      organizationId: orgIdSnapshot,
      amount: totalSlots,
      jobId,
      actorUserId: userId,
    });
    remainingCredits = useResult.balance;
  } catch (err) {
    await jobService.from('generation_jobs').delete().eq('id', jobId);
    if (err instanceof InsufficientPoolBalanceError) {
      const { data: poolRow } = await jobService
        .from('token_pools')
        .select('balance')
        .eq('organization_id', orgIdSnapshot)
        .maybeSingle();
      return apiError('INSUFFICIENT_CREDITS', '이 워크스페이스의 크레딧이 부족합니다', {
        remainingCredits: (poolRow as { balance: number } | null)?.balance ?? 0,
        requiredCredits: totalSlots,
      });
    }
    if (err instanceof PoolNotFoundError) {
      return apiError('INTERNAL_ERROR', '워크스페이스 크레딧 풀이 준비되지 않았어요');
    }
    throw err;
  }

  // Slot rows — enabled 항목 × quantity 만큼 flat 배열로 생성.
  // 전역 순서 `order` 는 0..N-1, category 별 순서 `category_order` 는 각
  // category 안에서 다시 0..M-1. 같은 category 가 여러 item 에 나뉘어도
  // counter 는 category 별로 이어진다 (예: 포스터 2 + 포스터 3 → 0..4).
  const slotRows: Array<{
    job_id: string;
    order: number;
    category_order: number;
    category: string;
    name: string;
    prompt_hint: string;
    aspect_ratio: string;
    transparent_background: boolean;
    status: 'pending';
  }> = [];
  let order = 0;
  const categoryCounters = new Map<string, number>();
  for (const item of enabledItems) {
    for (let i = 0; i < item.quantity; i += 1) {
      const categoryOrder = categoryCounters.get(item.category) ?? 0;
      slotRows.push({
        job_id: jobId,
        order,
        category_order: categoryOrder,
        category: item.category,
        name: item.name,
        prompt_hint: item.promptHint,
        aspect_ratio: item.aspectRatio,
        transparent_background: item.transparentBackground,
        status: 'pending',
      });
      order += 1;
      categoryCounters.set(item.category, categoryOrder + 1);
    }
  }

  const { error: slotError } = await jobService
    .from('generation_job_slots')
    .insert(slotRows);

  if (slotError) {
    // Slot insert 실패 — 이미 use_tokens 로 차감된 크레딧을 환불 후 job 정리.
    // CASCADE 로 slots 는 자동 삭제되지만 명시적으로 job 을 지운다.
    try {
      await refundOrgTokens({
        organizationId: orgIdSnapshot,
        amount: totalSlots,
        jobId,
        reason: 'package slot insert failed — full refund',
      });
    } catch (refundErr) {
      console.error('[jobs POST package] slot-fail refund error', refundErr);
    }
    await jobService.from('generation_jobs').delete().eq('id', jobId);
    console.error('[jobs POST package] slot insert failed', {
      code: slotError.code,
      message: slotError.message,
      hint: slotError.hint,
      details: slotError.details,
    });
    if (isSchemaNotReadyError(slotError.code)) {
      return apiError(
        'PACKAGE_SCHEMA_NOT_READY',
        '패키지 생성 기능이 아직 준비되지 않았어요. 관리자에게 문의해주세요.',
      );
    }
    return apiError(
      'PACKAGE_SLOT_INSERT_FAILED',
      '패키지 슬롯 생성에 실패했어요. 잠시 후 다시 시도해주세요.',
    );
  }

  return apiOk(
    {
      jobId,
      kind: 'package' as const,
      reservedCredits: totalSlots,
      remainingCredits,
      totalSlots,
      streamUrl: `/api/jobs/${jobId}/stream`,
    },
    201,
  );
}

/**
 * Package job 의 generation_jobs.prompt 컬럼에 저장할 요약 문자열.
 * 실제 프롬프트 조립은 pipeline 이 slot 단위로 수행하며 이 값은 참고용
 * (예: /library 리스트에서의 batch 요약 표시). 500자 이내로 자름.
 */
function buildPackagePromptSummary(body: CreatePackageJobInput): string {
  const parts: string[] = [];
  if (body.packagePlan.purpose) parts.push(body.packagePlan.purpose);
  if (body.packagePlan.topicOrEvent) parts.push(body.packagePlan.topicOrEvent);
  if (body.packagePlan.target) parts.push(body.packagePlan.target);
  if (body.packagePlan.styleTone) parts.push(body.packagePlan.styleTone);
  const summary = parts.filter(Boolean).join(' · ');
  return summary.slice(0, 500) || 'package';
}
