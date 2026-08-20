'use client';

// 우측 고정 Sidebar (Conversation Server Storage 반영, v0.2).
//   1. 새로운 대화 CTA
//   2. 크레딧 정보
//   3. 대화 히스토리
//      - 서버 조회 (useConversationsList) 가 SoT
//      - Zustand 로컬 store 는 optimistic 표시용 (신규 draft 즉시 반영)
//      - Soft Delete 버튼 (hover 시 노출)

import { Coins, MessageSquare, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useConversationsList,
  useDeleteConversation,
} from '@/features/generation-v2/hooks/useConversationsApi';
import { useConversationStore } from '@/lib/store/conversationStore';
import { cn } from '@/lib/utils';

import type { Conversation } from '@/lib/store/conversationStore';

interface ConversationSidebarProps {
  credits: number;
  currentDraftBatchSize: number;
  activeJobExists: boolean;
  onNewConversation: () => void;
  onOpenConversation: (id: string) => void;
  organizationSlug: string;
}

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

interface SidebarItem {
  id: string;
  title: string | null;
  updatedAt: string;
  firstPrompt: string | null; // 로컬 store 에서만 알 수 있는 fallback 표시명 원천
}

export function ConversationSidebar({
  credits,
  currentDraftBatchSize,
  activeJobExists,
  onNewConversation,
  onOpenConversation,
  organizationSlug,
}: ConversationSidebarProps) {
  const conversationsLocal = useConversationStore((s) => s.conversations);
  const currentId = useConversationStore((s) => s.currentId);

  const serverQuery = useConversationsList(organizationSlug);
  const deleteMutation = useDeleteConversation();

  // 서버 목록 (SoT) + 아직 서버에 반영 안 된 로컬 draft (optimistic) 병합.
  // 같은 id 는 서버 값이 우선. 표시명 fallback (첫 프롬프트) 은 로컬 store 에서만
  // 알 수 있으므로 firstPrompt 를 별도로 함께 넣어둔다.
  const localByWorkspace: Record<string, Conversation> = {};
  for (const c of Object.values(conversationsLocal)) {
    if (c.organizationSlug === organizationSlug) localByWorkspace[c.id] = c;
  }
  const merged: Record<string, SidebarItem> = {};
  for (const c of Object.values(localByWorkspace)) {
    merged[c.id] = {
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
      firstPrompt: c.blocks[0]?.prompt?.trim() ?? null,
    };
  }
  for (const c of serverQuery.data?.conversations ?? []) {
    const local = localByWorkspace[c.id];
    merged[c.id] = {
      id: c.id,
      title: c.title,
      updatedAt: c.lastActivityAt,
      firstPrompt: local?.blocks[0]?.prompt?.trim() ?? null,
    };
  }

  const historyList = Object.values(merged)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 20);

  function displayName(item: SidebarItem): string {
    if (item.title) return item.title;
    if (item.firstPrompt) {
      return item.firstPrompt.length > 30
        ? `${item.firstPrompt.slice(0, 30)}…`
        : item.firstPrompt;
    }
    return '(제목 없는 대화)';
  }

  const projectedRemaining = Math.max(0, credits - currentDraftBatchSize);
  const insufficient = credits < currentDraftBatchSize;

  return (
    <aside
      className={cn(
        'hidden w-[280px] shrink-0 flex-col gap-2',
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

      <div className="flex min-h-0 flex-1 flex-col">
        <Card className="flex max-h-full flex-col overflow-hidden">
          <CardHeader className="shrink-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <MessageSquare className="h-4 w-4 text-primary" />
              대화 히스토리
            </CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-1 overflow-hidden">
            {serverQuery.isError ? (
              <p className="text-xs text-destructive">
                대화 목록을 불러오지 못했어요.
              </p>
            ) : historyList.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                아직 저장된 대화가 없어요.
              </p>
            ) : (
              <ul>
                {historyList.map((item) => (
                  <ConversationRow
                    key={item.id}
                    item={item}
                    active={currentId === item.id}
                    label={displayName(item)}
                    onOpen={() => onOpenConversation(item.id)}
                    onDelete={async () => {
                      if (!window.confirm('이 대화를 휴지통으로 옮길까요?')) return;
                      try {
                        await deleteMutation.mutateAsync(item.id);
                        toast.success('대화를 삭제했어요');
                      } catch (err) {
                        toast.error(
                          err instanceof Error ? err.message : '대화 삭제 실패',
                        );
                      }
                    }}
                    disabled={deleteMutation.isPending}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </aside>
  );
}

function ConversationRow({
  item,
  active,
  label,
  onOpen,
  onDelete,
  disabled,
}: {
  item: SidebarItem;
  active: boolean;
  label: string;
  onOpen: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const [hovering, setHovering] = useState(false);
  return (
    <li
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={cn(
        'group relative flex items-center gap-1 rounded-md px-2 py-1 transition-colors',
        active
          ? 'bg-accent font-medium text-primary'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
        title={label}
      >
        <span className="truncate text-xs">{label}</span>
        {!hovering && (
          <span className="shrink-0 text-[11px] text-muted-foreground/80 tabular-nums">
            {formatRelativeTime(item.updatedAt)}
          </span>
        )}
      </button>
      {hovering && (
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          className="shrink-0 rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          aria-label="대화 삭제"
          title="대화 삭제"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
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
