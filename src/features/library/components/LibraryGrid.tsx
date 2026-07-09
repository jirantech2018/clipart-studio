'use client';

// Design Ref: §5.4 Library Page — image grid with filter/sort state + empty state
// Client component so filter/sort don't trigger full page navigation.

import Link from 'next/link';
import { useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LibraryCard } from '@/features/library/components/LibraryCard';
import { LibraryFilters } from '@/features/library/components/LibraryFilters';
import { useMyImages } from '@/features/library/hooks/useMyImages';

import type { LibraryFilter, LibrarySort } from '@/features/library/hooks/useMyImages';

export function LibraryGrid() {
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [sort, setSort] = useState<LibrarySort>('newest');
  const { data, isLoading, isError, refetch } = useMyImages(filter, sort);

  const images = data?.images ?? [];

  return (
    <div className="space-y-4">
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {images.map((image) => (
            <LibraryCard key={image.id} image={image} />
          ))}
        </div>
      )}
    </div>
  );
}
