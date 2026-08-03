'use client';

// STEP 3 — 생성 진행 (AI 응답).
//
// Conversation Timeline 안에서 AI 가 "이미지를 만들고 있어요" 라고 응답하는
// 단계. SSE 로 append 되는 succeeded / failed 를 실시간 카운트로 노출한다.
// 진행률은 (완료 + 실패) / batchSize.
//
// 슬롯 시각:
//   완료  → 썸네일 + 체크 배지
//   실패  → 실패 배지 (에러 title tooltip)
//   대기  → pulse skeleton + spinner (서버가 슬롯별 진행률을 주지 않으므로
//           faked % 로 사용자 신뢰를 훼손하지 않는다)

import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

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
    <section className="space-y-3 rounded-xl border bg-background p-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
            <h3 className="text-base font-semibold">이미지를 만들고 있어요</h3>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
            <span>
              완료 {done} / {total}
              {failed > 0 && ` · 실패 ${failed}`}
            </span>
            <span className="font-semibold text-foreground">{percent}%</span>
          </div>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {slots.map(({ i, success, fail }) => (
          <div
            key={i}
            className="relative overflow-hidden rounded-lg border bg-muted"
            style={aspectStyle}
          >
            {success ? (
              <>
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
              </>
            ) : fail ? (
              <div
                className="flex h-full w-full flex-col items-center justify-center gap-1 border border-destructive/40 bg-destructive/5 text-xs text-destructive"
                title={fail.error}
              >
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                <span>실패</span>
              </div>
            ) : (
              <div className="flex h-full w-full animate-pulse flex-col items-center justify-center gap-1 text-xs text-muted-foreground/70">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                <span>생성 중</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
