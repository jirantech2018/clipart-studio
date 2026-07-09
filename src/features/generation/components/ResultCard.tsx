'use client';

// Design Ref: §5.4 Batch Progress Panel — result card
// Policy: generated images are auto-saved to the library. No user save/discard action.
// Non-Negotiable Rule 3 (CLAUDE.md): AI 라벨 필수.

import { AIGeneratedBadge } from '@/components/ui/AIGeneratedBadge';

import type { ResultCard as ResultCardModel } from '@/lib/store/generationStore';

export function ResultCard({ card }: { card: ResultCardModel }) {
  return (
    <div className="group relative overflow-hidden rounded-lg border bg-card shadow-sm card-fade-in">
      <div className="relative aspect-square w-full bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={card.thumbnailUrl}
          alt={`생성 결과 ${card.order + 1}번`}
          className="h-full w-full object-cover"
          loading="lazy"
        />
        <div className="absolute right-2 top-2">
          <AIGeneratedBadge />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 p-2 text-xs text-muted-foreground">
        <span className="tabular-nums">#{card.order + 1}</span>
        <span>라이브러리에 저장됨</span>
      </div>
    </div>
  );
}
