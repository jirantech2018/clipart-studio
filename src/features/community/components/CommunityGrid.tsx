'use client';

// Design Ref: §5.4 Community feed — filters + grid + loading/error/empty states.

import Link from 'next/link';
import { useState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CommunityCard } from '@/features/community/components/CommunityCard';
import { CommunityFilters } from '@/features/community/components/CommunityFilters';
import { useCommunity } from '@/features/community/hooks/useCommunity';

import type { CommunitySort } from '@/features/community/hooks/useCommunity';

export function CommunityGrid() {
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<CommunitySort>('newest');
  const { data, isLoading, isError, refetch } = useCommunity(category, sort);

  const images = data?.images ?? [];

  return (
    <div className="space-y-4">
      <CommunityFilters
        category={category}
        sort={sort}
        onCategoryChange={setCategory}
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
                : 'Community에 공개된 이미지가 아직 없어요.'}
            </p>
            <Link href="/generate" className={buttonVariants({ size: 'sm' })}>
              내가 첫 이미지 만들기
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {images.map((image) => (
            <CommunityCard key={image.id} image={image} />
          ))}
        </div>
      )}
    </div>
  );
}
