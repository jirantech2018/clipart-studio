'use client';

// Design Ref: §5.4 Generation Page — 🏫 학교 스타일 적용 토글 (School Profile 등록자만 렌더)
// Non-Negotiable Rule 5 (CLAUDE.md): 미보유자는 토글 UI 자체가 렌더링되지 않아야 함

import { School } from 'lucide-react';

interface SchoolStyleToggleProps {
  hasSchoolProfile: boolean;
  schoolName?: string | null;
  checked: boolean;
  onChange: (next: boolean) => void;
}

export function SchoolStyleToggle({
  hasSchoolProfile,
  schoolName,
  checked,
  onChange,
}: SchoolStyleToggleProps) {
  if (!hasSchoolProfile) return null;

  return (
    <label className="flex cursor-pointer items-center justify-between rounded-md border border-input bg-background p-3 hover:bg-accent/40">
      <span className="flex items-center gap-2 text-sm font-medium">
        <School className="h-4 w-4" aria-hidden="true" />
        학교설정 적용
        {schoolName && (
          <span className="text-xs font-normal text-muted-foreground">({schoolName})</span>
        )}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-8 cursor-pointer appearance-none rounded-full bg-muted transition-colors checked:bg-primary relative
          before:absolute before:left-0.5 before:top-0.5 before:h-3 before:w-3 before:rounded-full before:bg-background before:transition-transform
          checked:before:translate-x-4"
      />
    </label>
  );
}
