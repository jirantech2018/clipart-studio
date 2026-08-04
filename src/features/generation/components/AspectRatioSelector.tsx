'use client';

// Controlled AspectRatio selector — /generate 와 /generate-v2 가 공유.
// Store 미참조. Props 만으로 동작.
//
// variant:
//   default : /generate 원본 톤 (세로 스택, 아이콘 위 · 라벨 밑)
//   compact : v2 Option Panel 톤. 좌측 아이콘 + 우측 세로 2줄 (이름 / 비율)

import { cn } from '@/lib/utils';
import {
  ASPECT_RATIOS,
  ASPECT_RATIO_DIMENSIONS,
  ASPECT_RATIO_LABELS,
} from '@/types/domain';

import type { AspectRatio } from '@/types/domain';

interface AspectRatioSelectorProps {
  value: AspectRatio;
  onChange: (next: AspectRatio) => void;
  disabled?: boolean;
  variant?: 'default' | 'compact';
}

// compact variant 우측 하단에 보여줄 축약 비율 표기.
// 실제 dims (1024x1024 등) 와 별개로 사용자가 인지하기 쉬운 표기 사용.
const COMPACT_RATIO_LABEL: Record<AspectRatio, string> = {
  square: '1:1',
  landscape: '16:9',
  portrait: '9:16',
};

export function AspectRatioSelector({
  value,
  onChange,
  disabled = false,
  variant = 'default',
}: AspectRatioSelectorProps) {
  const compact = variant === 'compact';
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {ASPECT_RATIOS.map((r) => {
        const dims = ASPECT_RATIO_DIMENSIONS[r];
        const previewRatio = `${dims.width} / ${dims.height}`;
        const active = value === r;

        if (compact) {
          return (
            <button
              key={r}
              type="button"
              disabled={disabled}
              onClick={() => onChange(r)}
              aria-pressed={active}
              className={cn(
                'flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs font-medium transition-colors',
                active
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-input bg-background text-muted-foreground hover:bg-accent',
                disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              <span
                className={cn(
                  'w-5 shrink-0 rounded-sm border',
                  active
                    ? 'border-primary bg-primary/30'
                    : 'border-current bg-current/20',
                )}
                style={{ aspectRatio: previewRatio }}
                aria-hidden="true"
              />
              <span className="flex min-w-0 flex-col leading-tight">
                <span>{ASPECT_RATIO_LABELS[r]}</span>
                <span
                  className={cn(
                    'text-[11px] tabular-nums',
                    active ? 'text-primary/70' : 'text-muted-foreground/80',
                  )}
                >
                  {COMPACT_RATIO_LABEL[r]}
                </span>
              </span>
            </button>
          );
        }

        return (
          <button
            key={r}
            type="button"
            disabled={disabled}
            onClick={() => onChange(r)}
            aria-pressed={active}
            className={cn(
              'flex flex-col items-center gap-1 rounded-md border py-2 text-xs font-medium transition-colors',
              active
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-input bg-background text-muted-foreground hover:bg-accent',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <span
              className={cn(
                'w-6 rounded-sm border',
                active
                  ? 'border-primary bg-primary/30'
                  : 'border-current bg-current/20',
              )}
              style={{ aspectRatio: previewRatio }}
              aria-hidden="true"
            />
            <span>{ASPECT_RATIO_LABELS[r]}</span>
          </button>
        );
      })}
    </div>
  );
}
