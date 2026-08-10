'use client';

// Plan v0.2.9 §M4-1: 조직 목록 행 안 인라인 지급/회수 폼.
//
// - 수량 input 하나 + [지급] · [회수] 두 버튼
// - 지급 = allocate_tokens (ISSUE, from=NULL)
// - 회수 = adjust_tokens (delta = -amount)
// - 사유(memo) 는 인라인이라 별도 입력 X. 감사 로그에는 default memo 로
//   `"인라인 지급"` / `"인라인 회수"` 가 남고, 실행자 email 은 Ledger.actor_id
//   에 자동 기록됨. 상세 사유가 필요하면 팝업 히스토리 → 향후 별도 상세 화면
//   에서 대체 폼 사용.
// - 부모 tr 이 클릭 이벤트로 히스토리 팝업을 열기 때문에, 이 폼의 모든
//   interactive element 는 `e.stopPropagation()` 로 버블링을 막는다.

import { useState } from 'react';
import { toast } from 'sonner';

import {
  useAdjustTokens,
  useAllocateTokens,
} from '@/features/admin/hooks/useTokenDashboard';

export function InlineCreditForm({
  organizationId,
  displayName,
  currentBalance,
  onMutated,
}: {
  organizationId: string;
  displayName: string;
  currentBalance: number;
  onMutated: () => void;
}) {
  const [amount, setAmount] = useState('');
  const allocate = useAllocateTokens();
  const adjust = useAdjustTokens();

  const pending = allocate.isPending || adjust.isPending;

  function parseAmount(): number | null {
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0) {
      toast.error('수량은 양의 정수여야 해요');
      return null;
    }
    return n;
  }

  async function handleAllocate() {
    const n = parseAmount();
    if (n === null) return;
    try {
      const res = await allocate.mutateAsync({
        organizationId,
        amount: n,
        memo: `인라인 지급 (${displayName})`,
      });
      toast.success(`${n} 크레딧 지급 · 잔액 ${res.balance.toLocaleString('ko-KR')}`);
      setAmount('');
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '지급 실패');
    }
  }

  async function handleClawBack() {
    const n = parseAmount();
    if (n === null) return;
    if (n > currentBalance) {
      toast.error(`회수량이 잔액을 초과해요 (잔액 ${currentBalance})`);
      return;
    }
    try {
      const res = await adjust.mutateAsync({
        organizationId,
        delta: -n,
        memo: `인라인 회수 (${displayName})`,
      });
      toast.success(`${n} 크레딧 회수 · 잔액 ${res.balance.toLocaleString('ko-KR')}`);
      setAmount('');
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '회수 실패');
    }
  }

  // 부모 tr 의 클릭·keydown 이벤트가 히스토리 팝업을 열기 때문에, 이 폼 안
  // 모든 이벤트는 stopPropagation 으로 버블링을 막는다.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className="flex items-center justify-end gap-1"
      onClick={stop}
      onKeyDown={stop}
    >
      <input
        type="number"
        min={1}
        inputMode="numeric"
        value={amount}
        onChange={(e) => {
          e.stopPropagation();
          setAmount(e.target.value);
        }}
        onClick={stop}
        placeholder="수량"
        aria-label={`${displayName} 지급/회수 수량`}
        className="h-8 w-20 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums outline-none focus:ring-1 focus:ring-ring"
        disabled={pending}
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void handleAllocate();
        }}
        disabled={pending}
        className="h-8 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        지급
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void handleClawBack();
        }}
        disabled={pending}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium hover:bg-accent disabled:opacity-50"
      >
        회수
      </button>
    </div>
  );
}
