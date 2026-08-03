'use client';

// generation-v2 전용 SSE 소비 훅. 기존 useJobStream 은 useGenerationStore 에
// 강결합돼 있어 그대로 재사용 시 두 페이지의 상태가 섞임. 여기서는 로직만
// 재현하되 target 을 { convId, blockId } 로 받아 useConversationStore 의
// 해당 Block 에 이벤트를 반영한다.

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { useAuthStore } from '@/lib/store/authStore';
import { useConversationStore } from '@/lib/store/conversationStore';

interface ImageReadyEvent {
  imageId: string;
  thumbnailUrl: string;
  order: number;
}

interface ChunkFailedEvent {
  order: number;
  error: string;
  refundedCredits: number;
}

interface DoneEvent {
  jobId: string;
  completed: number;
  failed: number;
  refundedCredits: number;
  finalRemainingCredits: number | null;
  canceled?: boolean;
}

interface Params {
  convId: string | null;
  blockId: string | null;
  jobId: string | null;
}

export function useConversationJobStream({ convId, blockId, jobId }: Params) {
  const queryClient = useQueryClient();
  const markGenerating = useConversationStore((s) => s.markBlockGenerating);
  const appendImage = useConversationStore((s) => s.appendBlockImage);
  const appendFailure = useConversationStore((s) => s.appendBlockFailure);
  const markCompleted = useConversationStore((s) => s.markBlockCompleted);
  const markFailed = useConversationStore((s) => s.markBlockFailed);
  const updateStoreCredits = useAuthStore((s) => s.updateCredits);

  useEffect(() => {
    if (!jobId || !convId || !blockId) return;

    const source = new EventSource(`/api/jobs/${jobId}/stream`);
    markGenerating(convId, blockId);

    let reconciled = false;

    source.addEventListener('image_ready', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as ImageReadyEvent;
      appendImage(convId, blockId, {
        imageId: data.imageId,
        thumbnailUrl: data.thumbnailUrl,
        order: data.order,
      });
    });

    source.addEventListener('chunk_failed', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as ChunkFailedEvent;
      appendFailure(convId, blockId, { order: data.order, error: data.error });
      updateStoreCredits(useAuthStore.getState().profile?.credits ?? 0);
      toast.warning(`이미지 ${data.order + 1}번 실패`, {
        description: data.error,
      });
    });

    source.addEventListener('done', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as DoneEvent;
      markCompleted(convId, blockId);
      if (data.finalRemainingCredits !== null) {
        updateStoreCredits(data.finalRemainingCredits);
      }
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['jobs', data.jobId] });
      source.close();
    });

    async function reconcile() {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          data?: { status?: string };
        };
        const status = json.data?.status;
        if (status === 'done' || status === 'partial') {
          markCompleted(convId!, blockId!);
          queryClient.invalidateQueries({ queryKey: ['profile'] });
          toast.success('이미지 생성이 완료됐어요.');
          return;
        }
        if (status === 'failed' || status === 'canceled') {
          markFailed(convId!, blockId!, '스트림이 조기 종료됐어요');
          return;
        }
      } catch (err) {
        console.error('[useConversationJobStream] reconcile failed', err);
      }
      markFailed(convId!, blockId!, '스트림 연결이 끊어졌어요');
      toast.error('실시간 연결 오류. 페이지를 새로고침해주세요.');
    }

    source.onerror = () => {
      if (reconciled) return;
      reconciled = true;
      source.close();
      void reconcile();
    };

    return () => {
      source.close();
    };
    // convId / blockId 는 이번 실행에서 고정. jobId 만 트리거.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);
}
