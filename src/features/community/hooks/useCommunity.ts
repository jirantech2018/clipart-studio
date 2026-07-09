'use client';

// Design Ref: §5.4 Community feed hook — newest / popular sort, optional category filter.

import { useQuery } from '@tanstack/react-query';

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

async function fetchCommunity(
  category: string | null,
  sort: CommunitySort,
): Promise<CommunityResponse> {
  const params = new URLSearchParams({ sort });
  if (category) params.set('category', category);
  const res = await fetch(`/api/community?${params.toString()}`);
  if (!res.ok) throw new Error('Community 피드를 불러오지 못했습니다');
  const json = (await res.json()) as { data: CommunityResponse };
  return json.data;
}

export function useCommunity(category: string | null, sort: CommunitySort) {
  return useQuery({
    queryKey: ['community', category, sort],
    queryFn: () => fetchCommunity(category, sort),
  });
}
