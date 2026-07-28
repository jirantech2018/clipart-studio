'use client';

// 홈 상단 한 줄: [좌측 이전 화살표] [태그 리스트] [최신순/인기순 드롭다운]
//   • 좌측 화살표 하나만 — 클릭 시 다음 페이지 로드, 마지막 페이지 이후 첫
//     페이지로 순환 (무한 루프).
//   • 태그 pill 은 /search?q=<tag> 링크.
//   • 우측 드롭다운은 CommunityGrid 의 sort 상태를 controlled 로 조작.

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import type { CommunitySort } from '@/features/community/hooks/useCommunity';

interface TagMarqueeProps {
  tags: string[];
  sort: CommunitySort;
  onSortChange: (next: CommunitySort) => void;
}

// 한 페이지에 노출할 태그 수 — flex-nowrap 한 줄에 맞도록 6 개.
const PAGE_SIZE = 6;

const SORT_LABELS: Record<CommunitySort, string> = {
  newest: '최신순',
  popular: '인기순',
};

export function TagMarquee({ tags, sort, onSortChange }: TagMarqueeProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const totalPages = tags.length > 0 ? Math.max(1, Math.ceil(tags.length / PAGE_SIZE)) : 1;
  const start = pageIndex * PAGE_SIZE;
  const visible = tags.slice(start, start + PAGE_SIZE);

  // 좌측 화살표 클릭 시 다음 페이지로 넘어가고 마지막에서 첫으로 순환.
  const advance = () => setPageIndex((p) => (p + 1) % totalPages);

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={advance}
        aria-label="다음 태그"
        disabled={tags.length === 0}
        className="h-9 w-9 shrink-0"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      {/* 태그 리스트 — flex-nowrap 한 줄, overflow-hidden 으로 화면 넘어가는
          부분은 잘림. 태그가 없으면 회색 안내. */}
      <div className="flex flex-1 items-center gap-2 overflow-hidden whitespace-nowrap">
        {visible.length > 0 ? (
          visible.map((tag) => (
            <Link
              key={tag}
              href={`/search?q=${encodeURIComponent(tag)}`}
              className="inline-flex shrink-0 items-center rounded-full border border-input bg-background px-3 py-1 text-sm transition-colors hover:border-primary hover:bg-accent"
            >
              #{tag}
            </Link>
          ))
        ) : (
          <span className="text-sm text-muted-foreground">
            아직 공유된 이미지가 없어요.
          </span>
        )}
      </div>

      <select
        value={sort}
        onChange={(e) => onSortChange(e.target.value as CommunitySort)}
        className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
        aria-label="정렬 방식"
      >
        {(Object.keys(SORT_LABELS) as CommunitySort[]).map((key) => (
          <option key={key} value={key}>
            {SORT_LABELS[key]}
          </option>
        ))}
      </select>
    </div>
  );
}
