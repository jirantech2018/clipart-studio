'use client';

// Infinite-scroll workspace grid. Sentinel below the grid triggers the next page.
// P2b: 라이브러리와 동일한 다중 선택 인프라를 얹어 [ZIP 다운로드] 액션 노출.
// 서버 API 는 scope='community' 로 호출되어 is_on_community=TRUE 이미지만 검증.

import { Download, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { MultiSelectActionBar } from '@/components/multiselect/MultiSelectActionBar';
import type { MultiSelectAction } from '@/components/multiselect/MultiSelectActionBar';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CommunityCard } from '@/features/community/components/CommunityCard';
import { CommunityFilters } from '@/features/community/components/CommunityFilters';
import { useCommunity } from '@/features/community/hooks/useCommunity';
import { downloadImagesAsZip } from '@/features/library/hooks/useMyImages';
import { useIntersection } from '@/lib/hooks/useIntersection';
import { useMultiSelection } from '@/lib/hooks/useMultiSelection';

import type { CommunitySort } from '@/features/community/hooks/useCommunity';

interface CommunityGridProps {
  /** 홈에서는 12개 고정 카테고리 chip 대신 TagMarquee 를 위에 배치하므로
   *  Grid 내부 필터의 category 버튼 영역만 감춘다. */
  hideCategoryFilters?: boolean;
  /** 홈에서는 sort 드롭다운을 TagMarquee 우측으로 옮기므로 Grid 내부의
   *  정렬 필터 자체를 완전히 감춘다. */
  hideFilters?: boolean;
  /** sort 를 외부에서 제어. 지정하지 않으면 내부 state 로 폴백. */
  sort?: CommunitySort;
  onSortChange?: (next: CommunitySort) => void;
}

export function CommunityGrid({
  hideCategoryFilters = false,
  hideFilters = false,
  sort: externalSort,
  onSortChange,
}: CommunityGridProps = {}) {
  const [category, setCategory] = useState<string | null>(null);
  const [internalSort, setInternalSort] = useState<CommunitySort>('newest');
  const sort = externalSort ?? internalSort;
  const setSort = onSortChange ?? setInternalSort;
  const [zipPending, setZipPending] = useState(false);
  const selection = useMultiSelection('community');

  // 페이지를 벗어나면 선택 상태 초기화.
  useEffect(() => {
    return () => selection.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useCommunity(category, sort);

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
      label: zipPending ? 'ZIP 만드는 중…' : 'ZIP 다운로드',
      icon: zipPending ? Loader2 : Download,
      variant: 'default',
      isPending: zipPending,
      onClick: async (ids) => {
        if (zipPending) return;
        setZipPending(true);
        try {
          await downloadImagesAsZip(ids, 'community');
          toast.success('다운로드를 시작했어요');
          selection.clear();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'ZIP 다운로드 실패');
        } finally {
          setZipPending(false);
        }
      },
    },
  ];

  return (
    <div className="space-y-4">
      {!hideFilters && (
        <CommunityFilters
          category={category}
          sort={sort}
          onCategoryChange={setCategory}
          onSortChange={setSort}
          hideCategoryButtons={hideCategoryFilters}
        />
      )}

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
            <button
              type="button"
              onClick={() => refetch()}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              다시 시도
            </button>
          </CardContent>
        </Card>
      ) : images.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
            <p>
              {category
                ? `"${category}" 카테고리에 공개된 이미지가 아직 없어요.`
                : '공유 라이브러리에 공개된 이미지가 아직 없어요.'}
            </p>
            <Link href="/generate" className={buttonVariants({ size: 'sm' })}>
              내가 첫 클립아트 만들기
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* CSS Grid — 좌→우, 위→아래 순차 채움. 이전 CSS columns (masonry)
              에서는 새 데이터가 첫 컬럼 아래에 세로로 붙어 사용자가 "종렬"
              흐름으로 느꼈던 문제 해결. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {images.map((image) => (
              <CommunityCard key={image.id} image={image} />
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
    </div>
  );
}
