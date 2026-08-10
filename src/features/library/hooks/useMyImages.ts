'use client';

// Design Ref: §5.4 Library Page — filter + sort + card action mutations
// Plan SC: FR-08 saved library, FR-13 publish toggle, FR-19 delete

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

import { useLoadingStore } from '@/lib/store/loadingStore';

import type { Image, ImageVisibility } from '@/types/domain';

export type LibraryFilter = 'all' | 'public';
export type LibrarySort = 'newest' | 'oldest';
/** Plan v0.2.7 §M3-2 (C 방향) — 조직 라이브러리 3-tab. 개인 라이브러리에는
 *  scope 를 넘기지 않고 서버가 'all' 로 처리. */
export type LibraryScope = 'all' | 'created' | 'shared';
/** M5 — 라이브러리 vs 휴지통 뷰. */
export type LibraryTrash = 'active' | 'trashed';

export interface LibraryImage extends Image {
  thumbnailUrl: string;
  tags: string[];
  categories: string[];
  /** 서버가 채워주면 카드에 공유 조직 라벨 표시. 조직 라이브러리 응답에는 없다. */
  sharedOrgs?: { slug: string; name: string }[];
  /** M5 — 휴지통 카드 표시용. ACTIVE 이면 null. */
  trashStatus?: 'ACTIVE' | 'TRASHED';
  trashedAt?: string | null;
  trashedByEmail?: string | null;
  trashReason?: string | null;
  trashActorType?: 'USER' | 'ORG_ADMIN' | 'SUPER_ADMIN' | null;
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
  organizationSlug?: string,
  scope?: LibraryScope,
  trash: LibraryTrash = 'active',
): Promise<ListResponse> {
  const params = new URLSearchParams({
    filter,
    sort,
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  if (organizationSlug) params.set('organizationSlug', organizationSlug);
  if (scope && scope !== 'all') params.set('scope', scope);
  if (trash !== 'active') params.set('trash', trash);
  const url = `/api/images?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    // 원본 상세 (status/body) 는 콘솔에 남겨 디버깅. throw 는 사용자 문구만.
    const text = await res.text().catch(() => '');
    // eslint-disable-next-line no-console
    console.error('[useMyImages] fetch failed', {
      url,
      status: res.status,
      statusText: res.statusText,
      body: text.slice(0, 500),
    });
    throw new Error('이미지 목록을 불러오지 못했습니다');
  }
  const json = (await res.json().catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[useMyImages] JSON parse failed', { url, error: e });
    return null;
  })) as { data?: ListResponse } | null;
  // 응답 shape 이 예상과 다르면 error 로 취급 — 빈 배열로 위장하지 않는다.
  if (
    !json?.data ||
    !Array.isArray(json.data.images) ||
    typeof json.data.total !== 'number'
  ) {
    // eslint-disable-next-line no-console
    console.error('[useMyImages] unexpected response shape', { url, json });
    throw new Error('이미지 목록 응답 형식이 올바르지 않습니다');
  }
  return json.data;
}

export function useMyImages(
  filter: LibraryFilter,
  sort: LibrarySort,
  organizationSlug?: string,
  scope: LibraryScope = 'all',
  trash: LibraryTrash = 'active',
) {
  return useInfiniteQuery({
    // organizationSlug + scope + trash 를 queryKey 에 포함해 workspace/tab
    // 전환 시 자동 refetch.
    queryKey: [
      'images',
      filter,
      sort,
      organizationSlug ?? '__personal__',
      scope,
      trash,
    ],
    queryFn: ({ pageParam }) =>
      fetchImagesPage(filter, sort, pageParam as number, organizationSlug, scope, trash),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const fetched = allPages.reduce((sum, p) => sum + p.images.length, 0);
      if (fetched >= lastPage.total) return undefined;
      return fetched;
    },
  });
}

// M5: trash / restore mutations.
export function useTrashImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const res = await fetch(`/api/images/${id}/trash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '휴지통 이동 실패');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['images'] });
    },
  });
}

export function useRestoreImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/images/${id}/restore`, { method: 'POST' });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '복원 실패');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['images'] });
    },
  });
}

/**
 * 이미지의 visibility 를 갱신하는 mutation. 소유자만 RLS 통과.
 *
 * P5-C Phase B 이후: 커뮤니티(is_on_community) 조작 경로는 완전히 제거.
 * 공유 라이브러리 승격은 조직 라이브러리에서 조직 owner 만 배치 API 로 처리.
 * 이 훅은 이제 visibility 만 다룬다 (링크 공유용 authenticated 승격 등).
 */
export interface UpdateImageVisibilityInput {
  id: string;
  visibility: ImageVisibility;
}

export function useUpdateImageVisibility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, visibility }: UpdateImageVisibilityInput) => {
      const res = await fetch(`/api/images/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility }),
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
  // 상단 프로그레스 바 활성화 — try/finally 로 실패해도 반드시 stop.
  useLoadingStore.getState().start();
  try {
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
  } finally {
    useLoadingStore.getState().stop();
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
