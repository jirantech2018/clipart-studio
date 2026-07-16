'use client';

// Design Ref: §5.4 Image Detail Page — TanStack Query wrapper for GET /api/images/[id]/detail

import { useQuery } from '@tanstack/react-query';

export interface ImageDetail {
  id: string;
  userId: string;
  prompt: string;
  model: string;
  seed: number | null;
  isPublic: boolean;
  isShareable: boolean;
  parentImageId: string | null;
  batchId: string | null;
  generationMode: string;
  referenceImageId: string | null;
  schoolProfileApplied: boolean;
  width: number;
  height: number;
  createdAt: string;
  fullUrl: string;
  thumbnailUrl: string;
  tags: string[];
  categories: string[];
  isOwner: boolean;
}

async function fetchImageDetail(id: string): Promise<ImageDetail> {
  const res = await fetch(`/api/images/${id}/detail`);
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(json?.error?.message ?? '이미지를 불러오지 못했어요');
  }
  const json = (await res.json()) as { data: ImageDetail };
  return json.data;
}

export function useImageDetail(id: string) {
  return useQuery({
    queryKey: ['image-detail', id],
    queryFn: () => fetchImageDetail(id),
    enabled: !!id,
  });
}
