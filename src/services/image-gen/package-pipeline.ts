// Package generation pipeline.
//
// 하나의 package job 아래 여러 slot 이 각기 다른 prompt hint / aspect ratio /
// transparent background 로 이미지 하나씩 만든다.
//
// 핵심 정책 (Phase 2 지시서):
//   1. Slot claim 은 반드시 원자적 UPDATE (WHERE status='pending' + RETURNING).
//      RETURNING 이 비어 있으면 다른 요청/재접속 loop 이 이미 잡은 것 → skip.
//   2. 실행 후 상태는 done / failed / canceled 로만 전이. running 을 임의로
//      되돌리지 않는다 (Phase 2 는 stuck 복구 없음).
//   3. Slot 실패 → refundCredits(1). refunded_at 을 UPDATE 로 원자 마킹해
//      중복 환불 방지.
//   4. Image 는 batch_id (job.id) + package_slot_id 양방향으로 저장.
//
// 파일 자체는 pure server (Node runtime) — Route 에서 chunk 단위로 호출.

import { randomUUID } from 'node:crypto';

import { primaryAdapter } from '@/services/image-gen';
import { refundCredits } from '@/services/credit';
import { publicUrl, putObject } from '@/services/r2/upload';
import { createSupabaseServiceClient } from '@/services/supabase/server';
import { ASPECT_RATIO_DIMENSIONS, aspectRatioSizeString } from '@/types/domain';

import type {
  GenerationJob,
  PackageJobSlot,
  SchoolProfile,
} from '@/types/domain';

export interface PackageSlotResult {
  slotId: string;
  order: number;
  category: string;
  name: string;
  status: 'done' | 'failed' | 'skipped';
  imageId?: string;
  r2Key?: string;
  error?: string;
}

interface RunPackageSlotParams {
  job: GenerationJob;
  slot: PackageJobSlot;
  schoolProfile: SchoolProfile | null;
  orgBasePrompt: string | null;
}

/**
 * DB row → PackageJobSlot 매핑. snake_case → camelCase.
 */
export function slotFromRow(row: Record<string, unknown>): PackageJobSlot {
  return {
    id: row.id as string,
    jobId: row.job_id as string,
    order: row.order as number,
    // Migration 055 이전 row 는 category_order 컬럼이 없거나 backfill 로 0.
    categoryOrder: (row.category_order as number) ?? 0,
    category: row.category as string,
    name: row.name as string,
    promptHint: (row.prompt_hint as string) ?? '',
    aspectRatio: row.aspect_ratio as PackageJobSlot['aspectRatio'],
    transparentBackground: (row.transparent_background as boolean) ?? false,
    status: row.status as PackageJobSlot['status'],
    imageId: (row.image_id as string) ?? null,
    error: (row.error as string) ?? null,
    // Migration 055 이전 row 는 final_prompt 컬럼 없음 → null.
    finalPrompt: (row.final_prompt as string) ?? null,
    startedAt: (row.started_at as string) ?? null,
    completedAt: (row.completed_at as string) ?? null,
    refundedAt: (row.refunded_at as string) ?? null,
    attemptCount: (row.attempt_count as number) ?? 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * 원자적 slot claim.
 *   pending → running (started_at 세팅, attempt_count 증가)
 * RETURNING 결과가 없으면 (다른 워커가 이미 claim 또는 상태가 이미 다른 값)
 * null 반환 → 호출자는 skip.
 */
export async function claimSlot(slotId: string): Promise<PackageJobSlot | null> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from('generation_job_slots')
    .update({
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .eq('id', slotId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[package-pipeline] claim failed', slotId, error);
    return null;
  }
  if (!data) return null;

  // attempt_count 는 별도 원자 증가. UPDATE returning 안에서 함께 처리하려면
  // rpc 가 필요하지만 여기서는 후속 UPDATE 로 근사 (단일 워커 정책이라 race 낮음).
  await service
    .from('generation_job_slots')
    .update({ attempt_count: ((data as { attempt_count?: number }).attempt_count ?? 0) + 1 })
    .eq('id', slotId);

  return slotFromRow(data);
}

/**
 * Slot 실패 시: status='failed' + error 저장 + refunded_at 원자 마킹 후 환불.
 * refunded_at 이 이미 있으면 double refund 방지.
 */
export async function markSlotFailedAndRefund(
  slot: PackageJobSlot,
  userId: string,
  errorMessage: string,
): Promise<{ refunded: boolean }> {
  const service = createSupabaseServiceClient();
  // 상태 + refunded_at 을 한 번의 UPDATE 에서 원자적으로 잡는다.
  const { data, error } = await service
    .from('generation_job_slots')
    .update({
      status: 'failed',
      error: errorMessage.slice(0, 500),
      completed_at: new Date().toISOString(),
      refunded_at: new Date().toISOString(),
    })
    .eq('id', slot.id)
    .is('refunded_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[package-pipeline] mark failed error', slot.id, error);
    return { refunded: false };
  }
  if (!data) {
    // 이미 다른 경로가 환불 확정 → 중복 환불 방지.
    return { refunded: false };
  }
  try {
    await refundCredits(userId, 1);
  } catch (err) {
    console.error('[package-pipeline] refund failed for slot', slot.id, err);
  }
  return { refunded: true };
}

/**
 * Slot 취소 (미착수): pending → canceled 원자 전이 + 환불.
 * running 상태 slot 은 취소 대상 아님 (이미 외부 API 요청 시작). 이 함수는
 * 오직 pending 만 잡는다.
 */
export async function cancelPendingSlot(
  slotId: string,
  userId: string,
): Promise<{ canceled: boolean; refunded: boolean }> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from('generation_job_slots')
    .update({
      status: 'canceled',
      completed_at: new Date().toISOString(),
      refunded_at: new Date().toISOString(),
    })
    .eq('id', slotId)
    .eq('status', 'pending')
    .is('refunded_at', null)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[package-pipeline] cancel pending failed', slotId, error);
    return { canceled: false, refunded: false };
  }
  if (!data) return { canceled: false, refunded: false };
  try {
    await refundCredits(userId, 1);
  } catch (err) {
    console.error('[package-pipeline] refund on cancel failed', slotId, err);
    return { canceled: true, refunded: false };
  }
  return { canceled: true, refunded: true };
}

