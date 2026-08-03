'use client';

// 우측 고정 Sidebar.
//   1. 새로운 대화 CTA
//   2. 사용 가이드 (첫 커밋 placeholder)
//   3. 크레딧 정보 (보유 / 이번 예상 사용량 / 예상 잔여) — 서버 실측 재사용
//   4. 대화 히스토리 (localStorage 기반)

import { HelpCircle, MessageSquare, Plus } from 'lucide-react';

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

export function ConversationSidebar({
  credits,
  currentDraftBatchSize,
  activeJobExists,
  onNewConversation,
  onOpenConversation,
}: ConversationSidebarProps) {
  const conversations = useConversationStore((s) => s.conversations);
  const currentId = useConversationStore((s) => s.currentId);

  // 최신순 히스토리 (현재는 임시 제목 확정된 것만)
  const historyList = Object.values(conversations)
    .filter((c) => c.title)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 20);

  const projectedRemaining = Math.max(0, credits - currentDraftBatchSize);

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
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>프롬프트를 입력하고 옵션을 선택한 뒤 이미지 만들기를 눌러주세요.</p>
          <p>생성이 끝나면 아래로 이어서 새 대화를 계속할 수 있어요.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">크레딧 정보</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <Row label="보유 크레딧">
            <strong className="tabular-nums">{credits}</strong>
          </Row>
          <Row label="이번 예상 사용">
            <span className="tabular-nums text-muted-foreground">
              -{currentDraftBatchSize}
            </span>
          </Row>
          <Row label="생성 후 잔여 (예상)">
            <strong
              className={cn(
                'tabular-nums',
                credits < currentDraftBatchSize && 'text-destructive',
              )}
            >
              {projectedRemaining}
            </strong>
          </Row>
          <p className="pt-1 text-sm text-muted-foreground">
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
            <p className="text-sm text-muted-foreground">
              아직 저장된 대화가 없어요.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {historyList.map((c: Conversation) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onOpenConversation(c.id)}
                    className={cn(
                      'block w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      currentId === c.id
                        ? 'bg-accent font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                    )}
                    title={c.title ?? '새로운 대화'}
                  >
                    {c.title ?? '새로운 대화'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </aside>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
