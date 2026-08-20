// Package job submit helper.
//
// PackageOptionCard 의 CTA 가 호출한다. store 의 packagePlan 을 서버 payload
// 로 변환해 /api/jobs 로 POST. 응답 (jobId, streamUrl, totalSlots) 을 반환.
//
// 사용자 편집 상태 (itemState) 를 최종 items 로 병합. enabled=false 인 항목은
// 애초에 payload 에 포함시키지 않는다 (서버가 다시 필터하지만 client 에서
// 정확한 총합을 계산해 상한 검증 통과).

import { selectVisibleItems, selectVisibleKeywords } from './mergePackagePlan';
import { PACKAGE_JOB_TOTAL_MAX } from '@/types/schemas';

import type { PackagePlanState } from './packagePlanTypes';

export interface PackageSubmitResponse {
  jobId: string;
  kind: 'package';
  reservedCredits: number;
  remainingCredits: number;
  totalSlots: number;
  streamUrl: string;
}

export class PackageSubmitError extends Error {
  code: string;
  fieldErrors?: Record<string, string[]>;
  constructor(code: string, message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export function buildPackageSubmitPayload(
  plan: PackagePlanState,
  orgSlug: string,
  link?: { conversationId?: string; messageId?: string },
) {
  const visibleItems = selectVisibleItems(plan);
  const keywords = selectVisibleKeywords(plan);
  const enabled = visibleItems.filter((it) => it.enabled && it.quantity > 0);
  const items = enabled.map((it) => ({
    id: it.id,
    category: it.category,
    name: it.name,
    promptHint: it.promptHint,
    aspectRatio: it.aspectRatio,
    transparentBackground: it.transparentBackground,
    quantity: it.quantity,
    enabled: true,
  }));

  return {
    kind: 'package' as const,
    // Plan v0.2.6 M3-1: 항상 현재 Workspace slug 를 함께 전송 → 서버가
    // organization_id 세팅 (MY 는 hidden personal-{user_id}, 학교는 그 조직).
    orgSlug,
    packagePlan: {
      version: 1,
      purpose: plan.purpose,
      topicOrEvent: plan.topicOrEvent,
      target: plan.target,
      styleTone: plan.styleTone,
      additionalRequest: plan.additionalRequest,
      usageChannels: plan.usageChannels,
      keywords,
    },
    items,
    schoolProfileApplied: false,
    // Migration 076: 대화 컨텍스트 링크. 신규 클라이언트만 채우고, 서버 Zod
    // 스키마는 optional 이라 미전달 호출과 완전 호환.
    ...(link?.conversationId ? { conversationId: link.conversationId } : {}),
    ...(link?.messageId ? { messageId: link.messageId } : {}),
  };
}

export function computePackageTotalSlots(plan: PackagePlanState): number {
  const visible = selectVisibleItems(plan);
  return visible
    .filter((it) => it.enabled)
    .reduce((sum, it) => sum + it.quantity, 0);
}

export function canSubmitPackage(plan: PackagePlanState): boolean {
  const total = computePackageTotalSlots(plan);
  if (total < 1 || total > PACKAGE_JOB_TOTAL_MAX) return false;
  if (!plan.purpose.trim() || !plan.target.trim() || !plan.styleTone.trim()) {
    return false;
  }
  return true;
}

export async function submitPackage(
  plan: PackagePlanState,
  orgSlug: string,
  link?: { conversationId?: string; messageId?: string },
): Promise<PackageSubmitResponse> {
  const payload = buildPackageSubmitPayload(plan, orgSlug, link);
  const res = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => null)) as
    | { data: PackageSubmitResponse }
    | {
        error: {
          code: string;
          message: string;
          details?: { fieldErrors?: Record<string, string[]> };
        };
      }
    | null;
  if (!res.ok || !json || 'error' in json) {
    const err = json && 'error' in json ? json.error : undefined;
    throw new PackageSubmitError(
      err?.code ?? 'INTERNAL_ERROR',
      err?.message ?? '패키지 생성 요청 실패',
      err?.details?.fieldErrors,
    );
  }
  return json.data;
}
