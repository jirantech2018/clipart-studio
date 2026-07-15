'use client';

// /admin/knowledge 목록 위젯. 카테고리별 접기/펼치기 + 카테고리 내 드래그 정렬.
// - HTML5 native drag & drop (외부 라이브러리 없음)
// - 드롭 시 target 위 위치를 계산해 대상 knowledge 의 sort_order 만 PATCH.
//   이후 목록은 invalidateQueries 로 재정렬되어 화면에 반영된다.

import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Loader2,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
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

const UNCATEGORIZED = '__uncategorized__';
const UNCATEGORIZED_LABEL = '미분류';

interface CategoryBucket {
  key: string;
  label: string;
  items: Knowledge[];
}

function groupByCategory(list: Knowledge[]): CategoryBucket[] {
  const map = new Map<string, CategoryBucket>();
  for (const k of list) {
    const key = k.category.trim() ? k.category.trim() : UNCATEGORIZED;
    const label = key === UNCATEGORIZED ? UNCATEGORIZED_LABEL : key;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { key, label, items: [] };
      map.set(key, bucket);
    }
    bucket.items.push(k);
  }
  // 각 버킷은 sort_order 오름차순 (loader 가 이미 그렇지만 방어)
  for (const b of map.values()) {
    b.items.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  const buckets = Array.from(map.values());
  // 미분류를 마지막에
  buckets.sort((a, b) => {
    if (a.key === UNCATEGORIZED) return 1;
    if (b.key === UNCATEGORIZED) return -1;
    return a.label.localeCompare(b.label, 'ko');
  });
  return buckets;
}

export function KnowledgeListManager() {
  const [search, setSearch] = useState('');
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const [pendingToggleId, setPendingToggleId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useKnowledgeList({
    search: search.trim() || undefined,
    enabledOnly,
  });
  const update = useUpdateKnowledge();
  const remove = useDeleteKnowledge();

  const knowledge = data?.knowledge ?? [];
  const buckets = useMemo(() => groupByCategory(knowledge), [knowledge]);

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

  function toggleCollapse(key: string) {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /**
   * source(dragging) 를 target 앞에 삽입한다. 같은 카테고리 안에서만 이동.
   * source 와 target 카테고리가 다르면 source 의 category 를 target 것으로 변경까지.
   */
  async function handleDrop(source: Knowledge, target: Knowledge) {
    if (source.id === target.id) return;

    // target 앞으로 이동시켰다고 가정. 새 sort_order 를 target 보다 1 작은 값으로.
    // 인접 값 충돌은 다음 재정렬로 자연 해소되며, 실제 표시 순서는 loader 의 ORDER BY 로 결정.
    const newSortOrder = Math.max(0, target.sortOrder - 1);
    const targetCategory = target.category;

    try {
      await update.mutateAsync({
        id: source.id,
        patch: {
          sortOrder: newSortOrder,
          ...(source.category !== targetCategory && { category: targetCategory }),
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '순서 변경 실패');
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Knowledge 목록</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              카테고리로 묶어 관리해요. 카드를 드래그해 카테고리 안에서 순서를 바꾸거나 다른 카테고리로 옮길 수 있어요.
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
            <div className="space-y-3">
              {buckets.map((bucket) => {
                const collapsed = collapsedKeys.has(bucket.key);
                return (
                  <section
                    key={bucket.key}
                    className="overflow-hidden rounded-md border"
                  >
                    <button
                      type="button"
                      onClick={() => toggleCollapse(bucket.key)}
                      className="flex w-full items-center gap-2 bg-muted/40 px-3 py-2 text-left text-sm hover:bg-muted/60"
                    >
                      {collapsed ? (
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      )}
                      <span className="font-medium">{bucket.label}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                        {bucket.items.length}개
                      </span>
                    </button>
                    {!collapsed && (
                      <ul className="divide-y">
                        {bucket.items.map((k) => {
                          const isToggling = pendingToggleId === k.id;
                          const isDeleting = pendingDeleteId === k.id;
                          const positiveCount = k.images.filter(
                            (i) => i.referenceType === 'positive',
                          ).length;
                          const negativeCount = k.images.filter(
                            (i) => i.referenceType === 'negative',
                          ).length;
                          const isDragging = dragId === k.id;
                          const isDragOver = dragOverId === k.id && dragId !== k.id;
                          return (
                            <li
                              key={k.id}
                              draggable
                              onDragStart={(e) => {
                                setDragId(k.id);
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', k.id);
                              }}
                              onDragEnd={() => {
                                setDragId(null);
                                setDragOverId(null);
                              }}
                              onDragOver={(e) => {
                                if (!dragId || dragId === k.id) return;
                                e.preventDefault();
                                e.dataTransfer.dropEffect = 'move';
                                setDragOverId(k.id);
                              }}
                              onDragLeave={(e) => {
                                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                                if (dragOverId === k.id) setDragOverId(null);
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                setDragOverId(null);
                                if (!dragId || dragId === k.id) return;
                                const source = knowledge.find((x) => x.id === dragId);
                                if (source) void handleDrop(source, k);
                                setDragId(null);
                              }}
                              className={cn(
                                'flex items-center gap-2 px-3 py-2 transition-colors',
                                isDragging && 'opacity-40',
                                isDragOver &&
                                  'border-t-2 border-primary bg-primary/5',
                                !isDragOver && 'hover:bg-muted/20',
                              )}
                            >
                              <GripVertical
                                className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground/50 active:cursor-grabbing"
                                aria-hidden="true"
                              />
                              <div className="min-w-0 flex-1">
                                <Link
                                  href={`/admin/knowledge/${k.id}`}
                                  className="text-sm font-medium hover:text-primary hover:underline"
                                >
                                  {k.name}
                                </Link>
                                <div className="line-clamp-1 text-[11px] text-muted-foreground">
                                  {k.description.slice(0, 80)}
                                  {k.description.length > 80 ? '…' : ''}
                                </div>
                                {k.triggers.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {k.triggers.slice(0, 5).map((t) => (
                                      <span
                                        key={t}
                                        className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                                      >
                                        {t}
                                      </span>
                                    ))}
                                    {k.triggers.length > 5 && (
                                      <span className="text-[10px] text-muted-foreground">
                                        +{k.triggers.length - 5}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>

                              <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                                <span className="tabular-nums">
                                  <span className="text-primary">{positiveCount}</span>
                                  <span className="mx-0.5">/</span>
                                  <span className="text-amber-600 dark:text-amber-400">
                                    {negativeCount}
                                  </span>
                                </span>
                                <span className="tabular-nums">우선 {k.priority}</span>
                                <button
                                  type="button"
                                  onClick={() => handleToggle(k)}
                                  disabled={isToggling}
                                  className={cn(
                                    'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
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
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                );
              })}
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
