'use client';

// 조직 참조 이미지 슬롯 훅 (P5-D-B).
// GET · POST(FormData) · DELETE 커버. sort 는 서버가 sort_order 정순으로 반환.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface OrgReferenceImage {
  id: string;
  organizationId: string;
  r2Key: string;
  url: string;
  filename: string | null;
  width: number;
  height: number;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string;
}

interface ListResponse {
  references: OrgReferenceImage[];
  limit: number;
}

const listKey = (slug: string) => ['org-reference-images', slug] as const;

export function useOrganizationReferenceImages(slug: string | null) {
  return useQuery({
    queryKey: slug ? listKey(slug) : ['org-reference-images', 'none'],
    queryFn: async (): Promise<ListResponse> => {
      if (!slug) throw new Error('no slug');
      const res = await fetch(`/api/organizations/${slug}/reference-images`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '참조 이미지 조회 실패');
      }
      const json = (await res.json()) as { data: ListResponse };
      return json.data;
    },
    enabled: !!slug,
  });
}

export function useUploadOrgReferenceImage(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<OrgReferenceImage> => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/organizations/${slug}/reference-images`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '업로드 실패');
      }
      const json = (await res.json()) as { data: { reference: OrgReferenceImage } };
      return json.data.reference;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: listKey(slug) }),
  });
}

export function useDeleteOrgReferenceImage(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/organizations/${slug}/reference-images/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '삭제 실패');
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: listKey(slug) }),
  });
}

export function useUploadOrgLogo(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<{ avatarUrl: string }> => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/organizations/${slug}/logo`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '로고 업로드 실패');
      }
      const json = (await res.json()) as { data: { avatarUrl: string } };
      return json.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organizations', slug] });
      qc.invalidateQueries({ queryKey: ['organizations'] });
    },
  });
}
