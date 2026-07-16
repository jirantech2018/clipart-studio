'use client';

// Organization CRUD 훅 (P5-A).
// 모든 요청은 /api/organizations/* 로 가고, 서버가 RLS + API 검증을 수행.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Organization, OrganizationWithMyRole } from '@/types/domain';

const LIST_KEY = ['organizations'] as const;
const detailKey = (slug: string) => ['organizations', slug] as const;

interface ListResponse {
  organizations: OrganizationWithMyRole[];
}
interface DetailResponse {
  organization: OrganizationWithMyRole;
}

export function useMyOrganizations() {
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: async (): Promise<ListResponse> => {
      const res = await fetch('/api/organizations', { cache: 'no-store' });
      if (!res.ok) throw new Error('조직 목록을 불러오지 못했어요');
      const json = (await res.json()) as { data: ListResponse };
      return json.data;
    },
    staleTime: 10_000,
  });
}

export function useOrganization(slug: string | null) {
  return useQuery({
    queryKey: slug ? detailKey(slug) : ['organizations', 'none'],
    queryFn: async (): Promise<DetailResponse> => {
      if (!slug) throw new Error('no slug');
      const res = await fetch(`/api/organizations/${slug}`, { cache: 'no-store' });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '조직을 불러오지 못했어요');
      }
      const json = (await res.json()) as { data: DetailResponse };
      return json.data;
    },
    enabled: !!slug,
    staleTime: 5_000,
  });
}

export interface CreateOrganizationInput {
  slug: string;
  name: string;
  description?: string;
  homepageUrl?: string;
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateOrganizationInput): Promise<Organization> => {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string; fieldErrors?: Record<string, string[]> };
        } | null;
        throw new Error(json?.error?.message ?? '조직 생성 실패');
      }
      const json = (await res.json()) as { data: { organization: Organization } };
      return json.data.organization;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export interface UpdateOrganizationInput {
  slug: string;
  patch: {
    name?: string;
    description?: string;
    homepageUrl?: string | null;
    avatarUrl?: string | null;
    maxVisibility?: 'private' | 'organization' | 'authenticated' | 'public';
  };
}

export function useUpdateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ slug, patch }: UpdateOrganizationInput) => {
      const res = await fetch(`/api/organizations/${slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '수정 실패');
      }
      const json = (await res.json()) as { data: DetailResponse };
      return json.data.organization;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: detailKey(data.slug) });
    },
  });
}

export function useDeleteOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slug: string) => {
      const res = await fetch(`/api/organizations/${slug}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '삭제 실패');
      }
      return slug;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}
