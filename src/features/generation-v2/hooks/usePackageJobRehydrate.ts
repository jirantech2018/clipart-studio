'use client';

// Package Job 재진입 복구 훅.
//
// Conversation 진입 시 (== ConversationBlock mount 시) block 이 packageMode
// 이고 status 가 unknown/queued/generating 이며 jobId 를 갖고 있다면 서버에
// 실제 Job + Slot 상태를 한 번 요청해 store 에 반영한다.
//
// 정책:
//   - React Query useQuery({ queryKey: ['jobs', jobId, 'rehydrate'] }) 로
//     동일 jobId 에 대한 중복 요청 자동 dedup.
//   - retry=false — 실패해도 UI 는 기존 persist 값 (또는 unknown) 을 그대로
//     유지. SSE 재연결 흐름은 별개 훅 (useConversationJobStream) 이 담당.
//   - 응답 도착 시 현재 block.status 가 이미 terminal (completed/failed) 이면
//     즉 SSE 가 이미 마무리한 상태라면 서버 응답은 무시 — 최신 정보를 오래된
//     스냅샷으로 되돌리지 않는다.
//   - Job.status == queued/running → block.status = queued/generating 로
//     복원하고, 완료된 slot 들의 이미지·실패 정보를 succeeded/failed 로 미리
//     채워둔다. 그 다음 useConversationJobStream 이 SSE 로 이어서 받는다.
//   - Job.status == done/partial → completed 로 확정.
//   - Job.status == failed → failed (기존 정책 유지).
//   - Job.status == canceled → failed + "생성이 취소되었어요" (BlockStatus 에
//     canceled 는 없음; PackageCompletedStep 이 partial 케이스와 동일하게
//     성공 이미지를 함께 보여줄 수 있게 하려면 canceled 도 completed 로 매핑
//     하는 선택이 있으나, 사용자 인지 명확성을 위해 failed 로 남기고
//     errorMessage 로 이유를 표시).

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useConversationStore } from '@/lib/store/conversationStore';

import type {
  PackageJobSlotResponse,
  SlotStatus as PackageSlotStatus,
} from '@/features/generation-v2/lib/packageProgress';
import type { BlockStatus, CompletedImage, FailedSlot } from '@/lib/store/conversationStore';

type ServerJobStatus =
  | 'queued'
  | 'running'
  | 'partial'
  | 'done'
  | 'failed'
  | 'canceled';

interface PackageJobResponse {
  id: string;
  kind: 'package';
  status: ServerJobStatus;
  error: string | null;
  refunded_credits: number;
  batch_size: number;
  slots: PackageJobSlotResponse[];
}

interface Params {
  convId: string | null;
  blockId: string | null;
  jobId: string | null;
  packageMode: boolean;
  currentStatus: BlockStatus;
}

async function fetchJob(jobId: string): Promise<PackageJobResponse> {
  const res = await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { data: PackageJobResponse };
  return json.data;
}

function mapSlotToCompletedImage(slot: PackageJobSlotResponse): CompletedImage | null {
  if (slot.status !== 'done') return null;
  if (!slot.imageId || !slot.thumbnailUrl) return null;
  return {
    imageId: slot.imageId,
    order: slot.order,
    thumbnailUrl: slot.thumbnailUrl,
    slotId: slot.id,
    category: slot.category,
    categoryOrder: slot.categoryOrder,
    name: slot.name,
    aspectRatio: slot.aspectRatio,
  };
}

function mapSlotToFailedSlot(slot: PackageJobSlotResponse): FailedSlot | null {
  if (slot.status !== 'failed' && slot.status !== 'canceled') return null;
  return {
    order: slot.order,
    error: slot.error ?? (slot.status === 'canceled' ? '취소됨' : '알 수 없는 오류'),
    slotId: slot.id,
    category: slot.category,
    categoryOrder: slot.categoryOrder,
    name: slot.name,
  };
}

function serverStatusToBlockStatus(status: ServerJobStatus): BlockStatus {
  switch (status) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'generating';
    case 'done':
    case 'partial':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'canceled':
      // BlockStatus 에 canceled 는 없음 — failed 로 매핑 (errorMessage 로 구분).
      return 'failed';
  }
}

// SSE 가 이미 상태를 종료(completed/failed)한 뒤 늦게 도착한 fetch 결과가
// 그 상태를 오래된 스냅샷으로 되돌리지 않도록, 현재 block status 가 종결
// 상태면 적용을 스킵한다.
const TERMINAL_BLOCK_STATUSES: BlockStatus[] = ['completed', 'failed'];

