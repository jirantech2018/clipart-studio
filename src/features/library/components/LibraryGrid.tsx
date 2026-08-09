'use client';

// Infinite-scroll variant: fetches 24 images per page and appends more when
// a sentinel below the grid enters the viewport.
// P2a: 다중 선택 인프라 위에 [ZIP 다운로드] 액션을 하나만 노출. 나중에
// [조직에 공유] 등의 액션이 추가되면 actions 배열에 항목을 얹기만 하면 됨.

import { Download, Loader2, Users } from 'lucide-react';
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
} from '@/features/library/hooks/useMyImages';
import { ShareToOrgDialog } from '@/features/organization/components/ShareToOrgDialog';
import { useIntersection } from '@/lib/hooks/useIntersection';
import { useMultiSelection } from '@/lib/hooks/useMultiSelection';

import type {
  LibraryFilter,
  LibraryScope,
  LibrarySort,
} from '@/features/library/hooks/useMyImages';

interface LibraryGridProps {
  /** Plan v0.2.7 §M3-2: workspace 필터. 전달 시 해당 organization 이미지만.
   *  미전달 시 개인 owner 기반 (하위호환). */
  organizationSlug?: string;
  /** Plan v0.2.7 §M3-2 (C 방향): 조직 라이브러리 3-tab (전체/이 조직에서 만든
   *  이미지/공유받은 이미지) 노출 여부. MY workspace 는 다른 조직에서 MY 로
   *  공유될 일이 없으므로 false 로 숨긴다. */
  showWorkspaceTabs?: boolean;
}

const SCOPE_LABELS: Record<LibraryScope, string> = {
  all: '전체',
  created: '이 조직에서 만든 이미지',
  shared: '공유받은 이미지',
};

export function LibraryGrid({
  organizationSlug,
  showWorkspaceTabs = false,
}: LibraryGridProps = {}) {
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [sort, setSort] = useState<LibrarySort>('newest');
  const [scope, setScope] = useState<LibraryScope>('all');
  const [zipPending, setZipPending] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const selection = useMultiSelection('library');

  // 페이지에서 벗어나면 선택 상태 초기화.
  useEffect(() => {
    return () => selection.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 필터·정렬·탭 변경 시에도 선택 초기화 (사용자 요구 B-2.5 §5).
  useEffect(() => {
    selection.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, sort, scope]);

  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMyImages(filter, sort, organizationSlug, scope);

  const images = data?.pages.flatMap((p) => p.images) ?? [];

  const onSentinel = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const sentinelRef = useIntersection(onSentinel, {
    enabled: hasNextPage && !isFetchingNextPage,
  });

  const actions: MultiSelectAction[] = [
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
  ];

  return (
    <div className="space-y-4">
      {showWorkspaceTabs && (
        <div
          role="tablist"
          aria-label="라이브러리 범위"
          className="flex flex-wrap gap-1.5 border-b"
        >
          {(Object.keys(SCOPE_LABELS) as LibraryScope[]).map((key) => {
            const active = scope === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setScope(key)}
                className={
                  'relative -mb-px border-b-2 px-3 py-2 text-sm transition-colors ' +
                  (active
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground')
                }
              >
                {SCOPE_LABELS[key]}
              </button>
            );
          })}
        </div>
      )}

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
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
            불러오는 중 문제가 생겼어요.
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              다시 시도
            </Button>
          </CardContent>
        </Card>
      ) : images.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
            <p>
              {filter === 'all'
                ? '아직 저장한 이미지가 없어요.'
                : '조건에 맞는 이미지가 없어요.'}
            </p>
            <Link href="/generate" className={buttonVariants({ size: 'sm' })}>
              AI로 만들어보기
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* CSS Grid — 좌→우, 위→아래 순차 채움. 이전 CSS columns (masonry)
              에서는 새 데이터가 첫 컬럼 아래에 세로로 붙어 사용자가 "종렬"
              흐름으로 느꼈던 문제 해결 (CommunityGrid 와 동일 패턴). */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {images.map((image) => (
              <LibraryCard key={image.id} image={image} />
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
