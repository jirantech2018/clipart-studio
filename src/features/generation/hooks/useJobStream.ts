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

    // onerror 가 여러 번 fire 되어도 reconcile 은 한 번만.
    let reconciled = false;

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

    // EventSource 는 서버 close / 프록시 timeout / 재접속 실패 등 다양한 원인으로
    // onerror 를 fire 한다. 진실은 항상 서버측 job status 이므로, 그것을 조회해서
    // 실제 잡이 이미 완료됐다면 정상 종료로 처리하고, 아직 실행 중인데 연결만
    // 끊어졌다면 진짜 에러로 처리한다.
    async function reconcile() {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          data?: {
            status?: string;
            batch_size?: number;
            refunded_credits?: number;
          };
        };
        const status = json.data?.status;
        const batchSize = json.data?.batch_size ?? 0;
        const refunded = json.data?.refunded_credits ?? 0;

        if (
          status === 'done' ||
          status === 'partial' ||
          status === 'failed'
        ) {
          // 서버는 이미 결론을 냈다. SSE 를 놓쳤을 뿐이니 정상 종료 처리.
          finish({
            completed: Math.max(0, batchSize - refunded),
            failed: refunded,
            refundedCredits: refunded,
            finalRemainingCredits: null,
          });
          queryClient.invalidateQueries({ queryKey: ['profile'] });
          queryClient.invalidateQueries({ queryKey: ['jobs', jobId] });
          toast.success('이미지 생성이 완료됐어요.', {
            description: '일부 이미지가 화면에 안 보이면 라이브러리에서 확인해주세요.',
          });
          return;
        }
      } catch (err) {
        console.error('[useJobStream] status reconcile failed', err);
      }

      // 잡이 아직 queued/running 이거나 조회 자체가 실패 — 진짜 에러.
      fail('스트림 연결이 끊어졌습니다');
      toast.error('실시간 연결 오류. 페이지를 새로고침해주세요.');
    }

    source.onerror = () => {
      if (reconciled) return;
      reconciled = true;

      // 이미 done 처리됐으면 조회 필요 없음.
      const state = useGenerationStore.getState();
      if (state.streamStatus === 'done') {
        source.close();
        return;
      }

      // 재접속을 즉시 차단하고 서버측 진실을 조회.
      source.close();
      void reconcile();
    };

    return () => {
      source.close();
    };
  }, [jobId, markStreaming, appendCard, appendFailure, finish, fail, queryClient, updateStoreCredits]);
}
