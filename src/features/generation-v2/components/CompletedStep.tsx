'use client';

// STEP 4 — 생성 완료 (AI 응답).
//
// Conversation 답변 성격의 카드. 헤더는 시안 톤 "N장의 이미지가 생성되었어요"
// + 완료/실패 탭. 이미지 그리드는 등장 시 fade-in, hover 시 살짝 강조.
// 다운로드는 라이브러리와 동일한 downloadImageFile 유틸을 그대로 재사용.

import { AlertTriangle, CheckCircle2, Download, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { AIGeneratedBadge } from '@/components/ui/AIGeneratedBadge';
import { downloadImageFile } from '@/features/library/hooks/useMyImages';
import { cn } from '@/lib/utils';
import { ASPECT_RATIO_DIMENSIONS } from '@/types/domain';

import type { Block } from '@/lib/store/conversationStore';

type Tab = 'done' | 'failed';

interface CompletedStepProps {
  block: Block;
}

export function CompletedStep({ block }: CompletedStepProps) {
  const succeeded = block.succeeded.length;
  const failed = block.failed.length;
  const dims = ASPECT_RATIO_DIMENSIONS[block.options.aspectRatio];
  const aspectStyle = { aspectRatio: `${dims.width} / ${dims.height}` };
  const [pendingId, setPendingId] = useState<string | null>(null);
  // 실패만 있으면 기본 탭을 failed 로, 그 외엔 done 으로.
  const [tab, setTab] = useState<Tab>(succeeded > 0 ? 'done' : 'failed');

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
        'space-y-3 rounded-xl border p-5',
        allFailed
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-primary/40 bg-primary/5',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
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
        </div>
        <div
          role="tablist"
          aria-label="완료 결과 필터"
          className="flex items-center gap-1"
        >
          <TabButton
            active={tab === 'done'}
            onClick={() => setTab('done')}
            label="완료"
            count={succeeded}
          />
          <TabButton
            active={tab === 'failed'}
            onClick={() => setTab('failed')}
            label="실패"
            count={failed}
          />
        </div>
      </header>

      {tab === 'done' && succeeded > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {block.succeeded.map((img, idx) => {
            const isPending = pendingId === img.imageId;
            return (
              <div
                key={img.imageId}
                className="group relative overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow duration-200 hover:border-primary/60 hover:shadow-md animate-fade-in-up"
                style={{ animationDelay: `${idx * 40}ms` }}
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
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
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
                    'absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-background/95 text-primary shadow-sm backdrop-blur transition-all duration-200 hover:scale-105 hover:bg-background',
                    isPending && 'cursor-wait opacity-60 hover:scale-100',
                  )}
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'done' && succeeded === 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">
          완료된 이미지가 없어요.
        </p>
      )}

      {tab === 'failed' && (
        <div className="space-y-1 rounded-md bg-background/60 p-3 text-xs">
          {failed === 0 ? (
            <p className="text-muted-foreground">실패한 이미지가 없어요.</p>
          ) : (
            <>
              <p className="text-muted-foreground">
                {failed}장은 실패해 크레딧이 자동 환불됐어요.
                {succeeded === 0 && ' 프롬프트를 다시 정리해 새 생성을 시작해보세요.'}
              </p>
              <ul className="space-y-0.5 text-muted-foreground/80">
                {block.failed.map((f) => (
                  <li key={f.order} className="tabular-nums">
                    · #{f.order + 1} — {f.error}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">({count})</span>
    </button>
  );
}