export function usePackageJobRehydrate({
  convId,
  blockId,
  jobId,
  packageMode,
  currentStatus,
}: Params) {
  const applyServerJobState = useConversationStore((s) => s.applyServerJobState);
  // Fetch 결과 도착 시 store 의 최신 succeeded/failed 와 병합하기 위해 subscribe.
  // 이 selector 가 반환하는 참조는 store 변경 시 새 배열이므로 useEffect deps
  // 로는 넣지 않는다 (deps 는 query.data 만 트리거로 사용).
  const currentBlock = useConversationStore((s) => {
    if (!convId || !blockId) return null;
    return s.conversations[convId]?.blocks.find((b) => b.id === blockId) ?? null;
  });

  const shouldFetch =
    packageMode &&
    !!jobId &&
    !!convId &&
    !!blockId &&
    (currentStatus === 'unknown' ||
      currentStatus === 'queued' ||
      currentStatus === 'generating');

  const query = useQuery<PackageJobResponse, Error>({
    queryKey: ['jobs', jobId, 'rehydrate'],
    queryFn: () => fetchJob(jobId as string),
    enabled: shouldFetch,
    retry: false,
    // Job 상태는 진입 시점 1회 조회로 충분. SSE 가 이후 실시간을 담당.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  useEffect(() => {
    if (!query.data) return;
    if (!convId || !blockId) return;

    // 이미 SSE 가 종결시킨 상태라면 fetch 결과는 무시.
    // 단, 현재 상태가 unknown 이면 SSE 는 없고 오직 fetch 만이 진실 → 적용.
    if (TERMINAL_BLOCK_STATUSES.includes(currentStatus) && currentStatus !== 'unknown') {
      return;
    }

    const serverStatus = query.data.status;
    const nextBlockStatus = serverStatusToBlockStatus(serverStatus);

    // Fetch 로부터 도출한 succeeded/failed.
    const fetchedSucceeded: CompletedImage[] = [];
    const fetchedFailed: FailedSlot[] = [];
    for (const slot of query.data.slots) {
      const image = mapSlotToCompletedImage(slot);
      if (image) fetchedSucceeded.push(image);
      const failure = mapSlotToFailedSlot(slot);
      if (failure) fetchedFailed.push(failure);
    }

    // SSE 와 병합. Fetch 결과와 store 현재값을 dedup 하여 어느 쪽이 먼저
    // 도착하든 결과가 동일하게. imageId (성공) / order (실패) 를 key.
    const existingSucceeded = currentBlock?.succeeded ?? [];
    const existingFailed = currentBlock?.failed ?? [];

    const succeededMap = new Map<string, CompletedImage>();
    for (const img of existingSucceeded) succeededMap.set(img.imageId, img);
    for (const img of fetchedSucceeded) {
      if (!succeededMap.has(img.imageId)) succeededMap.set(img.imageId, img);
    }
    const failedMap = new Map<number, FailedSlot>();
    for (const f of existingFailed) failedMap.set(f.order, f);
    for (const f of fetchedFailed) {
      if (!failedMap.has(f.order)) failedMap.set(f.order, f);
    }

    const merged = {
      succeeded: Array.from(succeededMap.values()).sort((a, b) => a.order - b.order),
      failed: Array.from(failedMap.values()).sort((a, b) => a.order - b.order),
    };

    const errorMessage =
      serverStatus === 'canceled'
        ? '생성이 취소되었어요'
        : serverStatus === 'failed'
          ? query.data.error ?? '생성에 실패했어요'
          : null;

    applyServerJobState(convId, blockId, {
      status: nextBlockStatus,
      jobId: query.data.id,
      succeeded: merged.succeeded,
      failed: merged.failed,
      errorMessage,
    });
    // deps: query.data 도착 시점에만 실행. 그 사이 도착한 SSE 는 위 병합에서
    // 최신 store 스냅샷을 통해 자연스럽게 포함된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  return {
    isFetching: query.isFetching,
    isError: query.isError,
    serverStatus: query.data?.status ?? null,
    /** Fetch 시점의 slot 마스터 목록 (id · order · categoryOrder · category ·
     *  name · aspectRatio · 초기 status). Generating/Completed UI 는 이 위에
     *  SSE 로 도착한 succeeded/failed 를 병합해 최종 상태를 렌더한다. */
    slotMetadata: query.data?.slots ?? null,
  };
}
