'use client';

// STEP 4 — 생성 완료 (AI 응답).
//
// Conversation Timeline 에서 AI 가 결과를 돌려주는 단계. 부분 성공 (완료 N ·
// 실패 M) 도 그대로 표현. 이미지 카드는 클릭 시 이미지 상세로 이동하고,
// 우하단 다운로드 아이콘 오버레이로 즉시 다운로드가 가능하다.
//
// 다운로드는 라이브러리와 동일하게 downloadImageFile 유틸을 그대로 소비 —
// 신규 API 없음. 실패 시 toast 노출.

import { AlertTriangle, CheckCircle2, Download, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { AIGeneratedBadge } from '@/components/ui/AIGeneratedBadge';
import { downloadImageFile } from '@/features/library/hooks/useMyImages';
import { cn } from '@/lib/utils';
import { ASPECT_RATIO_DIMENSIONS } from '@/types/domain';

import type { Block } from '@/lib/store/conversationStore';

interface CompletedStepProps {
  block: Block;
}

export function CompletedStep({ block }: CompletedStepProps) {
  const succeeded = block.succeeded.length;
  const failed = block.failed.length;
  const dims = ASPECT_RATIO_DIMENSIONS[block.options.aspectRatio];
  const aspectStyle = { aspectRatio: `${dims.width} / ${dims.height}` };
  const [pendingId, setPendingId] = useState<string | null>(null);

  const allFailed = succeeded === 0 && failed > 0;

  async function handleDownload(imageId: string) {
    if (pendingId) return;
    setPendingId(imageId);
    try {
      await downloadImageFile(imageId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '다운로드에 실패했어요');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section
      className={cn(
        'space-y-3 rounded-xl border p-4',
        allFailed
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-primary/40 bg-primary/5',
      )}
    >
      <header className="flex flex-wrap items-center gap-2">
        {allFailed ? (
          <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
        )}
        <h3 className="text-base font-semibold">
          {allFailed
            ? '이미지 생성에 실패했어요'
            : `${succeeded}장의 이미지가 생성되었어요`}
        </h3>
        {!allFailed && failed > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            · 실패 {failed}
          </span>
        )}
      </header>

      {succeeded > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {block.succeeded.map((img) => {
            const isPending = pendingId === img.imageId;
            return (
              <div
                key={img.imageId}
                className="group relative overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow hover:border-primary/60 hover:shadow-md"
              >
                <Link
                  href={`/image/${img.imageId}`}
                  className="relative block bg-muted"
                  style={aspectStyle}
                >
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
                </Link>
                <button
                  type="button"
                  onClick={() => handleDownload(img.imageId)}
                  disabled={isPending}
                  aria-label="이미지 다운로드"
                  title="이미지 다운로드"
                  className={cn(
                    'absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background',
                    isPending && 'cursor-wait opacity-60',
                  )}
                >
                  {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {failed > 0 && (
        <p className="text-xs text-muted-foreground">
          {failed}장은 실패해 크레딧이 자동 환불됐어요.
          {succeeded === 0 && ' 프롬프트를 다시 정리해 새 생성을 시작해보세요.'}
        </p>
      )}
    </section>
  );
}
