'use client';

// 홈 상단 태그 캐러셀. 좌/우 화살표 버튼으로 한 페이지씩 넘기며 순환한다.
// 자동 흐름(marquee)이 아니라 사용자 조작이 필요.
//   • pageIndex 는 (pageIndex ± 1 + totalPages) % totalPages 로 모듈러 순환
//     → 첫/끝 페이지에서도 계속 넘어갈 수 있는 무한 루프.
//   • 각 페이지의 태그 pill 을 클릭하면 /search?q=<tag> 로 이동.

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

interface TagMarqueeProps {
  tags: string[];
}

// 한 페이지에 노출할 태그 수. 데스크톱 기준 여유롭게 8 개.
const PAGE_SIZE = 8;

export function TagMarquee({ tags }: TagMarqueeProps) {
  const [pageIndex, setPageIndex] = useState(0);

  if (tags.length === 0) return null;

  const totalPages = Math.max(1, Math.ceil(tags.length / PAGE_SIZE));
  const start = pageIndex * PAGE_SIZE;
  const visible = tags.slice(start, start + PAGE_SIZE);

  const prev = () => setPageIndex((p) => (p - 1 + totalPages) % totalPages);
  const next = () => setPageIndex((p) => (p + 1) % totalPages);

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={prev}
        aria-label="이전 태그"
        className="h-9 w-9 shrink-0"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div
        className="flex flex-1 flex-wrap items-center gap-2 overflow-hidden"
        key={pageIndex /* 페이지 바뀔 때마다 리마운트 → 카드 fade-in 효과 재발동 */}
      >
        {visible.map((tag) => (
          <Link
            key={tag}
            href={`/search?q=${encodeURIComponent(tag)}`}
            className="inline-flex items-center rounded-full border border-input bg-background px-3 py-1 text-sm transition-colors hover:border-primary hover:bg-accent"
          >
            #{tag}
          </Link>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={next}
        aria-label="다음 태그"
        className="h-9 w-9 shrink-0"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
