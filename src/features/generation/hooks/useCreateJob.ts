'use client';

// Design Ref: §4.2 POST /api/jobs contract
// Plan SC: FR-05 batch request, FR-12 credit reserve

import { useMutation } from '@tanstack/react-query';

import { useAuthStore } from '@/lib/store/authStore';
import { useGenerationStore } from '@/lib/store/generationStore';

import type { ApiResult } from '@/types/api';
import type { CreateJobInput } from '@/types/schemas';

interface CreateJobResponse {
  jobId: string;
  reservedCredits: number;
  remainingCredits: number;
  streamUrl: string;
}

export class CreateJobError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'CreateJobError';
    this.code = code;
    this.details = details;
  }
}

async function postJob(input: CreateJobInput): Promise<CreateJobResponse> {
  const res = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = (await res.json()) as ApiResult<CreateJobResponse>;
  if (!res.ok || 'error' in json) {
    const err = 'error' in json ? json.error : { code: 'INTERNAL_ERROR', message: '요청 실패' };
    throw new CreateJobError(err.code, err.message, err.details);
  }
  return json.data;
}

export function useCreateJob() {
  const startJob = useGenerationStore((s) => s.startJob);
  const updateStoreCredits = useAuthStore((s) => s.updateCredits);

  return useMutation({
    mutationFn: postJob,
    onSuccess: (data, variables) => {
      startJob(data.jobId, variables.batchSize, variables.aspectRatio);
      updateStoreCredits(data.remainingCredits);
    },
  });
}
