'use client';

// generate-v2 (Conversation UI) 신규 페이지.
// 헤더 nav 에는 아직 연결하지 않고, 직접 URL 로만 접근하여 검수한다.
// 기존 /generate 는 그대로 유지 — 상태·API 모두 격리.
//
// 흐름 (Priority 1):
//   1) mount 시 currentId 가 없거나 유효하지 않으면 새 conversation 생성
//   2) 마지막 Block 이 completed / failed 로 전이되면 새 draft Block 자동 추가
//      (activeJobExists 인 동안엔 추가하지 않음)
//   3) 새 Block 이 마운트되면 auto-scroll + prompt focus
//   4) 첫 실제 생성 시점에 conversation title 확정

import { useEffect, useMemo, useRef } from 'react';

import { ConversationBlock } from '@/features/generation-v2/components/ConversationBlock';
import { ConversationSidebar } from '@/features/generation-v2/components/ConversationSidebar';
import { useAuthStore } from '@/lib/store/authStore';
import { useConversationStore } from '@/lib/store/conversationStore';

export const dynamic = 'force-dynamic';

export default function GenerateV2Page() {
  const currentId = useConversationStore((s) => s.currentId);
  const conversations = useConversationStore((s) => s.conversations);
  const createConversation = useConversationStore((s) => s.createConversation);
  const setCurrentConversation = useConversationStore(
    (s) => s.setCurrentConversation,
  );
  const removeEmpty = useConversationStore((s) => s.removeEmptyConversation);
  const addBlock = useConversationStore((s) => s.addBlock);
  const confirmTitle = useConversationStore((s) => s.confirmConversationTitle);

  const credits = useAuthStore((s) => s.profile?.credits ?? 0);

  // 유효한 currentId 없으면 새 conversation 만들기.
  useEffect(() => {
    if (!currentId || !conversations[currentId]) {
      createConversation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const conv = currentId ? conversations[currentId] : null;
  const blocks = conv?.blocks ?? [];
  const lastBlock = blocks[blocks.length - 1] ?? null;

  const activeJobExists = useMemo(
    () => blocks.some((b) => b.status === 'queued' || b.status === 'generating'),
    [blocks],
  );

  // 마지막 Block 이 완료/실패로 전이되면 새 draft 자동 추가.
  // - activeJobExists 인 동안엔 추가하지 않음 (동시 Job 1개 제한)
  useEffect(() => {
    if (!conv || !lastBlock) return;
    if (activeJobExists) return;
    if (lastBlock.status === 'completed' || lastBlock.status === 'failed') {
      // 이전 옵션을 seed 로 이어붙임 (사용자 편의)
      addBlock(conv.id, {
        batchSize: lastBlock.options.batchSize,
        aspectRatio: lastBlock.options.aspectRatio,
        orgSlug: lastBlock.options.orgSlug,
        schoolProfileApplied: lastBlock.options.schoolProfileApplied,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBlock?.status]);

  // 새 draft Block 이 마운트되면 그 지점으로 scroll.
  const lastRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!lastBlock || lastBlock.status !== 'draft') return;
    lastRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [lastBlock?.id, lastBlock?.status]);

  function handleNewConversation() {
    if (activeJobExists) {
      const confirmed = window.confirm(
        '이미지 생성이 진행 중입니다. 새 대화로 이동하시겠습니까? (서버 생성 자체는 취소되지 않아요.)',
      );
      if (!confirmed) return;
    }
    // 현재 대화가 비어있으면 히스토리에서 정리.
    if (currentId) removeEmpty(currentId);
    createConversation();
  }

  function handleOpenConversation(id: string) {
    if (activeJobExists) {
      const confirmed = window.confirm(
        '이미지 생성이 진행 중입니다. 다른 대화로 이동하시겠습니까? (서버 생성은 계속됩니다.)',
      );
      if (!confirmed) return;
    }
    if (currentId && currentId !== id) removeEmpty(currentId);
    setCurrentConversation(id);
  }

  const draftBatchSize = lastBlock?.options.batchSize ?? 0;

  return (
    <div className="mx-auto flex max-w-7xl gap-6">
      <main className="min-w-0 flex-1 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            AI와 함께 이미지 만들기
          </h1>
          <p className="text-sm text-muted-foreground">
            프롬프트와 옵션을 입력하고 이미지 만들기를 누르면 결과가 이어서
            쌓입니다.
          </p>
        </header>

        <div className="space-y-4">
          {blocks.map((b, i) => (
            <ConversationBlock
              key={b.id}
              ref={i === blocks.length - 1 ? lastRef : undefined}
              block={b}
              convId={conv!.id}
              isLast={i === blocks.length - 1}
              activeJobExists={activeJobExists}
              credits={credits}
              onFirstGenerationStart={(prompt) => confirmTitle(conv!.id, prompt)}
            />
          ))}
        </div>
      </main>

      <ConversationSidebar
        credits={credits}
        currentDraftBatchSize={draftBatchSize}
        activeJobExists={activeJobExists}
        onNewConversation={handleNewConversation}
        onOpenConversation={handleOpenConversation}
      />
    </div>
  );
}
