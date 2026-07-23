'use client';

// Organization image sharing 훅 (P5-C).
//
// - useOrganizationImages(slug, filter): 조직 라이브러리 infinite list.
//     filter=all|unpublished|published (Phase B-1).
// - useShareImage(): 이미지를 여러 조직에 얹기 (개인 상세뷰용).
// - useUnshareImage(): 조직에서 이미지 내리기.
// - useImageSharedOrgs(imageId): 이 이미지가 어떤 조직에 공유돼 있는지.
// - usePublishToCommunity(slug) / useUnpublishFromCommunity(slug):
//     owner 만 사용. 조직 라이브러리 카드에서 단일/배치 공개·해제.

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import type { LibraryImage } from '@/features/library/hooks/useMyImages';

const PAGE_SIZE = 24;

export type OrgLibraryFilter = 'all' | 'unpublished' | 'published';

export interface OrganizationImage extends LibraryImage {
  sharedAt: string;
  sharedByUserId: string;
  communitySourceOrganizationId: string | null;
}

interface ListResponse {
  images: OrganizationImage[];
  total: number;
  limit: number;
  offset: number;
}

export function useOrganizationImages(
  slug: string | null,
  filter: OrgLibraryFilter = 'all',
  sort: 'newest' | 'oldest' = 'newest',
) {
  return useInfiniteQuery({
    queryKey: ['org-images', slug, filter, sort] as const,
    queryFn: async ({ pageParam }): Promise<ListResponse> => {
      if (!slug) throw new Error('no slug');
      const params = new URLSearchParams({
        filter,
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

// P5-C Phase B-1: 조직 라이브러리에서 owner 가 공유 라이브러리로 승격/해제.
// 서버가 403 등을 반환하면 그대로 throw — UI 에서 toast 로 사용자에게 노출.
// 단일 이미지도 배치와 동일한 endpoint 사용 (imageIds 배열에 한 개 담아 전송).

export function usePublishToCommunity(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      imageIds: string[],
    ): Promise<{ publishedCount: number; skippedCount: number }> => {
      const res = await fetch(`/api/organizations/${slug}/community/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageIds }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '공유 라이브러리 공개 실패');
      }
      const json = (await res.json()) as {
        data: { publishedCount: number; skippedCount: number };
      };
      return json.data;
    },
    onSuccess: (_data, imageIds) => {
      qc.invalidateQueries({ queryKey: ['org-images', slug] });
      for (const id of imageIds) {
        qc.invalidateQueries({ queryKey: ['image-detail', id] });
        qc.invalidateQueries({ queryKey: ['image-shared-orgs', id] });
      }
    },
  });
}

export function useUnpublishFromCommunity(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (imageIds: string[]): Promise<{ unpublishedCount: number }> => {
      const res = await fetch(`/api/organizations/${slug}/community/publish`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageIds }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '공유 라이브러리 해제 실패');
      }
      const json = (await res.json()) as { data: { unpublishedCount: number } };
      return json.data;
    },
    onSuccess: (_data, imageIds) => {
      qc.invalidateQueries({ queryKey: ['org-images', slug] });
      for (const id of imageIds) {
        qc.invalidateQueries({ queryKey: ['image-detail', id] });
        qc.invalidateQueries({ queryKey: ['image-shared-orgs', id] });
      }
    },
  });
}