/**
 * 하나의 package slot 실행 — 이미지 생성 → R2 업로드 → images row → slot 상태 확정.
 * 성공 시 status='done' + image_id 세팅. 실패는 caller 가 markSlotFailedAndRefund 호출.
 */
export async function runPackageSlot({
  job,
  slot,
  schoolProfile,
  orgBasePrompt,
}: RunPackageSlotParams): Promise<PackageSlotResult> {
  const adapter = primaryAdapter();
  const service = createSupabaseServiceClient();

  const finalPrompt = assemblePackagePrompt({
    job,
    slot,
    schoolProfile,
    orgBasePrompt,
  });

  const size = aspectRatioSizeString(slot.aspectRatio);
  const dims = ASPECT_RATIO_DIMENSIONS[slot.aspectRatio];

  const gen = await adapter.generate({
    prompt: finalPrompt,
    mode: 'text2img',
    size,
  });

  const imageId = randomUUID();
  const ext = gen.contentType === 'image/webp' ? 'webp' : 'png';
  const r2Key = `users/${job.userId}/${imageId}.${ext}`;

  await putObject({ key: r2Key, body: gen.imageBytes, contentType: gen.contentType });

  const { error: insertErr } = await service.from('images').insert({
    id: imageId,
    user_id: job.userId,
    prompt: finalPrompt.slice(0, 1000),
    model: gen.model,
    seed: gen.seed,
    r2_key: r2Key,
    batch_id: job.id,
    package_slot_id: slot.id,
    generation_mode: 'text2img',
    reference_image_id: null,
    parent_image_id: null,
    school_profile_applied: job.schoolProfileApplied,
    status: 'saved',
    pending_expires_at: null,
    width: dims.width,
    height: dims.height,
  });
  if (insertErr) throw new Error(`insert images failed: ${insertErr.message}`);

  const { error: slotErr } = await service
    .from('generation_job_slots')
    .update({
      status: 'done',
      image_id: imageId,
      completed_at: new Date().toISOString(),
    })
    .eq('id', slot.id);
  if (slotErr) {
    // 상태 업데이트만 실패했지만 이미지는 이미 저장됨. best-effort 로 로그.
    console.error('[package-pipeline] slot done UPDATE failed', slot.id, slotErr);
  }

  return {
    slotId: slot.id,
    order: slot.order,
    category: slot.category,
    name: slot.name,
    status: 'done',
    imageId,
    r2Key,
  };
}

/**
 * Slot 프롬프트 조립 (지시서 §11 순서).
 *   조직 기본 → 학교 → 목적 → 주제 → 대상 → 스타일 → 활용 목적 → keyword
 *   → slot.promptHint → 추가 요청 → 투명 배경/출력 지시
 * package 는 img2img / 조직 참조 이미지 / chaining 을 사용하지 않는다.
 */
function assemblePackagePrompt({
  job,
  slot,
  schoolProfile,
  orgBasePrompt,
}: RunPackageSlotParams): string {
  const plan = job.packagePlan;
  const parts: string[] = [];

  if (orgBasePrompt) parts.push(orgBasePrompt);
  else if (job.schoolProfileApplied && schoolProfile?.basePrompt) {
    parts.push(schoolProfile.basePrompt);
  }

  if (plan) {
    if (plan.purpose) parts.push(`목적: ${plan.purpose}`);
    if (plan.topicOrEvent) parts.push(`주제: ${plan.topicOrEvent}`);
    if (plan.target) parts.push(`대상: ${plan.target}`);
    if (plan.styleTone) parts.push(`스타일: ${plan.styleTone}`);
    if (plan.usageChannels.length > 0) {
      parts.push(`활용 목적: ${plan.usageChannels.join(', ')}`);
    }
    if (plan.keywords.length > 0) {
      parts.push(`핵심 키워드: ${plan.keywords.join(', ')}`);
    }
  }

  parts.push(`결과물: ${slot.name}`);
  if (slot.promptHint) parts.push(slot.promptHint);

  if (plan?.additionalRequest) parts.push(plan.additionalRequest);

  if (slot.transparentBackground) {
    parts.push('배경 투명, PNG 형식');
  }

  return parts.filter(Boolean).join('. ');
}
