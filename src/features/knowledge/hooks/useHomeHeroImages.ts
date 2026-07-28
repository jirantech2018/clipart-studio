'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { HomeHeroImage } from '@/app/api/admin/home-hero-images/route';

const LIST_KEY = ['admin', 'home-hero-images'] as const;

interface ListResponse {
  images: HomeHeroImage[];
}

export function useHomeHeroImages() {
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: async (): Promise<ListResponse> => {
      const res = await fetch('/api/admin/home-hero-images', { cache: 'no-store' });
      if (!res.ok) throw new Error('히어로 이미지를 불러오지 못했어요');
      const json = (await res.json()) as { data: ListResponse };
      return json.data;
    },
    staleTime: 10_000,
  });
}

export function useUploadHomeHeroImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<HomeHeroImage> => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/admin/home-hero-images', {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '업로드 실패');
      }
      const json = (await res.json()) as { data: { image: HomeHeroImage } };
      return json.data.image;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useCurateHomeHeroImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (imageId: string): Promise<HomeHeroImage> => {
      const res = await fetch('/api/admin/home-hero-images/from-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '배너 등록 실패');
      }
      const json = (await res.json()) as { data: { image: HomeHeroImage } };
      return json.data.image;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useDeleteHomeHeroImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/home-hero-images/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '삭제 실패');
      }
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}
