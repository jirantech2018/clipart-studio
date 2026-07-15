'use client';

// Admin 페이지에서 사용하는 Knowledge + Knowledge Image CRUD 훅.
// 모든 요청은 /api/admin/knowledge/* 로 가고, 서버가 ADMIN_EMAIL 게이트를 처리한다.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Knowledge, KnowledgeImage, ReferenceType } from '@/types/domain';

const LIST_KEY = ['knowledge'] as const;
const detailKey = (id: string) => ['knowledge', id] as const;

interface ListResponse {
  knowledge: Knowledge[];
}
interface DetailResponse {
  knowledge: Knowledge;
}
interface ImageResponse {
  image: KnowledgeImage;
}

async function fetchList(params?: {
  search?: string;
  enabledOnly?: boolean;
}): Promise<ListResponse> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set('search', params.search);
  if (params?.enabledOnly) qs.set('enabled', 'true');
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await fetch(`/api/admin/knowledge${suffix}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Knowledge 목록을 불러오지 못했어요');
  const json = (await res.json()) as { data: ListResponse };
  return json.data;
}

async function fetchDetail(id: string): Promise<DetailResponse> {
  const res = await fetch(`/api/admin/knowledge/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Knowledge 를 불러오지 못했어요');
  const json = (await res.json()) as { data: DetailResponse };
  return json.data;
}

export function useKnowledgeList(params?: {
  search?: string;
  enabledOnly?: boolean;
}) {
  return useQuery({
    queryKey: [...LIST_KEY, params?.search ?? '', params?.enabledOnly ?? false],
    queryFn: () => fetchList(params),
    staleTime: 10_000,
  });
}

export function useKnowledgeDetail(id: string | null) {
  return useQuery({
    queryKey: id ? detailKey(id) : ['knowledge', 'none'],
    queryFn: () => (id ? fetchDetail(id) : Promise.reject(new Error('no id'))),
    enabled: !!id,
    staleTime: 5_000,
  });
}

export interface CreateKnowledgeInput {
  name: string;
  description: string;
  triggers?: string[];
  negativePrompt?: string;
  category?: string;
  sortOrder?: number;
  priority?: number;
  enabled?: boolean;
}

export function useCreateKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateKnowledgeInput) => {
      const res = await fetch('/api/admin/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '생성 실패');
      }
      const json = (await res.json()) as { data: DetailResponse };
      return json.data.knowledge;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export interface UpdateKnowledgeInput {
  id: string;
  patch: Partial<CreateKnowledgeInput>;
}

export function useUpdateKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: UpdateKnowledgeInput) => {
      const res = await fetch(`/api/admin/knowledge/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '수정 실패');
      }
      const json = (await res.json()) as { data: DetailResponse };
      return json.data.knowledge;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: detailKey(data.id) });
    },
  });
}

export function useDeleteKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/knowledge/${id}`, { method: 'DELETE' });
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

export interface UploadKnowledgeImageInput {
  knowledgeId: string;
  file: File;
  referenceType?: ReferenceType;
  caption?: string;
  viewpoint?: string;
  isPrimary?: boolean;
  sortOrder?: number;
}

export function useUploadKnowledgeImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UploadKnowledgeImageInput) => {
      const form = new FormData();
      form.append('file', input.file);
      if (input.referenceType) form.append('reference_type', input.referenceType);
      if (input.caption !== undefined) form.append('caption', input.caption);
      if (input.viewpoint !== undefined) form.append('viewpoint', input.viewpoint);
      if (input.isPrimary !== undefined)
        form.append('is_primary', String(input.isPrimary));
      if (input.sortOrder !== undefined)
        form.append('sort_order', String(input.sortOrder));

      const res = await fetch(`/api/admin/knowledge/${input.knowledgeId}/images`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '업로드 실패');
      }
      const json = (await res.json()) as { data: ImageResponse };
      return json.data.image;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: detailKey(data.knowledgeId) });
    },
  });
}

export interface UpdateKnowledgeImageInput {
  knowledgeId: string;
  imageId: string;
  patch: {
    caption?: string;
    viewpoint?: string;
    referenceType?: ReferenceType;
    isPrimary?: boolean;
    sortOrder?: number;
  };
}

export function useUpdateKnowledgeImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ imageId, patch }: UpdateKnowledgeImageInput) => {
      const res = await fetch(`/api/admin/knowledge/images/${imageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '수정 실패');
      }
      const json = (await res.json()) as { data: ImageResponse };
      return json.data.image;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: detailKey(vars.knowledgeId) });
    },
  });
}

export function useDeleteKnowledgeImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      knowledgeId: _knowledgeId,
      imageId,
    }: {
      knowledgeId: string;
      imageId: string;
    }) => {
      const res = await fetch(`/api/admin/knowledge/images/${imageId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '삭제 실패');
      }
      return imageId;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: detailKey(vars.knowledgeId) });
    },
  });
}
