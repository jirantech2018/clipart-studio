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
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ConversationBlock } from '@/features/generation-v2/components/ConversationBlock';
import { ConversationSidebar } from '@/features/generation-v2/components/ConversationSidebar';
import { UsageGuideBanners } from '@/features/generation-v2/components/UsageGuideBanners';
import { useConversationServerSync } from '@/features/generation-v2/hooks/useConversationServerSync';
import { computePackageTotalSlots } from '@/features/generation-v2/lib/packageSubmit';
import { useAuthStore } from '@/lib/store/authStore';
import { useConversationStore } from '@/lib/store/conversationStore';
import { cn } from '@/lib/utils';

interface ParentImage {
  id: string;
  prompt: string;
  thumbnailUrl: string;
}

interface Props {
  initialCredits: number;
  parent?: ParentImage | null;
  /** 현재 Workspace 의 organization slug. 서버 컴포넌트가 페이지 경로에서
   *  결정해 전달. MY 는 hidden `personal-{user_id}`, 학교는 그 조직 slug.
   *  submit 시 body 로 함께 전송되어 서버가 org_id 로 저장. */
  orgSlug: string;
  /** 세션 유저의 MY organizationSlug. Legacy 대화 (organizationSlug 미보유)
   *  를 이 값으로 backfill 하기 위해 사용 (Plan v0.2.7 §M3-2). */
  myOrgSlug: string;
  /** Conversation server storage (§M4): 서버 sync 훅에서 legacy migration
   *  flag 를 유저별로 분리하기 위해 필요. 서버 컴포넌트에서 auth.getUser() 로
   *  얻어 전달. */
  userId: string;
}

