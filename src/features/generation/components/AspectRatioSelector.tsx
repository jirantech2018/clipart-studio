'use client';

// Controlled AspectRatio selector — /generate 와 /generate-v2 가 공유.
// Store 미참조. Props 만으로 동작.
// variant 는 이번 커밋에서는 default 만 시각 유의미 (compact 는 API 만 열어둠).

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

export function AspectRatioSelector({
  value,
  onChange,
  disabled = false,
}: AspectRatioSelectorProps) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {ASPECT_RATIOS.map((r) => {
        const dims = ASPECT_RATIO_DIMENSIONS[r];
        const previewRatio = `${dims.width} / ${dims.height}`;
        const active = value === r;
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
