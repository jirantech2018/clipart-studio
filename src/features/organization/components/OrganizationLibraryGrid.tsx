'use client';

// 조직에 공유된 이미지 그리드. LibraryGrid 와 유사한 무한 스크롤 패턴.
// P5-C Phase B-1: 공개 상태 필터 (전체/미공개/공유 라이브러리 공개 중) +
// owner 전용 단일 공개·해제 액션 (카드 hover).
// multi-select / ZIP 은 Phase B-2 로 미룸.

import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { OrganizationImageCard } from '@/features/organization/components/OrganizationImageCard';
import { useOrganizationImages } from '@/features/organization/hooks/useOrganizationShares';
import { useOrganization } from '@/features/organization/hooks/useOrganizations';
import { useIntersection } from '@/lib/hooks/useIntersection';
import { cn } from '@/lib/utils';

import type { OrgLibraryFilter } from '@/features/organization/hooks/useOrganizationShares';

const FILTER_LABELS: Record<OrgLibraryFilter, string> = {
  all: '전체',
  unpublished: '미공개',
  published: '공유 라이브러리 공개 중',
};

export function OrganizationLibraryGrid({
  slug,
  currentUserId,
}: {
  slug: string;
  currentUserId: string;
}) {
  const [filter, setFilter] = useState<OrgLibraryFilter>('all');
  const { data: orgData, isLoading: orgLoading } = useOrganization(slug);
  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useOrganizationImages(slug, filter, 'newest');

  const org = orgData?.organization;
  // owner 만 커뮤니티 승격/해제 액션과 다른 사람 이미지 조직 제거가 가능.
  const isOrgOwner = org?.myRole === 'owner';
  const orgId = org?.id ?? null;

  const images = data?.pages.flatMap((p) => p.images) ?? [];

  const onSentinel = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const sentinelRef = useIntersection(onSentinel, {
    enabled: hasNextPage && !isFetchingNextPage,
  });

  if (orgLoading) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  }
  if (!org) {
    return <p className="text-sm text-muted-foreground">조직을 찾을 수 없어요.</p>;
  }

  return (
    <div className="space-y-4">
      <Link
        href={`/organization/${slug}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {org.name}
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">조직 라이브러리</h1>
        <p className="text-sm text-muted-foreground">
          멤버들이 이 조직에 공유한 이미지 모음이에요.
        </p>
      </div>

      {/* 공개 상태 필터 — 세그먼트 컨트롤 형태 */}
      <div className="flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1 text-sm">
        {(['all', 'unpublished', 'published'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              filter === key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={filter === key}
          >
            {FILTER_LABELS[key]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="columns-2 gap-3 sm:columns-3 xl:columns-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="mb-3 aspect-square animate-pulse break-inside-avoid rounded-lg bg-muted"
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
            {filter === 'all' ? (
              <>
                <p>아직 이 조직에 공유된 이미지가 없어요.</p>
                <p className="text-xs">
                  내 라이브러리에서 이미지 상세를 열고 "조직에 공유" 를 눌러 얹을 수 있어요.
                </p>
              </>
            ) : filter === 'unpublished' ? (
              <p>미공개 상태의 이미지가 없어요.</p>
            ) : (
              <p>이 조직에서 공유 라이브러리에 공개한 이미지가 없어요.</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="columns-2 gap-3 sm:columns-3 xl:columns-4">
            {images.map((image) => (
              <div key={image.id} className="mb-3 break-inside-avoid">
                <OrganizationImageCard
                  slug={slug}
                  orgId={orgId}
                  image={image}
                  canUnshare={image.userId === currentUserId || isOrgOwner}
                  isOrgOwner={isOrgOwner}
                />
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
          {!hasNextPage && (
            <div className="flex justify-center py-4 text-xs text-muted-foreground">
              <Loader2 className="mr-1 h-3 w-3 opacity-0" aria-hidden="true" />
              모두 불러왔어요
            </div>
          )}
        </>
      )}
    </div>
  );
}
