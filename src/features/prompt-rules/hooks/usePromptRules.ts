'use client';

// 관리자 페이지에서 사용하는 prompt_rules CRUD + preview 훅.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { PromptRule, PromptRuleCategory } from '@/types/domain';

const QUERY_KEY = ['prompt-rules'] as const;

interface ListResponse {
  rules: PromptRule[];
}

interface SingleResponse {
  rule: PromptRule;
}

async function fetchList(): Promise<ListResponse> {
  const res = await fetch('/api/admin/prompt-rules', { cache: 'no-store' });
  if (!res.ok) throw new Error('규칙 목록을 불러오지 못했어요');
  const json = (await res.json()) as { data: ListResponse };
  return json.data;
}

export function usePromptRules() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchList,
    staleTime: 15_000,
  });
}

export interface CreatePromptRuleInput {
  name: string;
  category: PromptRuleCategory;
  tags?: string[];
  priority?: number;
  enabled?: boolean;
  content: string;
}

export function useCreatePromptRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePromptRuleInput) => {
      const res = await fetch('/api/admin/prompt-rules', {
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
      const json = (await res.json()) as { data: SingleResponse };
      return json.data.rule;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export interface UpdatePromptRuleInput {
  id: string;
  patch: Partial<Omit<CreatePromptRuleInput, 'category'>> & {
    category?: PromptRuleCategory;
  };
}

export function useUpdatePromptRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: UpdatePromptRuleInput) => {
      const res = await fetch(`/api/admin/prompt-rules/${id}`, {
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
      const json = (await res.json()) as { data: SingleResponse };
      return json.data.rule;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useDeletePromptRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/prompt-rules/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '삭제 실패');
      }
      return id;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

// Preview: 사용자 프롬프트 넣으면 매칭된 rule + 최종 프롬프트 반환.
export interface PreviewResult {
  appliedRules: {
    id: string;
    name: string;
    category: PromptRuleCategory;
    priority: number;
  }[];
  droppedRules: {
    id: string;
    name: string;
    category: PromptRuleCategory;
    priority: number;
  }[];
  finalPrompt: string;
  finalLength: number;
  totalActiveRules: number;
}

export function usePromptRulePreview() {
  return useMutation({
    mutationFn: async (prompt: string): Promise<PreviewResult> => {
      const res = await fetch('/api/admin/prompt-rules/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '미리보기 실패');
      }
      const json = (await res.json()) as { data: PreviewResult };
      return json.data;
    },
  });
}
