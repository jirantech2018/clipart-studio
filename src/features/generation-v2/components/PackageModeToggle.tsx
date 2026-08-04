'use client';

// "테마별(목적별) 패키지 생성" 토글.
//
// shadcn Switch 컴포넌트가 프로젝트에 없어서 label + hidden checkbox + track
// 조합으로 최소 구현. 크기와 색은 primary token 기준.

import { cn } from '@/lib/utils';

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export function PackageModeToggle({
  checked,
  onChange,
  disabled = false,
  label = '테마별(목적별) 패키지 생성',
}: Props) {
  return (
    <label
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 text-xs font-medium select-none',
        checked ? 'text-primary' : 'text-muted-foreground',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
    </label>
  );
}
