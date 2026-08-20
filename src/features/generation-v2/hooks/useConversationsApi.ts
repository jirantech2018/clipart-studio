'use client';

// Conversation Server Storage — client hooks
// Plan Ref: docs/01-plan/features/conversation-server-storage.plan.md §4 §5

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface ServerConversation {
  id: string;
  title: string | null;
  status: 'active' | 'archived' | 'deleted';
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface ServerConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  prompt: string;
  options: unknown;
  packagePlan: unknown;
  status: 'draft' | 'submitted' | 'completed' | 'failed';
  jobId: string | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
}

interface ConversationListResponse {
  conversations: ServerConversation[];
  nextCursor: string | null;
}

// ============================================================
// Query keys
// ============================================================
export const conversationKeys = {
  all: ['conversations'] as const,
  list: (orgSlug: string) => ['conversations', 'list', orgSlug] as const,
  detail: (id: string) => ['conversations', 'detail', id] as const,
};

// ============================================================
// Fetch helpers
// ============================================================
async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const parsed = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(parsed?.error?.message ?? fallback);
  }
  const body = (await res.json()) as { data: T };
  return body.data;
}

// ============================================================
// Queries
// ============================================================

// 사이드바용 최근 20건 (D-2: cursor 기반 확장은 향후 UI 에서 붙임).
export function useConversationsList(organizationSlug: string | null | undefined) {
  return useQuery({
    queryKey: conversationKeys.list(organizationSlug ?? ''),
    enabled: Boolean(organizationSlug),
    queryFn: async () => {
      const params = new URLSearchParams({
        organizationSlug: organizationSlug!,
        limit: '20',
      });
      const res = await fetch(`/api/conversations?${params}`, { cache: 'no-store' });
      return jsonOrThrow<ConversationListResponse>(res, '대화 목록 조회 실패');
    },
    staleTime: 10_000,
  });
}

// ============================================================
// Mutations
// ============================================================

// 새 대화 생성 (클라이언트가 id 를 미리 만들어 idempotent).
export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; organizationSlug: string }) => {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return jsonOrThrow<ServerConversation>(res, '대화 생성 실패');
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: conversationKeys.list(vars.organizationSlug) });
    },
  });
}

// 대화 제목 · 상태 변경.
export function usePatchConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      title?: string | null;
      status?: 'active' | 'archived';
    }) => {
      const { id, ...patch } = input;
      const res = await fetch(`/api/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      return jsonOrThrow<{ id: string; title: string | null; status: string }>(
        res,
        '대화 수정 실패',
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: conversationKeys.all });
    },
  });
}

// Soft delete.
export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      return jsonOrThrow<{ id: string }>(res, '대화 삭제 실패');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: conversationKeys.all });
    },
  });
}

// 메시지 신규 upsert (신규 Block draft).
export function useCreateMessage() {
  return useMutation({
    mutationFn: async (input: {
      conversationId: string;
      id?: string;
      role?: 'user' | 'assistant' | 'system';
      prompt?: string;
      options?: unknown;
      packagePlan?: unknown;
      status?: 'draft' | 'submitted' | 'completed' | 'failed';
      orderIndex?: number;
    }) => {
      const { conversationId, ...body } = input;
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return jsonOrThrow<ServerConversationMessage>(res, '메시지 생성 실패');
    },
  });
}

// draft 저장 (debounce 훅에서 사용).
export async function patchMessage(input: {
  id: string;
  prompt?: string;
  options?: unknown;
  packagePlan?: unknown;
  status?: 'draft' | 'submitted' | 'completed' | 'failed';
  jobId?: string | null;
}) {
  const { id, ...patch } = input;
  const res = await fetch(`/api/messages/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return jsonOrThrow<ServerConversationMessage>(res, '메시지 수정 실패');
}

// keepalive 버전 — pagehide / visibilitychange 시 종료 상황에서도 전송 보장.
// 서버 응답을 기다리지 않고 fire-and-continue.
export function patchMessageKeepalive(input: {
  id: string;
  prompt?: string;
  options?: unknown;
  packagePlan?: unknown;
  status?: 'draft' | 'submitted' | 'completed' | 'failed';
  jobId?: string | null;
}) {
  const { id, ...patch } = input;
  try {
    fetch(`/api/messages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
      keepalive: true,
    });
  } catch {
    // 종료 상황이므로 로깅 무의미. 다음 hydration 에서 서버 값으로 정정.
  }
}

// Legacy migration — 로그인 후 마운트 시 1회 실행.
export async function migrateLegacyConversations(payload: {
  conversations: Array<{
    id: string;
    title?: string | null;
    createdAt?: string;
    updatedAt?: string;
    organizationSlug?: string;
    blocks: Array<{
      id: string;
      prompt: string;
      options?: unknown;
      status?: string;
      jobId?: string | null;
      createdAt?: string;
    }>;
  }>;
}) {
  const res = await fetch('/api/conversations/migrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return jsonOrThrow<{ importedConversations: number; importedMessages: number }>(
    res,
    '이전 대화 이관 실패',
  );
}
