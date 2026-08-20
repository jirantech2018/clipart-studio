'use client';

// Draft 자동 저장 훅.
// Plan Ref: docs/01-plan/features/conversation-server-storage.plan.md §5.2
//
// - Zustand 즉시 반영 (호출부 책임)
// - 1.5초 debounce 후 PATCH /api/messages/:id
// - 페이지 이탈 (pagehide / visibilitychange / beforeunload) 시 pending 을
//   fetch keepalive 로 flush → 종료 상황에서도 전송 보장.
// - 오프라인 큐/재시도는 이번 스코프 밖 (지시서 §13).

import { useEffect, useRef } from 'react';

import { patchMessage, patchMessageKeepalive } from './useConversationsApi';

const DEBOUNCE_MS = 1500;

interface DraftPayload {
  prompt?: string;
  options?: unknown;
  packagePlan?: unknown;
  status?: 'draft' | 'submitted' | 'completed' | 'failed';
}

/**
 * messageId 별로 debounce 저장을 관리한다. 컴포넌트가 언마운트되어도 pending
 * 이 있으면 flush 한다. 여러 message 를 동시에 다루는 경우도 하나의 훅
 * 인스턴스가 커버 (Map 기반).
 */
export function useMessageDraftAutosave() {
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingRef = useRef(new Map<string, DraftPayload>());

  // 이탈 이벤트 3종을 걸어 pending 을 flush.
  useEffect(() => {
    const flushAllKeepalive = () => {
      const pending = pendingRef.current;
      pending.forEach((payload, id) => {
        patchMessageKeepalive({ id, ...payload });
      });
      pending.clear();
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushAllKeepalive();
      }
    };

    window.addEventListener('pagehide', flushAllKeepalive);
    window.addEventListener('beforeunload', flushAllKeepalive);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('pagehide', flushAllKeepalive);
      window.removeEventListener('beforeunload', flushAllKeepalive);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      // 언마운트 시에도 남은 pending 을 flush (SPA 라우팅 이탈 대응).
      flushAllKeepalive();
    };
  }, []);

  /** 특정 message 의 draft 를 예약 저장. 같은 id 에 연속 호출 시 최신 값이 이김. */
  function schedule(id: string, payload: DraftPayload) {
    // 최신 payload 를 pendingRef 에 병합 저장 (부분 patch 병합).
    const prev = pendingRef.current.get(id) ?? {};
    pendingRef.current.set(id, { ...prev, ...payload });

    // 기존 타이머 갱신.
    const existing = timersRef.current.get(id);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      const merged = pendingRef.current.get(id);
      pendingRef.current.delete(id);
      timersRef.current.delete(id);
      if (!merged) return;
      // 서버 응답 실패는 조용히 무시 — 다음 hydration/mutation 이 정정.
      patchMessage({ id, ...merged }).catch(() => undefined);
    }, DEBOUNCE_MS);

    timersRef.current.set(id, timer);
  }

  /** 특정 message 를 즉시 저장하고 pending 을 clear. 이미지 생성 버튼 등에서 사용. */
  async function flushNow(id: string, extra?: DraftPayload): Promise<void> {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    const pending = pendingRef.current.get(id) ?? {};
    const merged = { ...pending, ...(extra ?? {}) };
    pendingRef.current.delete(id);
    if (Object.keys(merged).length === 0) return;
    await patchMessage({ id, ...merged }).catch(() => undefined);
  }

  return { schedule, flushNow };
}
