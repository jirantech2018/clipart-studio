'use client';

// Design Ref: §5.4 Library Page — filter + sort + card action mutations
// Plan SC: FR-08 saved library, FR-13 publish toggle, FR-19 delete

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

import type { Image } from '@/types/domain';

export type LibraryFilter = 'all' | 'public';
export type LibrarySort = 'newest' | 'oldest';

export interface LibraryImage extends Image {
  thumbnailUrl: string;
  tags: string[];
  categories: string[];
}

export type { AspectRatio } from '@/types/domain';

interface ListResponse {
  images: LibraryImage[];
  total: number;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 24;

async function fetchImagesPage(
  filter: LibraryFilter,
  sort: LibrarySort,
  offset: number,
): Promise<ListResponse> {
  const params = new URLSearchParams({
    filter,
    sort,
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  const res = await fetch(`/api/images?${params.toString()}`);
  if (!res.ok) throw new Error('이미지 목록을 불러오지 못했습니다');
  const json = (await res.json()) as { data: ListResponse };
  return json.data;
}

export function useMyImages(filter: LibraryFilter, sort: LibrarySort) {
  return useInfiniteQuery({
    queryKey: ['images', filter, sort],
    queryFn: ({ pageParam }) => fetchImagesPage(filter, sort, pageParam as number),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const fetched = allPages.reduce((sum, p) => sum + p.images.length, 0);
      if (fetched >= lastPage.total) return undefined;
      return fetched;
    },
  });
}

export function usePublishToggle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isPublic }: { id: string; isPublic: boolean }) => {
      const res = await fetch(`/api/images/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '공개 설정 변경 실패');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['images'] });
    },
  });
}

export async function requestDownload(id: string): Promise<string> {
  const res = await fetch(`/api/images/${id}/download`, { method: 'POST' });
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(json?.error?.message ?? '다운로드 실패');
  }
  const json = (await res.json()) as { data: { downloadUrl: string } };
  return json.data.downloadUrl;
}

/**
 * Downloads the image as a real file save even when the R2 URL is cross-origin
 * (where <a download> is otherwise ignored by browsers). Also logs the download
 * event server-side via requestDownload().
 */
export async function downloadImageFile(id: string): Promise<void> {
  const url = await requestDownload(id);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`이미지 다운로드 실패: ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const extFromUrl = url.split('?')[0]?.split('.').pop()?.toLowerCase();
    const ext = extFromUrl === 'webp' ? 'webp' : 'png';
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `clipart-${id}.${ext}`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Give the browser a tick to start the download before we revoke.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 500);
  }
}
