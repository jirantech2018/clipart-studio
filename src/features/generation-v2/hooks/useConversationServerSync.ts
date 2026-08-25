'use client';

// Conversation Server Storage — 서버 동기화 코디네이터 훅.
// Plan Ref: docs/01-plan/features/conversation-server-storage.plan.md §5
//
// 하는 일:
//   1) 마운트 시 legacy localStorage → 서버 1회 이관 (idempotent).
//   2) currentId 를 기준으로 새 conversation 이 로컬에서 생성되면 서버 POST.
//   3) 새 Block(=message) 이 로컬에서 추가되면 서버 POST /messages.
//   4) block.prompt / block.options 변경 감지 → 1.5s debounce PATCH.
//   5) block.status 전이 감지 (draft → queued / completed / failed) → PATCH status.
//   6) confirmConversationTitle 로 title 이 채워지면 서버 PATCH.
//
// 원칙:
//   - Supabase 가 SoT. Zustand 는 optimistic + 이탈 방어용.
//   - store 인터페이스는 무변경 — mutation 은 그대로 두고 side effect 만 이 훅에서.

import { useEffect, useRef } from 'react';

import { useMessageDraftAutosave } from '@/features/generation-v2/hooks/useMessageDraftAutosave';
import { useConversationStore } from '@/lib/store/conversationStore';

import {
  migrateLegacyConversations,
  patchMessage,
} from './useConversationsApi';

import type { Conversation } from '@/lib/store/conversationStore';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

/** localStorage flag: 이 유저가 legacy migration 을 완료했는지. */
function migratedFlagKey(userId: string): string {
  return `clipart-conversation-migrated-v1:${userId}`;
}

interface Args {
  /** 현재 로그인 유저 id. legacy migration flag 를 유저별로 분리하기 위함. */
  userId: string | null;
  /** 현재 워크스페이스 slug. 신규 conversation 생성 시 서버에 전달. */
  organizationSlug: string;
}

