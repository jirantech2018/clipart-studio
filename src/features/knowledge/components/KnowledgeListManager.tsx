'use client';

// /admin/knowledge 목록 페이지 위젯. 검색/필터/생성/토글/삭제만.
// 편집은 각 행 클릭 시 /admin/knowledge/[id] 페이지로 이동.

import { ChevronRight, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { KnowledgeMetaForm } from '@/features/knowledge/components/KnowledgeMetaForm';
import {
  useDeleteKnowledge,
  useKnowledgeList,
  useUpdateKnowledge,
} from '@/features/knowledge/hooks/useKnowledge';
import { cn } from '@/lib/utils';

import type { Knowledge } from '@/types/domain';

export function KnowledgeListManager() {
  const [search, setSearch] = useState('');
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useKnowledgeList({
    search: search.trim() || undefined,
    enabledOnly,
  });
  const update = useUpdateKnowledge();
  const remove = useDeleteKnowledge();

  const knowledge = data?.knowledge ?? [];

  async function handleToggle(k: Knowledge) {
    setPendingToggleId(k.id);
    try {
      await update.mutateAsync({ id: k.id, patch: { enabled: !k.enabled } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '전환 실패');
    } finally {
      setPendingToggleId(null);
    }
  }

  async function handleDelete(k: Knowledge) {
    if (
      !window.confirm(
        `"${k.name}" Knowledge 를 삭제할까요? 등록된 이미지도 함께 삭제됩니다.`,
      )
    ) {
      return;
    }
    setPendingDeleteId(k.id);
    try {
      await remove.mutateAsync(k.id);
      toast.success('삭제했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패');
    } finally {
      setPendingDeleteId(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Knowledge 목록</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              AI 이미지 모델이 잘 이해하지 못하는 개념을 텍스트 설명과 참고 이미지로 등록해두면 생성 시 자동으로 반영됩니다.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => setShowCreate((v) => !v)}
          >
            <Plus className="mr-1 h-4 w-4" />
            {showCreate ? '닫기' : '새 Knowledge 추가'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[16rem]">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="이름으로 검색"
                className="h-9 pl-8"
              />
            </div>
            <button
              type="button"
              onClick={() => setEnabledOnly((v) => !v)}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs',
                enabledOnly
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-input bg-background text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'inline-block h-1.5 w-1.5 rounded-full',
                  enabledOnly ? 'bg-primary' : 'bg-muted-foreground/40',
                )}
              />
              활성만
            </button>
          </div>

          {isError ? (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              목록을 불러오지 못했어요.
              <button
                type="button"
                onClick={() => refetch()}
                className="ml-2 text-primary underline-offset-4 hover:underline"
              >
                다시 시도
              </button>
            </div>
          ) : isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-md bg-muted"
                  aria-hidden="true"
                />
              ))}
            </div>
          ) : knowledge.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              {search
                ? '검색 결과가 없어요.'
                : '아직 Knowledge 가 없어요. 우측 상단 새 Knowledge 추가 로 첫 항목을 만들어 보세요.'}
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">이름</th>
                    <th className="px-3 py-2 text-left font-medium">트리거</th>
                    <th className="px-3 py-2 text-left font-medium">이미지</th>
                    <th className="px-3 py-2 text-left font-medium">우선순위</th>
                    <th className="px-3 py-2 text-left font-medium">상태</th>
                    <th className="px-3 py-2 text-right font-medium">동작</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {knowledge.map((k) => {
                    const isToggling = pendingToggleId === k.id;
                    const isDeleting = pendingDeleteId === k.id;
                    const positiveCount = k.images.filter(
                      (i) => i.referenceType === 'positive',
                    ).length;
                    const negativeCount = k.images.filter(
                      (i) => i.referenceType === 'negative',
                    ).length;
                    return (
                      <tr key={k.id} className="hover:bg-muted/20">
                        <td className="px-3 py-2">
                          <Link
                            href={`/admin/knowledge/${k.id}`}
                            className="group flex items-center gap-1 font-medium hover:text-primary"
                          >
                            {k.name}
                            <ChevronRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                          </Link>
                          <div className="line-clamp-1 text-[11px] text-muted-foreground">
                            {k.description.slice(0, 80)}
                            {k.description.length > 80 ? '…' : ''}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {k.triggers.slice(0, 4).map((t) => (
                              <span
                                key={t}
                                className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                              >
                                {t}
                              </span>
                            ))}
                            {k.triggers.length > 4 && (
                              <span className="text-[10px] text-muted-foreground">
                                +{k.triggers.length - 4}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          <span className="text-primary">{positiveCount}</span>
                          <span className="mx-0.5">/</span>
                          <span className="text-amber-600 dark:text-amber-400">
                            {negativeCount}
                          </span>
                        </td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          {k.priority}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => handleToggle(k)}
                            disabled={isToggling}
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                              k.enabled
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-input bg-background text-muted-foreground',
                              isToggling && 'cursor-wait opacity-70',
                            )}
                          >
                            {isToggling ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <span
                                className={cn(
                                  'inline-block h-1.5 w-1.5 rounded-full',
                                  k.enabled ? 'bg-primary' : 'bg-muted-foreground/40',
                                )}
                              />
                            )}
                            {k.enabled ? '켜짐' : '꺼짐'}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(k)}
                            disabled={isDeleting}
                            className="h-7 px-2 text-destructive hover:text-destructive"
                          >
                            {isDeleting ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {showCreate && (
        <KnowledgeMetaForm
          onSaved={() => setShowCreate(false)}
          onCancel={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
