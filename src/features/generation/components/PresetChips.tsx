'use client';

// 프롬프트 변형 힌트 chip. hints 배열은 상위 (GenerationForm) 가 AI 추천 훅
// 결과로 채워서 넘긴다. 클릭 시 " · <hint>" 가 프롬프트 끝에 append/toggle 된다.

import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

const HINT_SEP = ' · ';

interface PresetChipsProps {
  hints: string[];
  loading?: boolean;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

function hasHint(prompt: string, hint: string): boolean {
  return prompt.includes(`${HINT_SEP}${hint}`) || prompt.endsWith(hint);
}

function toggleHint(prompt: string, hint: string): string {
  if (hasHint(prompt, hint)) {
    return prompt
      .replace(`${HINT_SEP}${hint}`, '')
      .replace(new RegExp(`\\s*${hint}$`), '')
      .trim();
  }
  const base = prompt.trim();
  return base ? `${base}${HINT_SEP}${hint}` : hint;
}

export function PresetChips({
  hints,
  loading,
  value,
  onChange,
  disabled,
}: PresetChipsProps) {
  if (loading && hints.length === 0) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            className="h-7 w-16 animate-pulse rounded-full bg-muted"
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {hints.map((hint) => {
        const active = hasHint(value, hint);
        return (
          <button
            key={hint}
            type="button"
            disabled={disabled}
            onClick={() => onChange(toggleHint(value, hint))}
            className={cn(
              'h-7 rounded-full border px-3 text-xs transition-colors',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-background hover:bg-accent',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {hint}
          </button>
        );
      })}
      {loading && hints.length > 0 && (
        <Loader2
          className="h-3 w-3 animate-spin text-muted-foreground"
          aria-label="추천 갱신 중"
        />
      )}
    </div>
  );
}
