'use client';

// Design Ref: §5.4 Batch Progress Panel — progress bar + card stream + done banner
// Design Ref: §2.2 SSE consumer wiring (useJobStream drives store, panel renders)
// Plan SC: FR-20 SSE UI reflection
//
// Slot-based rendering: 배치 크기만큼 order 슬롯을 미리 만들고 각 슬롯의 상태에 따라
//   idle    → 아직 시작 전, 얇은 프레임에 순번만 표시
//   pending → 스트림 중이지만 아직 이 순번의 이미지가 안 옴 (스켈레톤 pulse)
//   done    → image_ready 이벤트로 채워짐 → ResultCard
//   failed  → chunk_failed 이벤트로 실패 마킹
// 이렇게 하면 사용자가 배치/비율만 골라도 우측에서 결과가 어떻게 배열될지 미리 볼 수 있고,
// 생성이 진행되면 각자의 자리에 그대로 채워지므로 순서가 튀지 않는다.

import { AlertTriangle, CheckCircle2, ImageIcon, Loader2 } from 'lucide-react';
import { CSSProperties } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResultCard } from '@/features/generation/components/ResultCard';
import { useJobStream } from '@/features/generation/hooks/useJobStream';
import { useGenerationDraftStore } from '@/lib/store/generationDraftStore';
import { useGenerationStore } from '@/lib/store/generationStore';
import { cn } from '@/lib/utils';
import { ASPECT_RATIO_DIMENSIONS } from '@/types/domain';

import type { ChunkFailure, ResultCard as ResultCardModel } from '@/lib/store/generationStore';

export function BatchProgressPanel() {
  const jobId = useGenerationStore((s) => s.jobId);
  const runningBatchSize = useGenerationStore((s) => s.batchSize);
  const runningAspectRatio = useGenerationStore((s) => s.aspectRatio);
  const cards = useGenerationStore((s) => s.cards);
  const failures = useGenerationStore((s) => s.failures);
  const streamStatus = useGenerationStore((s) => s.streamStatus);
  const summary = useGenerationStore((s) => s.summary);
  const errorMessage = useGenerationStore((s) => s.errorMessage);
  const reset = useGenerationStore((s) => s.reset);

  const draftBatchSize = useGenerationDraftStore((s) => s.batchSize);
  const draftAspectRatio = useGenerationDraftStore((s) => s.aspectRatio);

  useJobStream(jobId);

  const isIdle = streamStatus === 'idle';
  const isStreaming = streamStatus === 'starting' || streamStatus === 'streaming';

  const total = isIdle ? draftBatchSize : runningBatchSize;
  const aspectRatio = isIdle ? draftAspectRatio : runningAspectRatio;
  const dims = ASPECT_RATIO_DIMENSIONS[aspectRatio];
  const aspectStyle: CSSProperties = { aspectRatio: `${dims.width} / ${dims.height}` };

  const finished = cards.length + failures.length;
  const percent = total > 0 ? Math.min(100, Math.round((finished / total) * 100)) : 0;

  const slots = Array.from({ length: Math.max(1, total) }, (_, i) => ({
    order: i,
    card: cards.find((c) => c.order === i) ?? null,
    failure: failures.find((f) => f.order === i) ?? null,
  }));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
            {isIdle ? (
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
            ) : isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : streamStatus === 'error' ? (
              <AlertTriangle className="h-4 w-4 text-destructive" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-primary" />
            )}
            {isIdle
              ? '준비'
              : isStreaming
                ? '생성 중'
                : streamStatus === 'error'
                  ? '오류'
                  : '완료'}
            <span className="text-sm font-normal text-muted-foreground tabular-nums">
              {isIdle ? `총 ${total}장` : `${cards.length}/${total}`}
              {!isIdle && failures.length > 0 && ` · 실패 ${failures.length}`}
            </span>
          </CardTitle>
          {!isIdle && streamStatus !== 'starting' && streamStatus !== 'streaming' && (
            <button
              type="button"
              onClick={reset}
              className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              새 생성 시작
            </button>
          )}
        </div>
        {!isIdle && (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full bg-primary transition-all duration-300',
                streamStatus === 'error' && 'bg-destructive',
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {summary && (
          <div
            className={cn(
              'rounded-md border p-3 text-sm',
              summary.failed === 0
                ? 'border-primary/40 bg-primary/5'
                : 'border-amber-500/40 bg-amber-500/5',
            )}
          >
            완료: <span className="font-semibold">{summary.completed}</span> / {total}
            {summary.failed > 0 && (
              <>
                {' · 실패 '}
                <span className="font-semibold">{summary.failed}</span>
                {' · 환불 '}
                <span className="font-semibold">{summary.refundedCredits}</span> 크레딧
              </>
            )}
            {summary.finalRemainingCredits !== null && (
              <>
                {' · 잔액 '}
                <span className="font-semibold tabular-nums">
                  {summary.finalRemainingCredits}
                </span>
              </>
            )}
          </div>
        )}

        {streamStatus === 'error' && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {errorMessage ?? '알 수 없는 오류'}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {slots.map(({ order, card, failure }) => (
            <SlotFrame
              key={order}
              order={order}
              card={card}
              failure={failure}
              isStreaming={isStreaming}
              isIdle={isIdle}
              aspectStyle={aspectStyle}
            />
          ))}
        </div>

        {isIdle && (
          <p className="text-center text-xs text-muted-foreground">
            좌측에서 &ldquo;이미지 만들기&rdquo; 를 누르면 각 칸이 채워집니다.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface SlotFrameProps {
  order: number;
  card: ResultCardModel | null;
  failure: ChunkFailure | null;
  isStreaming: boolean;
  isIdle: boolean;
  aspectStyle: CSSProperties;
}

function SlotFrame({
  order,
  card,
  failure,
  isStreaming,
  isIdle,
  aspectStyle,
}: SlotFrameProps) {
  if (card) {
    return <ResultCard card={card} aspectStyle={aspectStyle} />;
  }

  if (failure) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-1 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-center text-[11px] text-destructive"
        style={aspectStyle}
        title={failure.error}
      >
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        <span className="tabular-nums">#{order + 1}</span>
        <span>실패</span>
      </div>
    );
  }

  // idle: 얇은 프레임, streaming: pulse 스켈레톤
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-lg border text-xs tabular-nums text-muted-foreground/60',
        isStreaming
          ? 'animate-pulse border-transparent bg-muted'
          : isIdle
            ? 'border-dashed bg-muted/30'
            : 'border-dashed bg-muted/40',
      )}
      style={aspectStyle}
      aria-hidden={isStreaming ? undefined : true}
    >
      {isStreaming ? '' : `#${order + 1}`}
    </div>
  );
}
