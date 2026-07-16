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

export function CommunityGrid() {
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<CommunitySort>('newest');
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
      <CommunityFilters
        category={category}
        sort={sort}
        onCategoryChange={setCategory}
        onSortChange={setSort}
      />

      {isLoading ? (
        <div className="columns-2 gap-3 sm:columns-3 xl:columns-4">
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
                : '워크스페이스에 공개된 이미지가 아직 없어요.'}
            </p>
            <Link href="/generate" className={buttonVariants({ size: 'sm' })}>
              내가 첫 이미지 만들기
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="columns-2 gap-3 sm:columns-3 xl:columns-4">
            {images.map((image) => (
              <div key={image.id} className="mb-3 break-inside-avoid">
                <CommunityCard image={image} />
              </div>
            ))}
            {isFetchingNextPage &&
              Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={`skeleton-${i}`}
                  className="mb-3 aspect-square animate-pulse break-inside-avoid rounded-lg bg-muted"
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
