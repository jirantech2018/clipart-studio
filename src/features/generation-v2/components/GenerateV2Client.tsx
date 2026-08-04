'use client';

// /generate-v2 client 진입점.
//
// 이전에는 page.tsx 가 client component 라 SSR 크레딧을 받을 채널이 없었고,
// authStore.profile 도 seed 되지 않아 credits 가 항상 0 으로 표시되었다.
// 이제 page.tsx (server) 가 initialCredits 를 이 컴포넌트로 넘겨주고,
// layout 의 AuthProfileHydrator 가 store 에도 동일 profile 을 seed 한다.
//
// 표시 우선순위 (기존 /generate 와 동일):
//   storeCredits (최신 mutation 반영) ?? initialCredits (SSR 실측)
//
// 흐름:
//   1) mount 시 currentId 가 없거나 유효하지 않으면 새 conversation 생성
//   2) 마지막 Block 이 completed / failed 로 전이되면 새 draft Block 자동 추가
//      (activeJobExists 인 동안엔 추가하지 않음)
//   3) 새 Block 이 마운트되면 auto-scroll + prompt focus
//   4) 첫 실제 생성 시점에 conversation title 확정

import { ChevronDown, HelpCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ConversationBlock } from '@/features/generation-v2/components/ConversationBlock';
import { ConversationSidebar } from '@/features/generation-v2/components/ConversationSidebar';
import { UsageGuideBanners } from '@/features/generation-v2/components/UsageGuideBanners';
import { useAuthStore } from '@/lib/store/authStore';
import { useConversationStore } from '@/lib/store/conversationStore';
import { cn } from '@/lib/utils';

interface Props {
  initialCredits: number;
}

export function GenerateV2Client({ initialCredits }: Props) {
  const currentId = useConversationStore((s) => s.currentId);
  const conversations = useConversationStore((s) => s.conversations);
  const createConversation = useConversationStore((s) => s.createConversation);
  const setCurrentConversation = useConversationStore(
    (s) => s.setCurrentConversation,
  );
  const removeEmpty = useConversationStore((s) => s.removeEmptyConversation);
  const addBlock = useConversationStore((s) => s.addBlock);
  const confirmTitle = useConversationStore((s) => s.confirmConversationTitle);

  const storeCredits = useAuthStore((s) => s.profile?.credits);
  const credits = storeCredits ?? initialCredits;

  const [guideOpen, setGuideOpen] = useState(false);

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
        <header className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                학교에 필요한 클립아트를 AI와 함께 만들어보세요.
              </h1>
              <p className="text-sm text-muted-foreground">
                학문집, 학급신문, 학사달력부터 독서 행사, 운동회, 졸업식까지.
              </p>
              <p className="text-sm text-muted-foreground">
                수업 자료, 활동지, 포스터, 삽화 등 필요한 내용을 입력하면 AI가
                학교에 맞는 클립아트를 만들어드립니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setGuideOpen((v) => !v)}
              aria-expanded={guideOpen}
              aria-controls="usage-guide-banners"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-input bg-background/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
              <span>사용 가이드</span>
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 transition-transform',
                  guideOpen && 'rotate-180',
                )}
                aria-hidden="true"
              />
            </button>
          </div>
          {guideOpen && (
            <div id="usage-guide-banners" className="animate-fade-in">
              <UsageGuideBanners />
            </div>
          )}
        </header>

        <div className="space-y-6">
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
