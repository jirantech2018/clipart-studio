'use client';

// Plan M4: 사용자 조직 개설 신청 훅.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { OrganizationRequest } from '@/types/domain';
import type { CreateOrganizationRequestInput } from '@/types/schemas';

const KEY = ['organization-requests'] as const;

export function useMyOrganizationRequests() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<{ requests: OrganizationRequest[] }> => {
      const res = await fetch('/api/organization-requests', { cache: 'no-store' });
      if (!res.ok) throw new Error('신청 목록을 불러오지 못했어요');
      const json = (await res.json()) as { data: { requests: OrganizationRequest[] } };
      return json.data;
    },
    staleTime: 5_000,
  });
}

export function useCreateOrganizationRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: CreateOrganizationRequestInput,
    ): Promise<OrganizationRequest> => {
      const res = await fetch('/api/organization-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string; fieldErrors?: Record<string, string[]> };
        } | null;
        throw new Error(json?.error?.message ?? '신청 실패');
      }
      const json = (await res.json()) as { data: { request: OrganizationRequest } };
      return json.data.request;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}
