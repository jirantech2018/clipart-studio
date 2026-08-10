'use client';

// Infinite-scroll variant: fetches 24 images per page and appends more when
// a sentinel below the grid enters the viewport.
// P2a: 다중 선택 인프라 위에 [ZIP 다운로드] 액션을 하나만 노출. 나중에
// [조직에 공유] 등의 액션이 추가되면 actions 배열에 항목을 얹기만 하면 됨.

import { Download, Loader2, RotateCcw, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { MultiSelectActionBar } from '@/components/multiselect/MultiSelectActionBar';
import type { MultiSelectAction } from '@/components/multiselect/MultiSelectActionBar';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LibraryCard } from '@/features/library/components/LibraryCard';
import { LibraryFilters } from '@/features/library/components/LibraryFilters';
import {
  downloadImagesAsZip,
  useMyImages,
  useRestoreImage,
  useTrashImage,
} from '@/features/library/hooks/useMyImages';
import { ShareToOrgDialog } from '@/features/organization/components/ShareToOrgDialog';
import { useIntersection } from '@/lib/hooks/useIntersection';
import { useMultiSelection } from '@/lib/hooks/useMultiSelection';

import type {
  LibraryFilter,
  LibraryScope,
  LibrarySort,
  LibraryTrash,
} from '@/features/library/hooks/useMyImages';

interface LibraryGridProps {
  /** workspace 필터. 전달 시 해당 organization 이미지만.
   *  미전달 시 개인 owner 기반 (하위호환). */
  organizationSlug?: string;
  /** 하위호환 — 이제 모든 workspace 가 동일한 5-tab 을 노출하므로 미사용.
   *  prop 은 API 하위호환을 위해 남겨두되 로직에 영향 없음. */
  showWorkspaceTabs?: boolean;
}

// 5개 탭 통합: 전체 / 이 조직에서 만든 이미지 / 이 조직에서 공유 중인 이미지 /
// 공유받은 이미지 / 휴지통. 각 탭은 (scope, trash) 조합으로 서버에 매핑된다.
type LibraryTab =
  | 'all'
  | 'created'
  | 'shared_out'
  | 'shared'
  | 'trashed';

const TAB_LABELS: Record<LibraryTab, string> = {
  all: '전체',
  created: '이 조직에서 만든 이미지',
  shared_out: '이 조직에서 공유 중인 이미지',
  shared: '공유받은 이미지',
  trashed: '휴지통',
};

function tabToQuery(tab: LibraryTab): { scope: LibraryScope; trash: LibraryTrash } {
  switch (tab) {
    case 'trashed':
      return { scope: 'created', trash: 'trashed' };
    case 'all':
    case 'created':
    case 'shared_out':
    case 'shared':
      return { scope: tab, trash: 'active' };
  }
}

