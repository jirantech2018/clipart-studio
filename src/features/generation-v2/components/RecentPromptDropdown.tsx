'use client';

// v2 전용 "최근 사용" Prompt Dropdown.
//
// - 현재 활성 Draft 상태에서만 조작 가능. disabled 시 버튼 자체는 노출하되
//   opacity 로 시각적 잠금 (전체 카드 오버레이 금지).
// - 비어 있으면 목록 자리에 "최근 사용한 프롬프트가 없습니다" 를 노출.
// - 항목은 한 줄 truncate + 원본 title. 여러 줄 프롬프트도 첫 줄만 시각적으로
//   드러난다. Prompt 원본은 그대로 전달.
// - 현재 Prompt 가 비어 있으면 즉시 적용, 내용이 있으면 window.confirm 후 교체.
// - Radix DropdownMenu 를 프로젝트가 채용하지 않아 자체 outside-click / Escape
//   처리로 최소 구현. 접근성: aria-haspopup="listbox" + role="listbox".

import { ChevronDown, History } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface RecentPromptDropdownProps {
  prompts: readonly string[];
  currentPrompt: string;
  disabled?: boolean;
  onSelect: (prompt: string) => void;
}

export function RecentPromptDropdown({
  prompts,
  currentPrompt,
  disabled = false,
  onSelect,
}: RecentPromptDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointer(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  function handleSelect(prompt: string) {
    setOpen(false);
    if (currentPrompt.trim().length === 0) {
      onSelect(prompt);
      return;
    }
    const ok = window.confirm('현재 작성 중인 내용을 최근 프롬프트로 바꾸시겠습니까?');
    if (ok) onSelect(prompt);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'inline-flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          disabled && 'cursor-not-allowed opacity-50 hover:bg-background hover:text-muted-foreground',
        )}
      >
        <History className="h-3.5 w-3.5" aria-hidden="true" />
        <span>최근 사용</span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-20 mt-1 w-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          {prompts.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              최근 사용한 프롬프트가 없습니다.
            </div>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {prompts.map((p, i) => (
                <li key={`${i}-${p.slice(0, 40)}`}>
                  <button
                    type="button"
                    onClick={() => handleSelect(p)}
                    title={p}
                    className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    {p}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
