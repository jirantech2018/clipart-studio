'use client';

// 가벼운 자체 구현 Dialog (Radix 미도입). 클릭 오버레이 / Escape / body scroll
// lock 을 지원. dismissable=false 로 넘기면 두 액션(오버레이/Escape) 모두 차단.

import { useEffect } from 'react';

import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** false 로 두면 오버레이 클릭·Escape 로 닫히지 않는다 (취소 처리 중 팝업). */
  dismissable?: boolean;
  /** 최대 폭. 기본 max-w-lg. */
  className?: string;
  children: React.ReactNode;
}

export function Dialog({
  open,
  onClose,
  dismissable = true,
  className,
  children,
}: DialogProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && dismissable) onClose();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, dismissable, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={dismissable ? onClose : undefined}
      aria-hidden="false"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full max-w-lg overflow-hidden rounded-lg bg-background text-foreground shadow-xl [text-shadow:none]',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="space-y-1 border-b px-5 py-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

export function DialogBody({ children }: { children: React.ReactNode }) {
  return <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>;
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end gap-2 border-t bg-muted/30 px-5 py-3">
      {children}
    </div>
  );
}
