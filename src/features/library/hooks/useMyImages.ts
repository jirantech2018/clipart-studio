'use client';

// Design Ref: §5.4 Library Page — filter + sort + card action mutations
// Plan SC: FR-08 saved library, FR-13 publish toggle, FR-19 delete

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

import type { Image, ImageVisibility } from '@/types/domain';

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

/**
 * 이미지의 visibility 를 갱신하는 mutation. 소유자만 RLS 통과.
 *
 * P5-C Phase A 이후 서버 계약 변경:
 *   - isOnCommunity 를 넘기면 서버가 403 을 반환 (개인의 커뮤니티 직접
 *     공개 경로가 폐쇄됨). 인터페이스는 남기지만 실제로 사용하면 실패한다.
 *     UI 는 Phase B 에서 버튼 자체를 제거하는 방향으로 정리.
 *   - 링크 공유(visibility='authenticated') 는 계속 소유자가 승격 가능.
 */
export interface UpdateImageVisibilityInput {
  id: string;
  visibility?: ImageVisibility;
  /** @deprecated 서버가 403. 조직 라이브러리 배치 API 로 대체. */
  isOnCommunity?: boolean;
}

export function useUpdateImageVisibility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, visibility, isOnCommunity }: UpdateImageVisibilityInput) => {
      const body: Record<string, unknown> = {};
      if (visibility !== undefined) body.visibility = visibility;
      if (isOnCommunity !== undefined) body.isOnCommunity = isOnCommunity;

      const res = await fetch(`/api/images/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '공개 설정 변경 실패');
      }
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['images'] });
      queryClient.invalidateQueries({ queryKey: ['image-detail', vars.id] });
    },
  });
}

/**
 * Downloads the image file. The server route proxies the R2 bytes with
 * Content-Disposition: attachment so the browser saves rather than opens it,
 * and it logs the download_events row for the reuse-rate KPI.
 */
export async function downloadImageFile(id: string): Promise<void> {
  const res = await fetch(`/api/images/${id}/download`, { method: 'POST' });
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(json?.error?.message ?? '다운로드 실패');
  }

  const blob = await res.blob();
  const filename =
    parseFilenameFromContentDisposition(res.headers.get('content-disposition')) ??
    `clipart-${id}.${blob.type === 'image/webp' ? 'webp' : 'png'}`;

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

function parseFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  // 표준 형식: filename="clipart-xxx.png" 그리고 UTF-8 지원 형식: filename*=UTF-8''...
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8Match && utf8Match[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      // fall through
    }
  }
  const plainMatch = /filename="([^"]+)"/i.exec(header);
  return plainMatch?.[1] ?? null;
}

/**
 * 여러 이미지를 서버에서 zip 으로 묶어 다운로드. 서버가 scope 별로 사용자
 * 접근 권한을 재검증하고, 개수/총용량 상한을 확인한 뒤 스트리밍으로 응답한다.
 *
 * scope:
 *   - 'library'   : 본인 소유 이미지만 허용
 *   - 'community' : is_on_community=TRUE 인 이미지만 허용
 */
export async function downloadImagesAsZip(
  ids: string[],
  scope: 'library' | 'community',
): Promise<void> {
  const res = await fetch('/api/images/download-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, scope }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(json?.error?.message ?? 'ZIP 다운로드 실패');
  }

  const blob = await res.blob();
  const filename =
    parseFilenameFromContentDisposition(res.headers.get('content-disposition')) ??
    `clipart-studio-${new Date().toISOString().slice(0, 10)}.zip`;

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
