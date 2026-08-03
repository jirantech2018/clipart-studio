'use client';

// STEP 2 — 생성 옵션.
//   - 생성 개수 (프리셋 + 직접 입력, 최대 CONVERSATION_MAX_BATCH)
//   - 이미지 비율 (square / landscape / portrait)
//   - 학교 설정 적용 (요약 노출; 참조 이미지 picker 는 이번 커밋에서 스코프 외)
//   - "이미지 만들기" primary CTA — locked 이면 disabled
// Read-only 모드: 모든 입력이 disabled + 버튼 사라짐.

import { Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  CONVERSATION_BATCH_PRESETS,
  CONVERSATION_MAX_BATCH,
  CONVERSATION_MIN_BATCH,
} from '@/features/generation-v2/config';
import { cn } from '@/lib/utils';
import { ASPECT_RATIOS, ASPECT_RATIO_DIMENSIONS, ASPECT_RATIO_LABELS } from '@/types/domain';

import type { BlockOptions } from '@/lib/store/conversationStore';
import type { AspectRatio } from '@/types/domain';

interface OptionStepProps {
  options: BlockOptions;
  locked: boolean;
  submitting: boolean;
  insufficient: boolean;
  onChange: (patch: Partial<BlockOptions>) => void;
  onSubmit: () => void;
}

export function OptionStep({
  options,
  locked,
  submitting,
  insufficient,
  onChange,
  onSubmit,
}: OptionStepProps) {
  const disabled = locked || submitting;

  return (
    <section className="space-y-4 rounded-md border bg-muted/20 p-4">
      <header className="flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          2
        </span>
        <h3 className="text-base font-semibold">생성 옵션</h3>
      </header>

      {/* 생성 개수 */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label>생성 개수</Label>
          <span className="text-sm tabular-nums text-muted-foreground">
            <span className="font-semibold text-foreground">{options.batchSize}</span>{' '}
            크레딧 사용
          </span>
        </div>
        <div className="grid grid-cols-[repeat(3,1fr)_1.6fr] gap-1.5">
          {CONVERSATION_BATCH_PRESETS.map((size) => (
            <button
              key={size}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ batchSize: size })}
              className={cn(
                'h-9 rounded-md border text-sm font-medium transition-colors',
                options.batchSize === size
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background hover:bg-accent',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              {size}장
            </button>
          ))}
          <div className="relative">
            <input
              type="number"
              inputMode="numeric"
              min={CONVERSATION_MIN_BATCH}
              max={CONVERSATION_MAX_BATCH}
              step={1}
              value={options.batchSize}
              disabled={disabled}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') {
                  onChange({ batchSize: CONVERSATION_MIN_BATCH });
                  return;
                }
                const parsed = Number.parseInt(raw, 10);
                if (Number.isNaN(parsed)) return;
                onChange({
                  batchSize: Math.min(
                    CONVERSATION_MAX_BATCH,
                    Math.max(CONVERSATION_MIN_BATCH, parsed),
                  ),
                });
              }}
              className={cn(
                'h-9 w-full rounded-md border border-input bg-background px-3 pr-12 text-center text-sm font-medium',
                '[appearance:textfield]',
                '[&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none',
                '[&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none',
                'focus:outline-none focus:ring-2 focus:ring-primary/40',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            />
            <span
              className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm text-muted-foreground/60"
              aria-hidden="true"
            >
              ~{CONVERSATION_MAX_BATCH}장
            </span>
          </div>
        </div>
      </div>

      {/* 이미지 비율 */}
      <div className="space-y-2">
        <Label>이미지 비율</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {ASPECT_RATIOS.map((r) => {
            const dims = ASPECT_RATIO_DIMENSIONS[r];
            const previewRatio = `${dims.width} / ${dims.height}`;
            const active = options.aspectRatio === r;
            return (
              <button
                key={r}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ aspectRatio: r as AspectRatio })}
                aria-pressed={active}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-md border py-2 text-sm font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-input bg-background text-muted-foreground hover:bg-accent',
                  disabled && 'cursor-not-allowed opacity-60',
                )}
              >
                <span
                  className={cn(
                    'w-6 rounded-sm border',
                    active ? 'border-primary bg-primary/30' : 'border-current',
                  )}
                  style={{ aspectRatio: previewRatio }}
                  aria-hidden="true"
                />
                <span>{ASPECT_RATIO_LABELS[r]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 학교 설정 요약 — 참조 이미지 picker 는 다음 phase */}
      {options.orgSlug && (
        <div className="rounded-md border bg-background p-3 text-sm">
          <div className="font-medium">학교 설정 적용</div>
          <div className="mt-0.5 text-muted-foreground">
            조직 컨텍스트({options.orgSlug}) 의 기본 프롬프트 · 참조 이미지가 자동
            적용됩니다.
          </div>
        </div>
      )}

      {/* 생성 CTA */}
      {!locked && (
        <div className="flex items-center justify-end pt-1">
          <Button
            type="button"
            onClick={onSubmit}
            disabled={submitting || insufficient}
            className="min-w-[10rem]"
          >
            <Sparkles className="mr-1 h-4 w-4" />
            {submitting
              ? '요청 중…'
              : insufficient
                ? '크레딧 부족'
                : '이미지 만들기'}
          </Button>
        </div>
      )}
    </section>
  );
}
