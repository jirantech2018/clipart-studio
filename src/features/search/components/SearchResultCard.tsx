'use client';

// Design Ref: §5.4 Search result card — thumbnail + prompt + categories/tags + author badge
// Non-Negotiable Rule 3: AI 라벨 필수

import Link from 'next/link';

import { AIGeneratedBadge } from '@/components/ui/AIGeneratedBadge';
import { AuthorBadge } from '@/features/community/components/AuthorBadge';

import type { SearchImage } from '@/features/search/hooks/useSearch';

export function SearchResultCard({ image }: { image: SearchImage }) {
  return (
    <div className="group relative overflow-hidden rounded-lg border bg-card shadow-sm">
      <Link
        href={`/image/${image.id}`}
        aria-label="상세 보기"
        className="relative block aspect-square w-full bg-muted"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.thumbnailUrl}
          alt={image.prompt}
          className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
          loading="lazy"
        />
        <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
          <AIGeneratedBadge />
          {image.isMine && (
            <span className="rounded-full bg-primary/80 px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
              내 이미지
            </span>
          )}
        </div>
      </Link>
      <div className="space-y-1.5 p-3">
        <AuthorBadge
          authorType={image.authorType}
          authorSchoolName={image.authorSchoolName}
        />
        <p className="line-clamp-2 text-xs text-muted-foreground" title={image.prompt}>
          {image.prompt}
        </p>
        {image.categories.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {image.categories.map((cat) => (
              <span
                key={cat}
                className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
              >
                {cat}
              </span>
            ))}
          </div>
        )}
        {image.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {image.tags.slice(0, 5).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
