'use client';

// Design Ref: §5.3 CreditBadge — header credit balance display + reset countdown
// Plan SC: FR-12 credit UI, monthly reset messaging

import { Coins } from 'lucide-react';

const MONTHLY_RESET_AMOUNT = 30;

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const now = Date.now();
  const target = new Date(iso).getTime();
  const diff = target - now;
  if (diff <= 0) return 0;
  return Math.ceil(diff / (24 * 3_600_000));
}

function formatResetDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
  });
}

export function CreditBadge({
  credits,
  creditsResetAt,
}: {
  credits: number;
  creditsResetAt: string | null;
}) {
  const resetLabel = formatResetDate(creditsResetAt);
  const remainingDays = daysUntil(creditsResetAt);

  const title = resetLabel
    ? `다음 리셋: ${resetLabel} · +${MONTHLY_RESET_AMOUNT} 크레딧 지급`
    : '이번 달 크레딧';

  return (
    <div
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-sm font-medium"
    >
      <Coins className="h-4 w-4" aria-hidden="true" />
      <span className="tabular-nums">{credits}</span>
      {remainingDays !== null && remainingDays <= 7 && (
        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
          D-{remainingDays}
        </span>
      )}
    </div>
  );
}
