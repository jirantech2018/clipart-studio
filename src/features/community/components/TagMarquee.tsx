'use client';

// 홈 상단의 태그 흐름 배너. 서버에서 뽑은 image_tags 태그 리스트를 좌→우
// 무한 스크롤 형태로 보여준다. hover 시 정지 (globals.css .animate-marquee).
// 각 태그 클릭 시 /search?q=<tag> 로 이동.
//
// seamless loop 을 위해 tags 배열을 두 번 렌더 (총 200%) 하고 keyframe 이
// -50% 만큼 이동하도록 설정. 첫 세트가 완전히 지나가는 순간 두 번째 세트가
// 정확히 원래 위치에 오면서 시각적 끊김이 없다.

import Link from 'next/link';

interface TagMarqueeProps {
  tags: string[];
}

export function TagMarquee({ tags }: TagMarqueeProps) {
  if (tags.length === 0) return null;
  const doubled = [...tags, ...tags];

  return (
    <div className="relative overflow-hidden">
      <div className="flex w-max animate-marquee gap-2 whitespace-nowrap py-1">
        {doubled.map((tag, i) => (
          <Link
            key={`${tag}-${i}`}
            href={`/search?q=${encodeURIComponent(tag)}`}
            className="inline-flex shrink-0 items-center rounded-full border border-input bg-background px-3 py-1 text-sm transition-colors hover:border-primary hover:bg-accent"
          >
            #{tag}
          </Link>
        ))}
      </div>
    </div>
  );
}
