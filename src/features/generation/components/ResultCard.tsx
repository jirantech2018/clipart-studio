'use client';

// Design Ref: §5.4 Batch Progress Panel — result card
// Policy: generated images are auto-saved to the library. No user save/discard action.
// Non-Negotiable Rule 3 (CLAUDE.md): AI 라벨 필수.

import Link from 'next/link';
import { CSSProperties } from 'react';

import { AIGeneratedBadge } from '@/components/ui/AIGeneratedBadge';

import type { ResultCard as ResultCardModel } from '@/lib/store/generationStore';

interface ResultCardProps {
  card: ResultCardModel;
  aspectStyle?: CSSProperties;
}

export function ResultCard({ card, aspectStyle }: ResultCardProps) {
  return (
    <Link
      href={`/image/${card.imageId}`}
      className="group relative block overflow-hidden rounded-lg border bg-card shadow-sm card-fade-in card-highlight transition-shadow hover:border-primary/60 hover:shadow-md focus:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div
        className="relative w-full bg-muted"
        style={aspectStyle ?? { aspectRatio: '1 / 1' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={card.thumbnailUrl}
          alt={`생성 결과 ${card.order + 1}번`}
          className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
          loading="lazy"
        />
        <div className="absolute right-2 top-2">
          <AIGeneratedBadge />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 p-2 text-sm text-muted-foreground">
        <span className="tabular-nums">#{card.order + 1}</span>
        <span>라이브러리에 저장됨</span>
      </div>
    </Link>
  );
}
