'use client';

// Design Ref: §5.4 Community feed hook — newest / popular sort, optional category filter.

import { useInfiniteQuery } from '@tanstack/react-query';

import type { AccountType } from '@/types/domain';

export type CommunitySort = 'newest' | 'popular';

export interface CommunityImage {
  id: string;
  userId: string;
  prompt: string;
  model: string;
  seed: number | null;
  parentImageId: string | null;
  generationMode: string;
  schoolProfileApplied: boolean;
  width: number;
  height: number;
  createdAt: string;
  thumbnailUrl: string;
  tags: string[];
  categories: string[];
  authorType: AccountType;
  authorSchoolName: string | null;
  downloadCount: number;
}

interface CommunityResponse {
  images: CommunityImage[];
  total: number;
  limit: number;
  offset: number;
  category: string | null;
  sort: CommunitySort;
}

const PAGE_SIZE = 24;

async function fetchCommunityPage(
  category: string | null,
  sort: CommunitySort,
  offset: number,
): Promise<CommunityResponse> {
  const params = new URLSearchParams({
    sort,
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  if (category) params.set('category', category);
  const res = await fetch(`/api/community?${params.toString()}`);
  if (!res.ok) throw new Error('워크스페이스 피드를 불러오지 못했습니다');
  const json = (await res.json()) as { data: CommunityResponse };
  return json.data;
}

export function useCommunity(category: string | null, sort: CommunitySort) {
  return useInfiniteQuery({
    queryKey: ['community', category, sort],
    queryFn: ({ pageParam }) =>
      fetchCommunityPage(category, sort, pageParam as number),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const fetched = allPages.reduce((sum, p) => sum + p.images.length, 0);
      if (fetched >= lastPage.total) return undefined;
      return fetched;
    },
  });
}
