'use client';

// Package Job 전용 Generating 화면.
//
// 목표:
//   - 전체 진행률 (18 / 35 · 51%) 을 실제 Slot 상태 기준으로 표시
//   - Category 별 진행률 (완료 수 / 전체 수 · 진행률) 을 함께 표시
//   - Fake Progress / 예상 시간 없음
//
// 데이터 소스:
//   - Rehydrate 훅이 fetch 한 slotMetadata (진입 시점 slot 목록)
//   - store 의 block.succeeded / block.failed (SSE 실시간)
//   두 소스를 mergeSlotsWithBlockState 로 병합해 computePackageProgress
//   에 넘긴다. Single Job 은 이 컴포넌트를 사용하지 않는다.

import { Loader2 } from 'lucide-react';

import { computePackageProgress, mergeSlotsWithBlockState } from '@/features/generation-v2/lib/packageProgress';
import { packageCategoryLabel } from '@/features/generation-v2/lib/packagePlanTypes';
import { cn } from '@/lib/utils';

import type { PackageJobSlotResponse } from '@/features/generation-v2/lib/packageProgress';
import type { Block } from '@/lib/store/conversationStore';

interface Props {
  block: Block;
  slotMetadata: PackageJobSlotResponse[] | null;
}

export function PackageGeneratingStep({ block, slotMetadata }: Props) {
  // slotMetadata 가 아직 도착하지 않았다면 loading placeholder.
  if (!slotMetadata) {
    return (
      <section className="flex items-center gap-2 rounded-xl border bg-background p-5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
        <span>패키지 생성 정보를 불러오는 중…</span>
      </section>
    );
  }

  const merged = mergeSlotsWithBlockState(slotMetadata, block.succeeded, block.failed);
  const progress = computePackageProgress(merged);

  return (
    <section className="space-y-4 rounded-xl border bg-background p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
          <h3 className="text-base font-semibold">
            AI가 여러 종류의 이미지를 만들고 있어요
          </h3>
        </div>
        <div className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
          <span>
            <strong className="text-primary">{progress.completed}</strong>
            {' / '}
            <strong>{progress.total}</strong> 완료
          </span>
          <ProgressBar percent={progress.percent} width="w-32" />
          <span className="font-semibold text-primary">{progress.percent}%</span>
        </div>
      </header>

      <ul className="space-y-2.5">
        {progress.categories.map((cat) => (
          <li
            key={cat.category}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2"
          >
            <div className="min-w-[7rem] flex-shrink-0 text-sm font-semibold text-foreground">
              {packageCategoryLabel(cat.category)}
            </div>
            <div className="flex flex-1 items-center gap-3 text-xs tabular-nums text-muted-foreground">
              <span>
                <strong className={cn(cat.completed === cat.total ? 'text-primary' : 'text-foreground')}>
                  {cat.completed}
                </strong>
                {' / '}
                {cat.total}
              </span>
              <ProgressBar percent={cat.percent} width="flex-1 max-w-[16rem]" />
              <span className="w-8 text-right font-semibold text-primary">
                {cat.percent}%
              </span>
            </div>
          </li>
        ))}
      </ul>

      {progress.failed > 0 && (
        <p className="text-xs text-destructive">
          실패한 이미지 {progress.failed}장은 크레딧이 환불되었어요.
        </p>
      )}
    </section>
  );
}

function ProgressBar({ percent, width }: { percent: number; width: string }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn('h-1.5 overflow-hidden rounded-full bg-muted', width)}
    >
      <div
        className="h-full bg-primary transition-[width] duration-300 ease-out"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
