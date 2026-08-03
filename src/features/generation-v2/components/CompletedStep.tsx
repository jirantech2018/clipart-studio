'use client';

// STEP 4 — 생성 완료.
// Generating 자리를 완료 요약으로 교체. 부분 성공 (완료 N · 실패 M) 도
// 그대로 표현. 이미지 카드는 클릭 시 이미지 상세로 이동.

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

import { AIGeneratedBadge } from '@/components/ui/AIGeneratedBadge';
import { cn } from '@/lib/utils';
import { ASPECT_RATIO_DIMENSIONS } from '@/types/domain';

import type { Block } from '@/lib/store/conversationStore';

interface CompletedStepProps {
  block: Block;
}

export function CompletedStep({ block }: CompletedStepProps) {
  const succeeded = block.succeeded.length;
  const failed = block.failed.length;
  const total = block.options.batchSize;
  const dims = ASPECT_RATIO_DIMENSIONS[block.options.aspectRatio];
  const aspectStyle = { aspectRatio: `${dims.width} / ${dims.height}` };

  const allFailed = succeeded === 0 && failed > 0;

  return (
    <section
      className={cn(
        'space-y-3 rounded-md border p-4',
        allFailed
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-primary/40 bg-primary/5',
      )}
    >
      <header className="flex items-center gap-2">
        {allFailed ? (
          <AlertTriangle className="h-4 w-4 text-destructive" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-primary" />
        )}
        <h3 className="text-base font-semibold">
          {allFailed ? '생성 실패' : '생성 완료'}
        </h3>
        <span className="text-sm font-normal text-muted-foreground tabular-nums">
          완료 {succeeded}
          {failed > 0 && ` · 실패 ${failed}`} / {total}
        </span>
      </header>

      {succeeded > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {block.succeeded.map((img) => (
            <Link
              key={img.imageId}
              href={`/image/${img.imageId}`}
              className="group relative block overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow hover:border-primary/60 hover:shadow-md"
            >
              <div className="relative bg-muted" style={aspectStyle}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.thumbnailUrl}
                  alt={`생성 결과 ${img.order + 1}번`}
                  className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                  loading="lazy"
                />
                <div className="absolute right-2 top-2">
                  <AIGeneratedBadge />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 p-2 text-sm text-muted-foreground">
                <span className="tabular-nums">#{img.order + 1}</span>
                <span>라이브러리에 저장됨</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {failed > 0 && (
        <p className="text-sm text-muted-foreground">
          {failed}장은 실패해 크레딧이 자동 환불됐어요.
          {succeeded === 0 && ' 프롬프트를 다시 정리해 새 생성을 시작해보세요.'}
        </p>
      )}
    </section>
  );
}
