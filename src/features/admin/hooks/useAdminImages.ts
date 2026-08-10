'use client';

// M5: Super Admin 전체 이미지 조회·trash·restore 훅.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface AdminImageRow {
  id: string;
  userId: string;
  ownerEmail: string | null;
  organizationId: string | null;
  organizationName: string | null;
  organizationSlug: string | null;
  organizationType: 'personal' | 'school' | 'general' | null;
  prompt: string;
  thumbnailUrl: string;
  createdAt: string;
  trashStatus: 'ACTIVE' | 'TRASHED';
  trashedAt: string | null;
  trashReason: string | null;
  trashActorType: 'USER' | 'ORG_ADMIN' | 'SUPER_ADMIN' | null;
  trashedByEmail: string | null;
}

export interface AdminImagesFilters {
  status: 'all' | 'active' | 'trashed';
  type: 'all' | 'personal' | 'general';
  organizationId?: string;
  dateFrom?: string;
  dateTo?: string;
}

const KEY = (f: AdminImagesFilters) =>
  ['admin', 'images', f.status, f.type, f.organizationId ?? '', f.dateFrom ?? '', f.dateTo ?? ''] as const;

export function useAdminImages(filters: AdminImagesFilters) {
  return useQuery({
    queryKey: KEY(filters),
    queryFn: async (): Promise<{ images: AdminImageRow[]; total: number }> => {
      const params = new URLSearchParams();
      if (filters.status !== 'all') params.set('status', filters.status);
      if (filters.type !== 'all') params.set('type', filters.type);
      if (filters.organizationId) params.set('organizationId', filters.organizationId);
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
      params.set('limit', '48');
      const res = await fetch(`/api/admin/images?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('이미지 목록 조회 실패');
      const json = (await res.json()) as {
        data: { images: AdminImageRow[]; total: number };
      };
      return json.data;
    },
    staleTime: 5_000,
  });
}

export type AdminTrashReason =
  | 'LOW_QUALITY'
  | 'GENERATION_ERROR'
  | 'TEXT_ERROR'
  | 'DUPLICATE'
  | 'INAPPROPRIATE'
  | 'OTHER';

export function useAdminTrashImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      reason,
      memo,
    }: {
      id: string;
      reason: AdminTrashReason;
      memo?: string;
    }) => {
      const res = await fetch(`/api/admin/images/${id}/trash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, memo }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '휴지통 이동 실패');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'images'] });
      qc.invalidateQueries({ queryKey: ['images'] });
    },
  });
}

export function useAdminRestoreImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/images/${id}/restore`, { method: 'POST' });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '복원 실패');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'images'] });
      qc.invalidateQueries({ queryKey: ['images'] });
    },
  });
}
