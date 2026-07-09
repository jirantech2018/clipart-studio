'use client';

// Design Ref: §5.4 Search — mine | community | all scope

import { useQuery } from '@tanstack/react-query';

import type { AccountType, Image } from '@/types/domain';

export type SearchScope = 'mine' | 'community' | 'all';

export interface SearchImage extends Image {
  thumbnailUrl: string;
  tags: string[];
  categories: string[];
  isMine: boolean;
  authorType: AccountType;
  authorSchoolName: string | null;
}

interface SearchResponse {
  images: SearchImage[];
  total: number;
  limit: number;
  offset: number;
  query: string;
  scope: SearchScope;
}

async function fetchSearch(q: string, scope: SearchScope): Promise<SearchResponse> {
  const params = new URLSearchParams({ q, scope });
  const res = await fetch(`/api/search?${params.toString()}`);
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(json?.error?.message ?? '검색 실패');
  }
  const json = (await res.json()) as { data: SearchResponse };
  return json.data;
}

export function useSearch(q: string, scope: SearchScope) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: ['search', trimmed, scope],
    queryFn: () => fetchSearch(trimmed, scope),
    enabled: trimmed.length > 0,
  });
}
