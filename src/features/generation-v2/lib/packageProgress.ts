// Package Job Progress 계산 — Generating UI 와 재진입 복구 훅이 공유하는
// 순수 함수. GET /api/jobs/:id 의 slots 배열 (camelCase) 을 입력으로 받아
// 전체·category 별 진행 정보를 낸다.
//
// 규칙 (Phase 3 지시서):
//   completed = done + failed + canceled  (분자)
//   total     = 전체 Slot 수                (분모)
//   percent   = Math.floor(completed / total * 100)   — 실제 값보다 크게
//               표시되지 않도록 절삭. total==0 이면 0.
//   Category 그룹 순서 = 해당 category 의 최소 order 오름차순
//   Category 내부 순서 = categoryOrder 오름차순 (Legacy 는 order fallback)

import type { CompletedImage, FailedSlot } from '@/lib/store/conversationStore';
import type { AspectRatio } from '@/types/domain';

export type SlotStatus = 'pending' | 'running' | 'done' | 'failed' | 'canceled';

/** GET /api/jobs/:id 의 slots 배열 원소 shape. 서버 응답과 정확히 일치. */
export interface PackageJobSlotResponse {
  id: string;
  order: number;
  categoryOrder: number;
  category: string;
  name: string;
  status: SlotStatus;
  aspectRatio: AspectRatio;
  imageId: string | null;
  thumbnailUrl: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CategoryProgress {
  category: string;
  completed: number;
  running: number;
  pending: number;
  done: number;
  failed: number;
  canceled: number;
  total: number;
  percent: number;
  /** 그룹 정렬 기준 (해당 category 의 최소 order). */
  firstOrder: number;
  /** 이 category 소속 slot 목록 (categoryOrder 오름차순, Legacy 는 order fallback). */
  slots: PackageJobSlotResponse[];
}

export interface PackageProgress {
  completed: number;
  running: number;
  pending: number;
  done: number;
  failed: number;
  canceled: number;
  total: number;
  percent: number;
  /** firstOrder 오름차순으로 정렬된 category 그룹 목록. */
  categories: CategoryProgress[];
}

/**
 * Slot 배열에서 전체·category 진행 정보를 계산한다. 순수 함수 — 입력이 같으면
 * 항상 같은 결과. Generating UI 와 재진입 복구 훅에서 공용으로 사용.
 */
export function computePackageProgress(
  slots: PackageJobSlotResponse[],
): PackageProgress {
  const totals = {
    done: 0,
    failed: 0,
    canceled: 0,
    running: 0,
    pending: 0,
  };
  const groups = new Map<string, CategoryProgress>();

  for (const slot of slots) {
    totals[slot.status] += 1;

    let group = groups.get(slot.category);
    if (!group) {
      group = {
        category: slot.category,
        completed: 0,
        running: 0,
        pending: 0,
        done: 0,
        failed: 0,
        canceled: 0,
        total: 0,
        percent: 0,
        firstOrder: slot.order,
        slots: [],
      };
      groups.set(slot.category, group);
    }
    group.slots.push(slot);
    group.total += 1;
    group[slot.status] += 1;
    if (slot.order < group.firstOrder) group.firstOrder = slot.order;
  }

  // Category 내부 정렬 + percent 계산.
  for (const group of groups.values()) {
    group.slots.sort((a, b) => {
      // categoryOrder 우선. Legacy (동시에 0) 이면 order fallback.
      if (a.categoryOrder !== b.categoryOrder) {
        return a.categoryOrder - b.categoryOrder;
      }
      return a.order - b.order;
    });
    group.completed = group.done + group.failed + group.canceled;
    group.percent =
      group.total === 0 ? 0 : Math.floor((group.completed / group.total) * 100);
  }

  const total = slots.length;
  const completed = totals.done + totals.failed + totals.canceled;
  const percent = total === 0 ? 0 : Math.floor((completed / total) * 100);

  const categories = Array.from(groups.values()).sort(
    (a, b) => a.firstOrder - b.firstOrder,
  );

  return {
    completed,
    running: totals.running,
    pending: totals.pending,
    done: totals.done,
    failed: totals.failed,
    canceled: totals.canceled,
    total,
    percent,
    categories,
  };
}

/**
 * 재진입 fetch 로 확보한 slot 마스터 목록 위에, 진행 중 SSE 로 수신된
 * 성공/실패 이벤트를 덮어써 최신 slot 상태를 만든다.
 *
 * - master slot 의 metadata (id, order, categoryOrder, category, name,
 *   aspectRatio) 는 그대로 유지
 * - block.succeeded[i].slotId 가 master.id 와 매치되면 status='done' 으로
 *   승격 + imageId/thumbnailUrl 보정 (fetch 시점 이후 도착한 이미지)
 * - block.failed[i].order 가 master.order 와 매치되면 status='failed' + error
 *
 * master 가 null (fetch 아직 미도착) 이면 빈 배열 반환.
 */
export function mergeSlotsWithBlockState(
  masterSlots: PackageJobSlotResponse[] | null,
  succeeded: CompletedImage[],
  failed: FailedSlot[],
): PackageJobSlotResponse[] {
  if (!masterSlots) return [];

  const succeededById = new Map<string, CompletedImage>();
  for (const img of succeeded) {
    if (img.slotId) succeededById.set(img.slotId, img);
  }
  const failedByOrder = new Map<number, FailedSlot>();
  for (const f of failed) failedByOrder.set(f.order, f);

  return masterSlots.map((slot) => {
    const done = succeededById.get(slot.id);
    if (done) {
      return {
        ...slot,
        status: 'done' as const,
        imageId: done.imageId,
        thumbnailUrl: done.thumbnailUrl,
      };
    }
    const fail = failedByOrder.get(slot.order);
    if (fail) {
      return {
        ...slot,
        status: 'failed' as const,
        error: fail.error,
      };
    }
    return slot;
  });
}