export function GenerateV2Client({
  initialCredits,
  parent,
  orgSlug,
  myOrgSlug,
  userId,
}: Props) {
  const router = useRouter();
  const currentId = useConversationStore((s) => s.currentId);
  const conversations = useConversationStore((s) => s.conversations);
  const createConversation = useConversationStore((s) => s.createConversation);
  const setCurrentConversation = useConversationStore(
    (s) => s.setCurrentConversation,
  );
  const addBlock = useConversationStore((s) => s.addBlock);
  const updateOptions = useConversationStore((s) => s.updateBlockOptions);
  const confirmTitle = useConversationStore((s) => s.confirmConversationTitle);
  const backfillLegacyOrgSlug = useConversationStore(
    (s) => s.backfillLegacyOrganizationSlug,
  );

  // M3-2: 마운트 즉시 organizationSlug 없는 legacy 대화를 세션 유저의 MY
  // organizationSlug 로 backfill. 이 컴포넌트는 workspace 컨텍스트를 갖는
  // 유일한 진입점이므로 여기서 1회 실행하면 이후 모든 sidebar 필터가 정확.
  useEffect(() => {
    backfillLegacyOrgSlug(myOrgSlug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // M4 (conversation-server-storage): Zustand 변경 → 서버 sync.
  // - 마운트 시 legacy migration (idempotent 1회)
  // - 신규 conversation / message 생성 시 POST
  // - prompt/options 변경 시 1.5s debounce PATCH
  // - status 전이 · title 확정 시 즉시 PATCH
  useConversationServerSync({ userId, organizationSlug: orgSlug });

  // Plan v0.2.8 §M3-3: 화면 크레딧 = 이 workspace 의 pool.balance.
  // - MY workspace: profiles.credits 가 곧 MY pool.balance (RPC 가 sync 하므로
  //   authStore live 값을 그대로 신뢰 가능).
  // - 학교/일반 workspace: authStore(profiles.credits) 는 개인 pool 값이라
  //   무관. SSR 로 전달된 initialCredits (그 조직 pool.balance) 만 사용.
  //   Live 반영은 다음 iteration (SSE done 후 useOrganization invalidate).
  const isMyWorkspace = orgSlug === myOrgSlug;
  const storeCredits = useAuthStore((s) => s.profile?.credits);
  const credits = isMyWorkspace ? (storeCredits ?? initialCredits) : initialCredits;

  const [guideOpen, setGuideOpen] = useState(true);

  // 유효한 currentId 없으면 새 conversation 만들기. 첫 draft block 이
  // 현재 workspace 의 orgSlug 를 seed 로 갖도록 seed 옵션 전달. Conversation
  // 자체에도 organizationSlug 를 세팅해 sidebar 필터 대상이 되게 한다.
  //
  // 또한 currentId 가 존재하지만 그 대화의 organizationSlug 가 지금 페이지
  // workspace 와 다르면 새 대화를 만든다 (다른 workspace 대화는 이 페이지에
  // 표시되면 안 됨).
  useEffect(() => {
    const existing = currentId ? conversations[currentId] : null;
    if (!existing || existing.organizationSlug !== orgSlug) {
      createConversation({ orgSlug }, orgSlug);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug]);

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

  // ?parent=<image_id> 로 진입 시 (이 이미지로 다시 만들기) chaining 정보를
  // 현재 활성 draft 에 세팅한다. draft 가 없거나 잠긴 상태면 새 draft 를
  // seed 로 추가. 세팅 후에는 URL 을 비워 중복 적용을 막는다.
  useEffect(() => {
    if (!parent || !conv) return;
    const targetBlock =
      lastBlock && lastBlock.status === 'draft' && !activeJobExists
        ? lastBlock
        : null;
    if (targetBlock) {
      updateOptions(conv.id, targetBlock.id, {
        parentImageId: parent.id,
        parentImageThumbnailUrl: parent.thumbnailUrl,
        parentImagePrompt: parent.prompt,
        // chaining 은 3종 참조 중 최우선. 개인·조직 참조 모두 clear.
        personalReferenceIds: [],
        orgReferenceIds: [],
      });
    } else {
      addBlock(conv.id, {
        parentImageId: parent.id,
        parentImageThumbnailUrl: parent.thumbnailUrl,
        parentImagePrompt: parent.prompt,
        personalReferenceIds: [],
        orgReferenceIds: [],
      });
    }
    router.replace('/generate-v2');
    // parent 는 URL 진입 시 한 번만 적용. conv/lastBlock 변경에 재발화하면
    // replace 로 인한 재-render 루프 발생 가능 → parent.id 만 dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parent?.id]);

  function handleNewConversation() {
    if (activeJobExists) {
      const confirmed = window.confirm(
        '이미지 생성이 진행 중입니다. 새 대화로 이동하시겠습니까? (서버 생성 자체는 취소되지 않아요.)',
      );
      if (!confirmed) return;
    }
    // M4 (conversation-server-storage): removeEmptyConversation 자동 정리
    // 제거. 서버가 SoT 이므로 사용자가 명시적 삭제 UI 로만 삭제 (Soft Delete).
    // 프롬프트만 입력하고 이탈해도 대화가 유지되어야 함 (지시서 §2 §14 A).
    createConversation({ orgSlug }, orgSlug);
  }

  function handleOpenConversation(id: string) {
    if (activeJobExists) {
      const confirmed = window.confirm(
        '이미지 생성이 진행 중입니다. 다른 대화로 이동하시겠습니까? (서버 생성은 계속됩니다.)',
      );
      if (!confirmed) return;
    }
    setCurrentConversation(id);
  }

  // Package Mode 인 draft 는 총 Slot 합계를 예상 사용량으로 사용. Single 은
  // 기존과 동일하게 batchSize 를 사용. 두 경로 모두 사용자에게 "이번에 몇 장
  // 만들 예정" 을 정확히 알려주기 위한 값. draft 가 없으면 0 (표시상 -0 =
  // 사용 없음).
  const draftBatchSize = (() => {
    if (!lastBlock) return 0;
    if (lastBlock.options.packageMode) {
      return computePackageTotalSlots(lastBlock.options.packagePlan);
    }
    return lastBlock.options.batchSize;
  })();

  return (
    <div className="mx-auto flex max-w-7xl gap-6">
      <main className="min-w-0 flex-1 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            학교에 필요한 클립아트를 AI와 함께 만들어보세요.
          </h1>
          {/* 부제 + 사용 가이드 버튼:
              - 모바일 (default): 세로 스택. 부제 위, 버튼은 self-end 로 우측
              - PC (sm+): 가로 한 줄. 부제 좌측, 버튼 우측 (justify-between) */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="text-xs text-muted-foreground">
              수업자료, 학급운영, 학교행사까지 4가지 원하는 방식으로 쉽고 빠르게
              AI가 학교에 맞는 클립아트를 만들어 드립니다
            </p>
            <button
              type="button"
              onClick={() => setGuideOpen((v) => !v)}
              aria-expanded={guideOpen}
              aria-controls="usage-guide-banners"
              className="inline-flex shrink-0 items-center gap-1 self-end text-sm font-medium text-primary transition-opacity hover:opacity-80 sm:self-auto"
            >
              <HelpCircle className="h-4 w-4" aria-hidden="true" />
              <span>사용 가이드</span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 transition-transform',
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
        organizationSlug={orgSlug}
      />
    </div>
  );
}
