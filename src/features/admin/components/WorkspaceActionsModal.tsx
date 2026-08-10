'use client';

// Plan v0.2.9 §M4-1: Workspace 관리 모달.
// 3개 탭: 지급 (ISSUE) · 조정 (ADJUST) · Ledger 이력

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { AdminWorkspace } from '@/features/admin/hooks/useTokenDashboard';
import {
  useAdjustTokens,
  useAllocateTokens,
  useOrgLedger,
} from '@/features/admin/hooks/useTokenDashboard';

type Tab = 'allocate' | 'adjust' | 'ledger';

const TYPE_LABEL: Record<AdminWorkspace['type'], string> = {
  personal: 'MY (개인)',
  school: '학교',
  general: '일반',
};

const LEDGER_TYPE_LABEL: Record<string, string> = {
  ISSUE: '발행',
  TRANSFER: '이동',
  USE: '사용',
  REFUND: '환불',
  ADJUST: '조정',
  MIGRATION: '이관',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function WorkspaceActionsModal({
  workspace,
  onClose,
  onMutated,
}: {
  workspace: AdminWorkspace | null;
  onClose: () => void;
  onMutated: () => void;
}) {
  const [tab, setTab] = useState<Tab>('allocate');
  const [amount, setAmount] = useState('');
  const [allocMemo, setAllocMemo] = useState('');
  const [delta, setDelta] = useState('');
  const [adjustMemo, setAdjustMemo] = useState('');

  const allocate = useAllocateTokens();
  const adjust = useAdjustTokens();
  const ledger = useOrgLedger(workspace?.id ?? null, !!workspace && tab === 'ledger');

  useEffect(() => {
    if (!workspace) return;
    setTab('allocate');
    setAmount('');
    setAllocMemo('');
    setDelta('');
    setAdjustMemo('');
  }, [workspace?.id]);

  useEffect(() => {
    if (!workspace) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [workspace?.id, onClose]);

  if (!workspace) return null;

  async function handleAllocate() {
    if (!workspace) return;
    const parsed = Number(amount);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      toast.error('지급 수량은 양의 정수여야 해요');
      return;
    }
    try {
      const res = await allocate.mutateAsync({
        organizationId: workspace.id,
        amount: parsed,
        memo: allocMemo.trim() || `admin allocate to ${workspace.name}`,
      });
      toast.success(`${parsed} 크레딧 지급 완료 · 잔액 ${res.balance}`);
      setAmount('');
      setAllocMemo('');
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '지급 실패');
    }
  }

  async function handleAdjust() {
    if (!workspace) return;
    const parsed = Number(delta);
    if (!Number.isInteger(parsed) || parsed === 0) {
      toast.error('조정값은 0 이 아닌 정수여야 해요');
      return;
    }
    if (!adjustMemo.trim()) {
      toast.error('조정 사유는 필수예요');
      return;
    }
    try {
      const res = await adjust.mutateAsync({
        organizationId: workspace.id,
        delta: parsed,
        memo: adjustMemo.trim(),
      });
      toast.success(`조정 완료 · 잔액 ${res.balance}`);
      setDelta('');
      setAdjustMemo('');
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '조정 실패');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-actions-title"
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-lg border bg-background shadow-lg">
        {/* Header */}
        <div className="border-b px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 id="workspace-actions-title" className="truncate text-base font-semibold">
                {workspace.name}
              </h2>
              <div className="mt-0.5 text-xs text-muted-foreground">
                /{workspace.slug} · {TYPE_LABEL[workspace.type]} ·
                {workspace.ownerEmail ? ` ${workspace.ownerEmail}` : ' (owner email 없음)'}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
            <MetricPill label="현재 크레딧" value={workspace.credits} />
            <MetricPill label="이번 달 사용" value={workspace.monthUsed} />
            <MetricPill label="누적 사용" value={workspace.totalUsed} />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b px-4 pt-2">
          <TabButton active={tab === 'allocate'} onClick={() => setTab('allocate')}>
            지급
          </TabButton>
          <TabButton active={tab === 'adjust'} onClick={() => setTab('adjust')}>
            조정
          </TabButton>
          <TabButton active={tab === 'ledger'} onClick={() => setTab('ledger')}>
            Ledger
          </TabButton>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-4">
          {tab === 'allocate' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                이 조직 pool 에 <strong>ISSUE</strong> (신규 발행) 을 수행합니다. Ledger 에 발행
                이력이 남습니다.
              </p>
              <Field label="지급 수량 (양의 정수)">
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="예: 50"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </Field>
              <Field label="사유 (감사 로그 memo)">
                <input
                  type="text"
                  maxLength={500}
                  value={allocMemo}
                  onChange={(e) => setAllocMemo(e.target.value)}
                  placeholder="예: 2026-08 정기 지급"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </Field>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleAllocate}
                  disabled={allocate.isPending}
                  className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {allocate.isPending ? '지급 중…' : '지급'}
                </button>
              </div>
            </div>
          )}

          {tab === 'adjust' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                수동 <strong>ADJUST</strong>. 음수 값으로 회수도 가능합니다. 잔액이 음수로 떨어지는
                조정은 서버에서 차단됩니다.
              </p>
              <Field label="조정값 (음수 = 회수, 예: -20)">
                <input
                  type="number"
                  inputMode="numeric"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                  placeholder="예: -20 또는 +10"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </Field>
              <Field label="사유 (필수, 감사 로그 memo)">
                <input
                  type="text"
                  maxLength={500}
                  value={adjustMemo}
                  onChange={(e) => setAdjustMemo(e.target.value)}
                  placeholder="예: 잘못 지급 회수"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </Field>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleAdjust}
                  disabled={adjust.isPending}
                  className="h-9 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  {adjust.isPending ? '조정 중…' : '조정'}
                </button>
              </div>
            </div>
          )}

          {tab === 'ledger' && (
            <div className="space-y-2">
              {ledger.isLoading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">불러오는 중…</p>
              ) : ledger.isError ? (
                <p className="py-6 text-center text-sm text-destructive">
                  Ledger 를 불러오지 못했어요.
                </p>
              ) : (ledger.data?.entries ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  아직 Ledger 이력이 없어요.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="px-2 py-1">시각</th>
                      <th className="px-2 py-1">종류</th>
                      <th className="px-2 py-1 text-right">amount</th>
                      <th className="px-2 py-1">actor</th>
                      <th className="px-2 py-1">memo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ledger.data?.entries ?? []).map((e) => (
                      <tr key={e.id} className="border-t align-top">
                        <td className="px-2 py-1 text-muted-foreground">
                          {formatDateTime(e.createdAt)}
                        </td>
                        <td className="px-2 py-1">
                          <span className="rounded-full bg-secondary px-1.5 py-0.5">
                            {LEDGER_TYPE_LABEL[e.type] ?? e.type}
                          </span>
                        </td>
                        <td
                          className={`px-2 py-1 text-right tabular-nums ${
                            e.amount > 0 ? 'text-emerald-600' : 'text-destructive'
                          }`}
                        >
                          {e.amount > 0 ? `+${e.amount}` : e.amount}
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {e.actorEmail ?? '-'}
                        </td>
                        <td className="px-2 py-1">
                          <div className="truncate" title={e.memo ?? ''}>
                            {e.memo ?? '-'}
                          </div>
                          {e.jobId && (
                            <div className="text-[10px] text-muted-foreground/70">
                              job: {e.jobId.slice(0, 8)}…
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-card px-2 py-1.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="tabular-nums font-semibold">{value.toLocaleString('ko-KR')}</div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        '-mb-px border-b-2 px-3 py-2 text-sm transition-colors ' +
        (active
          ? 'border-primary font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground')
      }
    >
      {children}
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <div className="text-xs font-medium text-foreground">{label}</div>
      {children}
    </label>
  );
}