export function LibraryGrid({
  organizationSlug,
}: LibraryGridProps = {}) {
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [sort, setSort] = useState<LibrarySort>('newest');
  const [tab, setTab] = useState<LibraryTab>('all');
  const [zipPending, setZipPending] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [bulkTrashPending, setBulkTrashPending] = useState(false);
  const [bulkRestorePending, setBulkRestorePending] = useState(false);
  const selection = useMultiSelection('library');
  const trashMutation = useTrashImage();
  const restoreMutation = useRestoreImage();

  const trashView: LibraryTrash = tab === 'trashed' ? 'trashed' : 'active';
  const { scope, trash } = tabToQuery(tab);

  // 페이지에서 벗어나면 선택 상태 초기화.
  useEffect(() => {
    return () => selection.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 필터·정렬·탭 변경 시에도 선택 초기화.
  useEffect(() => {
    selection.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, sort, tab]);

  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMyImages(filter, sort, organizationSlug, scope, trash);

  // 휴지통 탭 라벨 옆 카운트 배지. count 실패 시 감춤.
  const trashCountQuery = useMyImages(filter, sort, organizationSlug, 'created', 'trashed');
  const trashCountKnown = trashCountQuery.isSuccess;
  const trashCount = trashCountQuery.data?.pages?.[0]?.total ?? 0;

  // 방어적으로: page 하나가 undefined 이거나 images 필드가 누락돼도 map 하지
  // 않도록. useMyImages 는 이미 shape 을 보장하지만 mismatch chunk 등으로
  // undefined page 가 섞이는 경우도 방어.
  const images =
    data?.pages
      .flatMap((p) => (p && Array.isArray(p.images) ? p.images : []))
      .filter((img): img is NonNullable<typeof img> => !!img && !!img.id) ?? [];

  const onSentinel = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const sentinelRef = useIntersection(onSentinel, {
    enabled: hasNextPage && !isFetchingNextPage,
  });

  // 뷰별 다중선택 액션.
  const actions: MultiSelectAction[] = trashView === 'trashed'
    ? [
        {
          key: 'bulk-restore',
          label: bulkRestorePending ? '복원 중…' : `복원 (${selection.count})`,
          icon: bulkRestorePending ? Loader2 : RotateCcw,
          variant: 'default',
          isPending: bulkRestorePending,
          onClick: async (ids) => {
            if (bulkRestorePending) return;
            setBulkRestorePending(true);
            // 이용 관리자(SUPER_ADMIN) 가 이동한 이미지는 사용자가 복원할 수
            // 없다. 선택 목록에서 미리 걸러내 서버 왕복 없이 안내.
            const restorable: string[] = [];
            const adminLocked: string[] = [];
            for (const id of ids) {
              const img = images.find((i) => i.id === id);
              if (img && img.trashActorType === 'SUPER_ADMIN') adminLocked.push(id);
              else restorable.push(id);
            }
            try {
              let succeeded = 0;
              let failed = 0;
              for (const id of restorable) {
                try {
                  await restoreMutation.mutateAsync(id);
                  succeeded += 1;
                } catch {
                  failed += 1;
                }
              }
              if (succeeded > 0) {
                toast.success(`${succeeded}개 복원했어요`);
              }
              if (adminLocked.length > 0) {
                toast.error(
                  `${adminLocked.length}개는 이용 관리자만 복원할 수 있어요`,
                );
              }
              if (failed > 0) {
                toast.error(`${failed}개 복원 실패`);
              }
              selection.clear();
            } finally {
              setBulkRestorePending(false);
            }
          },
        },
      ]
    : [
        {
          key: 'download-zip',
          label: zipPending ? 'ZIP 만드는 중…' : `ZIP 다운로드 (${selection.count})`,
          icon: zipPending ? Loader2 : Download,
          variant: 'default',
          isPending: zipPending,
          onClick: async (ids) => {
            if (zipPending) return;
            setZipPending(true);
            try {
              await downloadImagesAsZip(ids, 'library');
              toast.success('다운로드를 시작했어요');
              selection.clear();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'ZIP 다운로드 실패');
            } finally {
              setZipPending(false);
            }
          },
        },
        {
          key: 'share-orgs',
          label: `조직에 공유 (${selection.count})`,
          icon: Users,
          variant: 'outline',
          onClick: () => {
            setShareDialogOpen(true);
          },
        },
        {
          key: 'bulk-trash',
          label: bulkTrashPending ? '이동 중…' : `휴지통으로 이동 (${selection.count})`,
          icon: bulkTrashPending ? Loader2 : Trash2,
          variant: 'destructive',
          isPending: bulkTrashPending,
          onClick: async (ids) => {
            if (bulkTrashPending) return;
            if (
              !window.confirm(
                `${ids.length}개의 이미지를 휴지통으로 이동할까요?\n삭제되지 않으며 언제든 복원할 수 있어요.`,
              )
            )
              return;
            setBulkTrashPending(true);
            try {
              for (const id of ids) {
                await trashMutation.mutateAsync({ id });
              }
              toast.success(`${ids.length}개 휴지통으로 이동했어요`);
              selection.clear();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : '휴지통 이동 실패');
            } finally {
              setBulkTrashPending(false);
            }
          },
        },
      ];

  return (
    <div className="space-y-4">
      {/* 5-tab 한 줄. 좁은 뷰포트에서는 가로 스크롤. MY/조직 workspace 모두 동일. */}
      <div className="border-b">
        <div
          role="tablist"
          aria-label="라이브러리 탭"
          className="flex gap-1 overflow-x-auto whitespace-nowrap"
        >
          {(Object.keys(TAB_LABELS) as LibraryTab[]).map((key) => {
            const active = tab === key;
            const isTrash = key === 'trashed';
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(key)}
                className={
                  'relative -mb-px inline-flex shrink-0 items-center gap-1 border-b-2 px-3 py-2 text-sm transition-colors ' +
                  (active
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground')
                }
              >
                {isTrash && <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                {TAB_LABELS[key]}
                {isTrash && trashCountKnown && trashCount > 0 && (
                  <span
                    className={
                      'ml-1 rounded-full px-1.5 text-[10px] font-medium ' +
                      (active ? 'bg-primary/15 text-primary' : 'bg-muted text-foreground')
                    }
                  >
                    {trashCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <LibraryFilters
        filter={filter}
        sort={sort}
        onFilterChange={setFilter}
        onSortChange={setSort}
      />

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square animate-pulse rounded-lg bg-muted"
              aria-hidden="true"
            />
          ))}
        </div>
      ) : isError ? (
        // 명확히 Error State — 정상 응답의 empty 와 구분되어야 한다.
        // 원본 오류는 useMyImages 안에서 console.error 로 이미 로깅됨.
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm">
            <p className="font-medium text-destructive">이미지를 불러오지 못했습니다.</p>
            <p className="text-xs text-muted-foreground">
              네트워크 또는 서버 상태를 확인한 뒤 다시 시도해주세요.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              다시 시도
            </Button>
          </CardContent>
        </Card>
      ) : images.length === 0 ? (
        // 정상 응답 · 0개 데이터. 위 error card 와 UX 를 명확히 구분한다.
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
            <p>
              {trashView === 'trashed'
                ? '휴지통이 비어 있어요.'
                : filter === 'all'
                  ? '아직 생성된 이미지가 없습니다.'
                  : '조건에 맞는 이미지가 없어요.'}
            </p>
            {trashView === 'active' && (
              <Link href="/generate" className={buttonVariants({ size: 'sm' })}>
                AI로 만들어보기
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* CSS Grid — 좌→우, 위→아래 순차 채움. 이전 CSS columns (masonry)
              에서는 새 데이터가 첫 컬럼 아래에 세로로 붙어 사용자가 "종렬"
              흐름으로 느꼈던 문제 해결 (CommunityGrid 와 동일 패턴). */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {images.map((image) => (
              <LibraryCard
                key={image.id}
                image={image}
                trashMode={trashView === 'trashed'}
              />
            ))}
            {isFetchingNextPage &&
              Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={`skeleton-${i}`}
                  className="aspect-square animate-pulse rounded-lg bg-muted"
                  aria-hidden="true"
                />
              ))}
          </div>
          {hasNextPage && (
            <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />
          )}
        </>
      )}

      <MultiSelectActionBar
        count={selection.count}
        selectedIds={selection.selectedIds}
        actions={actions}
        onClear={selection.clear}
      />

      <ShareToOrgDialog
        imageIds={selection.selectedIds}
        open={shareDialogOpen}
        onClose={() => setShareDialogOpen(false)}
        onDone={() => selection.clear()}
      />
    </div>
  );
}
