'use client';

// STEP 3 — 생성 진행.
// SSE 로 append 되는 succeeded / failed 를 실시간 카운트로 노출한다.
// 진행률은 (완료+실패) / batchSize. 예상 시간은 이번 커밋 스코프 외.
// 슬롯 카드: 완료 = 썸네일, 실패 = 실패 표시, 미완료 = pulse skeleton.

import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { ASPECT_RATIO_DIMENSIONS } from '@/types/domain';

import type { Block } from '@/lib/store/conversationStore';

interface GeneratingStepProps {
  block: Block;
}

export function GeneratingStep({ block }: GeneratingStepProps) {
  const total = block.options.batchSize;
  const done = block.succeeded.length;
  const failed = block.failed.length;
  const finished = done + failed;
  const percent = total > 0 ? Math.min(100, Math.round((finished / total) * 100)) : 0;

  const dims = ASPECT_RATIO_DIMENSIONS[block.options.aspectRatio];
  const aspectStyle = { aspectRatio: `${dims.width} / ${dims.height}` };

  const slots = Array.from({ length: Math.max(1, total) }, (_, i) => {
    const success = block.succeeded.find((s) => s.order === i);
    const fail = block.failed.find((f) => f.order === i);
    return { i, success, fail };
  });

  return (
    <section className="space-y-3 rounded-md border p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <h3 className="text-base font-semibold">생성 진행 상황</h3>
          <span className="text-sm font-normal text-muted-foreground tabular-nums">
            {done}/{total} 완료{failed > 0 && ` · 실패 ${failed}`}
          </span>
        </div>
        <span className="text-sm tabular-nums text-muted-foreground">{percent}%</span>
      </header>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {slots.map(({ i, success, fail }) => {
          if (success) {
            return (
              <div
                key={i}
                className="relative overflow-hidden rounded-lg border bg-muted"
                style={aspectStyle}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={success.thumbnailUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <div className="absolute right-1 top-1 rounded-full bg-background/90 p-0.5 text-primary">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </div>
              </div>
            );
          }
          if (fail) {
            return (
              <div
                key={i}
                className="flex flex-col items-center justify-center gap-1 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive"
                style={aspectStyle}
                title={fail.error}
              >
                <AlertTriangle className="h-4 w-4" />
                <span className="tabular-nums">#{i + 1}</span>
                <span>실패</span>
              </div>
            );
          }
          return (
            <div
              key={i}
              className={cn(
                'flex flex-col items-center justify-center gap-1 rounded-lg border border-transparent bg-muted text-sm text-muted-foreground/80',
                'animate-pulse',
              )}
              style={aspectStyle}
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              <span>생성 중</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
