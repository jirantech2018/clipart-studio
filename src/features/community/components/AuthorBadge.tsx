'use client';

// Design Ref: §5.4 AuthorBadge — 🏫 학교 계정 / 🎒 학생 / 👤 일반·선생님
// Uses ACCOUNT_TYPE_BADGE map from domain (single source of truth).

import { ACCOUNT_TYPE_BADGE, ACCOUNT_TYPE_LABELS } from '@/types/domain';
import { cn } from '@/lib/utils';

import type { AccountType } from '@/types/domain';

interface AuthorBadgeProps {
  authorType: AccountType;
  authorSchoolName?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}

export function AuthorBadge({
  authorType,
  authorSchoolName,
  size = 'sm',
  className,
}: AuthorBadgeProps) {
  const icon = ACCOUNT_TYPE_BADGE[authorType];
  const label = authorSchoolName ?? ACCOUNT_TYPE_LABELS[authorType];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-secondary text-secondary-foreground',
        size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[10px]',
        className,
      )}
      title={label}
    >
      <span aria-hidden="true">{icon}</span>
      <span className="max-w-[8rem] truncate">{label}</span>
    </span>
  );
}
