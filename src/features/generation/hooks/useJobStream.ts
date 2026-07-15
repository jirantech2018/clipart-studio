'use client';

// Design Ref: §4.2 GET /api/jobs/:id/stream — SSE consumer
// Design Ref: §6.2 SSE error handling via event channel
// Plan SC: FR-20 SSE streaming

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { useAuthStore } from '@/lib/store/authStore';
import { useGenerationStore } from '@/lib/store/generationStore';

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
}

export function useJobStream(jobId: string | null) {
  const queryClient = useQueryClient();
  const markStreaming = useGenerationStore((s) => s.markStreaming);
  const appendCard = useGenerationStore((s) => s.appendCard);
  const appendFailure = useGenerationStore((s) => s.appendFailure);
  const finish = useGenerationStore((s) => s.finish);
  const fail = useGenerationStore((s) => s.fail);
  const updateStoreCredits = useAuthStore((s) => s.updateCredits);

  useEffect(() => {
    if (!jobId) return;

    const source = new EventSource(`/api/jobs/${jobId}/stream`);
    markStreaming();

    source.addEventListener('image_ready', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as ImageReadyEvent;
      appendCard({
        imageId: data.imageId,
        thumbnailUrl: data.thumbnailUrl,
        order: data.order,
      });
    });

    source.addEventListener('chunk_failed', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as ChunkFailedEvent;
      appendFailure({ order: data.order, error: data.error });
      updateStoreCredits(useAuthStore.getState().profile?.credits ?? 0);
      toast.warning(`이미지 ${data.order + 1}번 실패`, {
        description: data.error,
      });
    });

    source.addEventListener('done', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as DoneEvent;
      finish({
        completed: data.completed,
        failed: data.failed,
        refundedCredits: data.refundedCredits,
        finalRemainingCredits: data.finalRemainingCredits,
      });
      if (data.finalRemainingCredits !== null) {
        updateStoreCredits(data.finalRemainingCredits);
      }
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['jobs', data.jobId] });
      source.close();
    });

    source.onerror = () => {
      // 잡이 이미 done 이라면 브라우저 자동 재접속 실패로 인한 onerror — 무시.
      const state = useGenerationStore.getState();
      if (state.streamStatus === 'done') {
        source.close();
        return;
      }
      // EventSource 는 서버가 stream close 하면 자동 재접속을 시도한다. 그 시점에
      // readyState=CONNECTING 으로 잠깐 진입하는데, done 이벤트 처리와 경합이 나면
      // 이 onerror 가 먼저 fire 될 수 있다. 재접속 시도 상태면 진짜 에러가 아니니
      // 우리가 명시적으로 close 만 하고 종료.
      if (source.readyState === EventSource.CONNECTING) {
        source.close();
        return;
      }
      fail('스트림 연결이 끊어졌습니다');
      toast.error('실시간 연결 오류. 페이지를 새로고침해주세요.');
      source.close();
    };

    return () => {
      source.close();
    };
  }, [jobId, markStreaming, appendCard, appendFailure, finish, fail, queryClient, updateStoreCredits]);
}
