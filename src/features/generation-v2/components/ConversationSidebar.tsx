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

import { Coins, HelpCircle, MessageSquare, Plus } from 'lucide-react';

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
}: ConversationSidebarProps) {
  const conversations = useConversationStore((s) => s.conversations);
  const currentId = useConversationStore((s) => s.currentId);

  const historyList = Object.values(conversations)
    .filter((c) => c.title)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 20);

  const projectedRemaining = Math.max(0, credits - currentDraftBatchSize);
  const insufficient = credits < currentDraftBatchSize;

  return (
    <aside className="hidden w-[280px] shrink-0 flex-col gap-3 lg:flex">
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
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <HelpCircle className="h-4 w-4 text-primary" />
            사용 가이드
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs text-muted-foreground">
          <p>프롬프트를 입력하고 옵션을 선택한 뒤 이미지 만들기를 눌러주세요.</p>
          <p>생성이 끝나면 아래로 이어서 새 대화를 계속할 수 있어요.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">크레딧 정보</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-xs">
          <Row label="보유 크레딧">
            <span className="inline-flex items-center gap-1">
              <Coins className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
              <strong className="tabular-nums text-foreground">{credits}</strong>
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
                insufficient ? 'text-destructive' : 'text-foreground',
              )}
            >
              {projectedRemaining}
            </strong>
          </Row>
          <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
            실제 잔여는 생성이 완료된 후 서버 값으로 갱신돼요.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquare className="h-4 w-4 text-primary" />
            대화 히스토리
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {historyList.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              아직 저장된 대화가 없어요.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {historyList.map((c: Conversation) => {
                const active = currentId === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onOpenConversation(c.id)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                        active
                          ? 'bg-accent font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                      )}
                      title={c.title ?? '새로운 대화'}
                    >
                      <span className="truncate text-xs">
                        {c.title ?? '새로운 대화'}
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
