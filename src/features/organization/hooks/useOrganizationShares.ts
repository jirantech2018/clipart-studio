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

// P5-C Phase B-2.5: 개인 라이브러리에서 여러 이미지 × 여러 조직 배치 공유.
// 조직 라이브러리까지만 이동하고 커뮤니티 공개는 절대 자동 승격되지 않는다.

export interface ShareBatchResult {
  createdCount: number;
  duplicateCount: number;
  skippedCount: number;
  touchedOrgIds: string[];
}

export function useShareToMultipleOrgs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      imageIds: string[];
      organizationIds: string[];
    }): Promise<ShareBatchResult> => {
      const res = await fetch('/api/images/share-organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '공유 실패');
      }
      const json = (await res.json()) as { data: ShareBatchResult };
      return json.data;
    },
    onSuccess: (data, vars) => {
      // 실제 새로 얹힌 조직 라이브러리 리스트를 새로고침.
      for (const orgId of data.touchedOrgIds) {
        // org-images 는 slug 키라 id 로는 매칭 안 됨. 대신 전체 invalidate.
        qc.invalidateQueries({ queryKey: ['org-images'] });
        void orgId; // 참조 유지
        break;
      }
      // 개별 이미지 shared-orgs 캐시 무효화.
      for (const id of vars.imageIds) {
        qc.invalidateQueries({ queryKey: ['image-shared-orgs', id] });
      }
    },
  });
}

export interface SharePreview {
  eligibleImageCount: number;
  perOrg: { organizationId: string; existingCount: number }[];
}

export function useSharePreview(imageIds: string[], enabled: boolean) {
  return useQuery({
    queryKey: ['share-preview', imageIds.slice().sort().join(',')] as const,
    queryFn: async (): Promise<SharePreview> => {
      const res = await fetch('/api/images/share-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageIds }),
      });
      if (!res.ok) {
        throw new Error('preview 조회 실패');
      }
      const json = (await res.json()) as { data: SharePreview };
      return json.data;
    },
    enabled: enabled && imageIds.length > 0,
    staleTime: 30_000,
  });
}

// P5-C Phase B-2: 조직 라이브러리 ZIP 다운로드.
// 개인 라이브러리와 별도 endpoint 를 쓰기 때문에 downloadImagesAsZip 을
// 확장하지 않고 여기 로컬 헬퍼로 둔다. 응답이 성공하면 브라우저 저장 다이얼로그.
export async function downloadOrgImagesAsZip(
  slug: string,
  imageIds: string[],
): Promise<void> {
  const res = await fetch(`/api/organizations/${slug}/download-zip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageIds }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(json?.error?.message ?? 'ZIP 다운로드 실패');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const filename = utf8Match?.[1]
    ? decodeURIComponent(utf8Match[1])
    : `${slug}-${new Date().toISOString().slice(0, 10)}.zip`;

  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 500);
  }
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
