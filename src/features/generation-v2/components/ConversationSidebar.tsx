'use client';

// 우측 고정 Sidebar.
//   1. 새로운 대화 CTA
//   2. 사용 가이드 (짧은 안내)
//   3. 크레딧 정보 (보유 · 이번 예상 사용량 · 예상 잔여) — 서버 실측 재사용
//   4. 대화 히스토리 (localStorage 기반, 최신순, 상대 시간 표시)
//
// 지시 §Sidebar Polish 준수:
//   - 기능 추가 없음, 시각적 밀도/타이포/간격만 정돈
//   - 크레딧 충전 / 사용 내역 링크는 대응 페이지가 아직 없어 미도입

import { Coins, MessageSquare, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useConversationStore } from '@/lib/store/conversationStore';
import { cn } from '@/lib/utils';

import type { Conversation } from '@/lib/store/conversationStore';

interface ConversationSidebarProps {
  credits: number;
  currentDraftBatchSize: number;
  activeJobExists: boolean;
  onNewConversation: () => void;
  onOpenConversation: (id: string) => void;
  /** M3-2: 현재 workspace slug. 이 값이 일치하는 대화만 히스토리에 표시. */
  organizationSlug: string;
}

// "N일 전" / "N시간 전" 등 상대 시간. 대화 히스토리 아이템 우측에 사용.
// 별도 유틸을 만들지 않고 여기서 로컬로 계산 (재사용 대상 없음).
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  if (diff < 60_000) return '방금 전';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}주 전`;
  const months = Math.floor(days / 30);
  return `${months}개월 전`;
}

export function ConversationSidebar({
  credits,
  currentDraftBatchSize,
  activeJobExists,
  onNewConversation,
  onOpenConversation,
  organizationSlug,
}: ConversationSidebarProps) {
  const conversations = useConversationStore((s) => s.conversations);
  const currentId = useConversationStore((s) => s.currentId);

  // M3-2: 현재 workspace 의 대화만 리스트. organizationSlug 없는 legacy 대화
  // 는 GenerateV2Client 가 마운트 시 MY 로 backfill 하므로 이 시점에는 반드시
  // 값이 있음. 방어적으로 undefined 는 표시 제외.
  //
  // NOTE: title 이 null 인 대화도 표시한다 (confirmConversationTitle 이 첫
  // 이미지 생성 성공 시점에 호출되므로, 프롬프트 입력만 하고 이탈한 대화는
  // 영구히 title=null 로 남는다). 이 대화들도 살아있는 데이터이므로 사이드바
  // 에서 접근할 수 있어야 한다. 표시명은 첫 Block prompt → 시각 순 fallback.
  const historyList = Object.values(conversations)
    .filter((c) => c.organizationSlug === organizationSlug)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 20);

  function displayName(c: Conversation): string {
    if (c.title) return c.title;
    const firstPrompt = c.blocks[0]?.prompt?.trim();
    if (firstPrompt) {
      return firstPrompt.length > 30 ? `${firstPrompt.slice(0, 30)}…` : firstPrompt;
    }
    return '(제목 없는 대화)';
  }

  const projectedRemaining = Math.max(0, credits - currentDraftBatchSize);
  const insufficient = credits < currentDraftBatchSize;

  return (
    <aside
      className={cn(
        'hidden w-[280px] shrink-0 flex-col gap-2',
        // 스크롤 시에도 화면 우측에 고정. top 값은 AppHeader (h-14=56px) 아래
        // + 여백 24px 을 감안해 80px. max-h 로 화면 밖 침범을 막되 overflow 는
        // 카드 그림자가 잘리지 않도록 visible 유지. 넘친 히스토리는 아래
        // 대화 히스토리 카드 내부에서 자체 clip.
        'lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100vh-6rem)]',
      )}
    >
      <Button
        type="button"
        onClick={onNewConversation}
        variant={activeJobExists ? 'outline' : 'default'}
        title={
          activeJobExists
            ? '이미지 생성이 진행 중이에요. 새 대화를 열어도 현재 생성은 계속됩니다.'
            : undefined
        }
      >
        <Plus className="mr-1 h-4 w-4" /> 새로운 대화
      </Button>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">크레딧 정보</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-xs">
          <Row label="보유 크레딧">
            <span className="inline-flex items-center gap-1">
              <Coins className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
              <strong className="tabular-nums text-primary">{credits}</strong>
            </span>
          </Row>
          <Row label="이번 사용">
            <span className="tabular-nums text-muted-foreground">
              -{currentDraftBatchSize}
            </span>
          </Row>
          <div className="my-1 border-t border-border/60" />
          <Row label="생성 후 예상">
            <strong
              className={cn(
                'tabular-nums',
                insufficient ? 'text-destructive' : 'text-primary',
              )}
            >
              {projectedRemaining}
            </strong>
          </Row>
        </CardContent>
      </Card>

      {/* 대화 히스토리 wrapper — flex-1 로 sidebar 남은 세로 공간을 확보하되
          카드 자체는 자연 크기(shrink-to-fit) 로 렌더. 컨텐츠가 wrapper 를
          넘길 때만 max-h-full + overflow-hidden 이 발동해 잘림.
          이렇게 하면 히스토리 항목이 적을 때 카드가 필요 이상 커지지 않고,
          가득 찼을 때만 화면 하단에서 잘리게 된다. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <Card className="flex max-h-full flex-col overflow-hidden">
          <CardHeader className="shrink-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <MessageSquare className="h-4 w-4 text-primary" />
              대화 히스토리
            </CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-1 overflow-hidden">
            {historyList.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                아직 저장된 대화가 없어요.
              </p>
            ) : (
              <ul>
                {historyList.map((c: Conversation) => {
                  const active = currentId === c.id;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => onOpenConversation(c.id)}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left transition-colors',
                          active
                            ? 'bg-accent font-medium text-primary'
                            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                        )}
                        title={displayName(c)}
                      >
                        <span className="truncate text-xs">
                          {displayName(c)}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground/80 tabular-nums">
                          {formatRelativeTime(c.updatedAt)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </aside>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
