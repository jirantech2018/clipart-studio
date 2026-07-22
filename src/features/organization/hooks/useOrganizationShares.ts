'use client';

// Organization image sharing 훅 (P5-C).
//
// - useOrganizationImages(slug): 조직 라이브러리 (공유된 이미지) infinite list.
// - useShareToOrgs(imageId): 하나의 이미지를 여러 조직에 얹기.
// - useUnshareFromOrg(slug): 이 조직에서 특정 이미지 내리기.
// - useImageSharedOrgs(imageId): 이 이미지가 어떤 조직에 공유돼 있는지.

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import type { LibraryImage } from '@/features/library/hooks/useMyImages';

const PAGE_SIZE = 24;

export interface OrganizationImage extends LibraryImage {
  sharedAt: string;
  sharedByUserId: string;
}

interface ListResponse {
  images: OrganizationImage[];
  total: number;
  limit: number;
  offset: number;
}

export function useOrganizationImages(slug: string | null, sort: 'newest' | 'oldest' = 'newest') {
  return useInfiniteQuery({
    queryKey: ['org-images', slug, sort] as const,
    queryFn: async ({ pageParam }): Promise<ListResponse> => {
      if (!slug) throw new Error('no slug');
      const params = new URLSearchParams({
        sort,
        limit: String(PAGE_SIZE),
        offset: String(pageParam ?? 0),
      });
      const res = await fetch(`/api/organizations/${slug}/images?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '이미지 목록을 불러오지 못했어요');
      }
      const json = (await res.json()) as { data: ListResponse };
      return json.data;
    },
    initialPageParam: 0 as number,
    getNextPageParam: (lastPage, allPages) => {
      const fetched = allPages.reduce((sum, p) => sum + p.images.length, 0);
      if (fetched >= lastPage.total) return undefined;
      return fetched;
    },
    enabled: !!slug,
  });
}

export interface SharedOrg {
  slug: string;
  name: string;
  organizationId: string;
  sharedAt: string;
}

export function useImageSharedOrgs(imageId: string | null) {
  return useQuery({
    queryKey: ['image-shared-orgs', imageId] as const,
    queryFn: async (): Promise<{ orgs: SharedOrg[] }> => {
      if (!imageId) throw new Error('no imageId');
      const res = await fetch(`/api/images/${imageId}/shared-orgs`, { cache: 'no-store' });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '공유 정보를 불러오지 못했어요');
      }
      const json = (await res.json()) as { data: { orgs: SharedOrg[] } };
      return json.data;
    },
    enabled: !!imageId,
  });
}

export function useShareImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      slug,
      imageIds,
    }: {
      slug: string;
      imageIds: string[];
    }): Promise<{ sharedCount: number; skippedCount: number }> => {
      const res = await fetch(`/api/organizations/${slug}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageIds }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '공유 실패');
      }
      const json = (await res.json()) as {
        data: { sharedCount: number; skippedCount: number };
      };
      return json.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['org-images', vars.slug] });
      for (const id of vars.imageIds) {
        qc.invalidateQueries({ queryKey: ['image-shared-orgs', id] });
      }
    },
  });
}

export function useUnshareImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ slug, imageId }: { slug: string; imageId: string }) => {
      const res = await fetch(`/api/organizations/${slug}/shares/${imageId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '공유 해제 실패');
      }
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['org-images', vars.slug] });
      qc.invalidateQueries({ queryKey: ['image-shared-orgs', vars.imageId] });
    },
  });
}
