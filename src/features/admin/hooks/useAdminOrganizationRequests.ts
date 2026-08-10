'use client';

// Plan M4: Admin 조직 개설 신청 훅.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { OrganizationRequest, OrganizationRequestStatus } from '@/types/domain';

const KEY = (status: string) => ['admin', 'organization-requests', status] as const;
const ALL_KEY = ['admin', 'organization-requests'] as const;

export type AdminRequestFilter = 'all' | OrganizationRequestStatus;

export function useAdminOrganizationRequests(status: AdminRequestFilter) {
  return useQuery({
    queryKey: KEY(status),
    queryFn: async (): Promise<{ requests: OrganizationRequest[] }> => {
      const res = await fetch(`/api/admin/organization-requests?status=${status}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('신청 목록을 불러오지 못했어요');
      const json = (await res.json()) as { data: { requests: OrganizationRequest[] } };
      return json.data;
    },
    staleTime: 5_000,
  });
}

async function post(url: string, body?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(json?.error?.message ?? '처리 실패');
  }
  return (await res.json()) as unknown;
}

export function useStartReviewRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => post(`/api/admin/organization-requests/${id}/start-review`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ALL_KEY });
    },
  });
}

export function useApproveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      post(`/api/admin/organization-requests/${id}/approve`) as Promise<{
        data: { organizationId: string; slug: string };
      }>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ALL_KEY });
      qc.invalidateQueries({ queryKey: ['organizations'] });
      qc.invalidateQueries({ queryKey: ['admin', 'token-dashboard'] });
    },
  });
}

export function useRejectRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      post(`/api/admin/organization-requests/${id}/reject`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ALL_KEY });
    },
  });
}
