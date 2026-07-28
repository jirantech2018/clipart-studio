'use client';

import { useMutation } from '@tanstack/react-query';

export interface CancelResponse {
  canceled?: boolean;
  alreadyResolved?: boolean;
  status: string;
  batchSize: number;
  succeededCount: number;
  refundedCredits?: number;
  estimatedRefund?: number;
}

export function useCancelJob() {
  return useMutation({
    mutationFn: async (jobId: string): Promise<CancelResponse> => {
      const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '취소 요청에 실패했어요');
      }
      const json = (await res.json()) as { data: CancelResponse };
      return json.data;
    },
  });
}