export function useConversationServerSync({ userId, organizationSlug }: Args) {
  const draftAutosave = useMessageDraftAutosave();

  // 지금까지 서버에 성공적으로 등록했다고 확인된 id 집합. 재요청 방지용.
  const registeredConversationsRef = useRef<Set<string>>(new Set());
  const registeredMessagesRef = useRef<Set<string>>(new Set());
  // 각 conversation 의 서버 등록 Promise. 후속 message POST · title PATCH · status
  // PATCH 는 이 Promise 를 await 한 뒤 실행해 race condition (message 라우트가
  // conversation 존재를 확인하는 지점) 을 피한다.
  const conversationReadyRef = useRef<Map<string, Promise<void>>>(new Map());

  // conversation POST 를 발화하고 Promise 를 등록한다. 이미 시작됐으면 재사용.
  function ensureConversationRegistered(
    id: string,
    organizationSlug: string,
  ): Promise<void> {
    const existing = conversationReadyRef.current.get(id);
    if (existing) return existing;
    const p = fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, organizationSlug }),
    }).then((res) => {
      if (!res.ok) throw new Error(`conversation register failed: ${res.status}`);
    });
    conversationReadyRef.current.set(id, p);
    p.catch((err) => {
      console.warn('[conv-sync] create conversation failed', id, err);
      // 재시도 가능하도록 상태 정리.
      registeredConversationsRef.current.delete(id);
      conversationReadyRef.current.delete(id);
    });
    return p;
  }

  // 이전 상태 스냅샷 — 변경 감지 diff 용.
  const prevRef = useRef<{
    conversations: Record<string, Conversation>;
  } | null>(null);

  // ============================================================
  // (1) Legacy migration — 마운트 시 1회 백그라운드 실행.
  // ============================================================
  useEffect(() => {
    if (!userId) return;
    if (typeof window === 'undefined') return;
    const flagKey = migratedFlagKey(userId);
    if (localStorage.getItem(flagKey)) return;

    // Zustand persist 원본 raw 를 읽는다.
    const raw = localStorage.getItem('clipart-conversation-v2');
    if (!raw) {
      // 이관 대상 없음 → flag 만 세팅해서 재실행 방지.
      localStorage.setItem(flagKey, new Date().toISOString());
      return;
    }
    let parsedConversations: Conversation[] = [];
    try {
      const parsed = JSON.parse(raw) as {
        state?: { conversations?: Record<string, Conversation> };
      };
      parsedConversations = Object.values(parsed.state?.conversations ?? {});
    } catch {
      // 손상된 payload 는 이관 스킵.
      localStorage.setItem(flagKey, new Date().toISOString());
      return;
    }

    const payload = {
      conversations: parsedConversations
        .filter((c) => isUuid(c.id))
        .map((c) => ({
          id: c.id,
          title: c.title,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          organizationSlug: c.organizationSlug,
          blocks: c.blocks
            .filter((b) => isUuid(b.id))
            .map((b) => ({
              id: b.id,
              prompt: b.prompt,
              options: b.options,
              status: b.status,
              jobId: b.jobId,
              createdAt: b.createdAt,
            })),
        })),
    };

    if (payload.conversations.length === 0) {
      localStorage.setItem(flagKey, new Date().toISOString());
      return;
    }

    // 백그라운드로 조용히 실행. 실패 시 flag 안 세팅 → 다음 마운트에 재시도.
    migrateLegacyConversations(payload)
      .then(() => {
        // 서버가 upsert 성공 → flag 세팅. 원본 localStorage 는 삭제하지 않음.
        localStorage.setItem(flagKey, new Date().toISOString());
        // 이관된 conversation/message id 들은 이후 diff 감지에서 신규로 오인
        // 되지 않도록 registered 집합에 미리 넣는다.
        for (const c of payload.conversations) {
          registeredConversationsRef.current.add(c.id);
          for (const b of c.blocks) registeredMessagesRef.current.add(b.id);
        }
      })
      .catch((err) => {
        console.warn('[conversation migrate] failed, will retry next mount', err);
      });
  }, [userId]);

  // ============================================================
  // (2)~(6) Zustand store 변경 감지 → 서버 sync.
  // ============================================================
  useEffect(() => {
    if (!userId) return;

    // 초기 스냅샷 세팅 — 마운트 순간 로컬에 이미 존재하는 conversation/block
    // 은 (legacy 이관 대상이 아니라면) 곧이어 서버 조회로 hydrate 될 것이므로
    // 여기서는 "이미 서버에 존재한다고 가정" 하여 registered 로 표시. legacy
    // 이관 훅이 조금 뒤에 실행되어도 upsert 는 idempotent 라 안전.
    const initial = useConversationStore.getState().conversations;
    for (const [id, conv] of Object.entries(initial)) {
      if (!isUuid(id)) continue;
      registeredConversationsRef.current.add(id);
      // 초기 상태는 서버 hydration 결과이거나 legacy migration 대상 — 어느 쪽이든
      // 서버에 이미 존재한다고 가정. 후속 message/status/title 업데이트가
      // conversation 존재를 대기해야 하므로 즉시 resolve 된 Promise 를 세팅.
      conversationReadyRef.current.set(id, Promise.resolve());
      for (const b of conv.blocks) {
        if (isUuid(b.id)) registeredMessagesRef.current.add(b.id);
      }
    }
    prevRef.current = { conversations: initial };

    const unsubscribe = useConversationStore.subscribe((state) => {
      const prev = prevRef.current;
      prevRef.current = { conversations: state.conversations };
      if (!prev) return;

      for (const [id, conv] of Object.entries(state.conversations)) {
        if (!isUuid(id) || !conv.organizationSlug) continue;

        // (2) 새 conversation 등록 필요? Promise 는 이 대화의 후속 요청 순서
        // 보장에 사용된다.
        let convReady: Promise<void>;
        if (!registeredConversationsRef.current.has(id)) {
          registeredConversationsRef.current.add(id);
          convReady = ensureConversationRegistered(id, conv.organizationSlug);
        } else {
          convReady =
            conversationReadyRef.current.get(id) ?? Promise.resolve();
        }

        // (6) title 변경 감지 → conversation 등록 완료 후 PATCH.
        const prevConv = prev.conversations[id];
        if (prevConv && prevConv.title !== conv.title && conv.title) {
          const newTitle = conv.title;
          convReady
            .then(() =>
              fetch(`/api/conversations/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle }),
              }),
            )
            .catch(() => undefined);
        }

        // Block diff — 각 block 이 새로 생성됐는지, prompt/options/status 가
        // 바뀌었는지 판단.
        for (const b of conv.blocks) {
          if (!isUuid(b.id)) continue;
          const wasRegistered = registeredMessagesRef.current.has(b.id);
          if (!wasRegistered) {
            // (3) 새 message 등록 — conversation 등록 완료 후에 발화.
            registeredMessagesRef.current.add(b.id);
            const messagePayload = {
              id: b.id,
              role: 'user' as const,
              prompt: b.prompt,
              options: b.options,
              status: mapBlockStatus(b.status),
              orderIndex: conv.blocks.indexOf(b),
            };
            convReady
              .then(() =>
                fetch(`/api/conversations/${id}/messages`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(messagePayload),
                }),
              )
              .then((res) => {
                if (!res || !res.ok) {
                  registeredMessagesRef.current.delete(b.id);
                }
              })
              .catch((err) => {
                console.warn('[conv-sync] create message failed', b.id, err);
                registeredMessagesRef.current.delete(b.id);
              });
            continue;
          }

          // (4) prompt / options 변경 감지 → debounce PATCH.
          const prevBlock = prevConv?.blocks.find((pb) => pb.id === b.id);
          if (prevBlock) {
            const promptChanged = prevBlock.prompt !== b.prompt;
            const optionsChanged =
              JSON.stringify(prevBlock.options) !== JSON.stringify(b.options);
            if (promptChanged || optionsChanged) {
              const patch: {
                prompt?: string;
                options?: unknown;
              } = {};
              if (promptChanged) patch.prompt = b.prompt;
              if (optionsChanged) patch.options = b.options;
              draftAutosave.schedule(b.id, patch);
            }

            // (5) status 전이 → conversation + message 등록 완료 후 PATCH.
            if (prevBlock.status !== b.status) {
              const nextStatus = mapBlockStatus(b.status);
              if (nextStatus) {
                const nextJobId = b.jobId ?? null;
                convReady
                  .then(() =>
                    patchMessage({
                      id: b.id,
                      status: nextStatus,
                      jobId: nextJobId,
                    }),
                  )
                  .catch(() => undefined);
              }
            } else if (prevBlock.jobId !== b.jobId && b.jobId) {
              // status 는 그대로지만 jobId 만 부여된 경우.
              const nextJobId = b.jobId;
              convReady
                .then(() => patchMessage({ id: b.id, jobId: nextJobId }))
                .catch(() => undefined);
            }
          }
        }
      }
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}

function mapBlockStatus(
  s: string,
): 'draft' | 'submitted' | 'completed' | 'failed' | undefined {
  switch (s) {
    case 'draft':
      return 'draft';
    case 'queued':
    case 'generating':
      return 'submitted';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return undefined;
  }
}
