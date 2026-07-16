'use client';

// 이미지 카드 좌상단에 얹는 체크박스. Radix 대신 button 기반 커스텀 —
// 의존성 추가를 피하고, hover / focus / selected 상태의 시각적 대비에만 집중.

import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

interface Props {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function SelectionCheckbox({
  checked,
  onCheckedChange,
  disabled,
  className,
  ariaLabel,
}: Props) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel ?? '선택'}
      onClick={(e) => {
        // 부모 Link 로 이벤트가 버블링되어 상세 페이지 이동을 유발하지 않도록 차단.
        e.preventDefault();
        e.stopPropagation();
        onCheckedChange(!checked);
      }}
      disabled={disabled}
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-white bg-black/40 text-white shadow-md backdrop-blur-sm transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        checked && 'border-primary bg-primary text-primary-foreground',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {checked && <Check className="h-4 w-4" strokeWidth={3} />}
    </button>
  );
}
