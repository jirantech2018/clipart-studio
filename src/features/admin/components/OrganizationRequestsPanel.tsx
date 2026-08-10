'use client';

// Plan M4: Super Admin 조직 개설 신청 관리 패널.
//
// - 상태 필터 탭 (전체 · 신청 완료 · 검토 중 · 승인 · 거절)
// - 각 행에 신청자 · 조직명 · slug · 신청일 · 현재 상태
// - 행 클릭 → 상세 모달에서 [검토 시작] [승인] [거절 (사유)] 액션

import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  useAdminOrganizationRequests,
  useApproveRequest,
  useRejectRequest,
  useStartReviewRequest,
  type AdminRequestFilter,
} from '@/features/admin/hooks/useAdminOrganizationRequests';
import { cn } from '@/lib/utils';

import type { OrganizationRequest, OrganizationRequestStatus } from '@/types/domain';

const STATUS_LABEL: Record<OrganizationRequestStatus, string> = {
  SUBMITTED: '신청 완료',
  REVIEWING: '검토 중',
  APPROVED: '승인',
  REJECTED: '거절',
};

const STATUS_BADGE: Record<OrganizationRequestStatus, string> = {
  SUBMITTED: 'bg-sky-100 text-sky-700',
  REVIEWING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-destructive/10 text-destructive',
};

const TABS: { key: AdminRequestFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'SUBMITTED', label: '신청 완료' },
  { key: 'REVIEWING', label: '검토 중' },
  { key: 'APPROVED', label: '승인' },
  { key: 'REJECTED', label: '거절' },
];

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

export function OrganizationRequestsPanel() {
  const [tab, setTab] = useState<AdminRequestFilter>('all');
  const [detail, setDetail] = useState<OrganizationRequest | null>(null);
  const { data, isLoading, isError, refetch, isFetching } = useAdminOrganizationRequests(tab);
  const requests = data?.requests ?? [];

  const counts = useMemo(() => {
    const c: Record<OrganizationRequestStatus, number> = {
      SUBMITTED: 0,
      REVIEWING: 0,
      APPROVED: 0,
      REJECTED: 0,
    };
    if (tab !== 'all') return c;
    for (const r of requests) c[r.status] += 1;
    return c;
  }, [requests, tab]);

  return (
    <div className="space-y-4">
      {/* 상단 요약 (all 탭에서만 breakdown 표시) */}
      {tab === 'all' && (
        <div className="grid gap-2 sm:grid-cols-4">
          <SummaryCard label="신청 완료" value={counts.SUBMITTED} badge={STATUS_BADGE.SUBMITTED} />
          <SummaryCard label="검토 중" value={counts.REVIEWING} badge={STATUS_BADGE.REVIEWING} />
          <SummaryCard label="승인" value={counts.APPROVED} badge={STATUS_BADGE.APPROVED} />
          <SummaryCard label="거절" value={counts.REJECTED} badge={STATUS_BADGE.REJECTED} />
        </div>
      )}

      {/* 탭 + 새로고침 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b">
        <div role="tablist" className="flex flex-wrap gap-1">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={cn(
                  '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
                  active
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="mb-1 h-8 rounded-md border border-input bg-background px-3 text-xs hover:bg-accent disabled:opacity-50"
        >
          {isFetching ? '새로고침…' : '새로고침'}
        </button>
      </div>

      {/* 테이블 */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              <th className="px-3 py-2 text-xs font-medium">조직명</th>
              <th className="px-3 py-2 text-xs font-medium">신청자</th>
              <th className="px-3 py-2 text-xs font-medium">신청일</th>
              <th className="px-3 py-2 text-xs font-medium">상태</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-muted-foreground">
                  불러오는 중…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-destructive">
                  불러오지 못했어요.
                </td>
              </tr>
            ) : requests.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-muted-foreground">
                  결과가 없어요.
                </td>
              </tr>
            ) : (
              requests.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setDetail(r)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setDetail(r);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${r.organizationName} 신청 상세`}
                  className="cursor-pointer border-t transition-colors hover:bg-muted/30 focus:bg-muted/40 focus:outline-none"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.organizationName}</div>
                    <div className="text-xs text-muted-foreground">/{r.desiredSlug}</div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.applicantEmail ?? r.applicantUserId.slice(0, 8) + '…'}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {formatDateTime(r.submittedAt)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium',
                        STATUS_BADGE[r.status],
                      )}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <RequestDetailModal
        req={detail}
        onClose={() => setDetail(null)}
        onMutated={() => {
          void refetch();
        }}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  badge,
}: {
  label: string;
  value: number;
  badge: string;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-medium', badge)}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {value.toLocaleString('ko-KR')}
      </div>
    </div>
  );
}

function RequestDetailModal({
  req,
  onClose,
  onMutated,
}: {
  req: OrganizationRequest | null;
  onClose: () => void;
  onMutated: () => void;
}) {
  const startReview = useStartReviewRequest();
  const approve = useApproveRequest();
  const reject = useRejectRequest();
  const [rejectReason, setRejectReason] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);

  if (!req) return null;

  const canStartReview = req.status === 'SUBMITTED';
  const canApprove = req.status === 'SUBMITTED' || req.status === 'REVIEWING';
  const canReject = req.status === 'SUBMITTED' || req.status === 'REVIEWING';

  async function handleStartReview() {
    if (!req) return;
    try {
      await startReview.mutateAsync(req.id);
      toast.success('검토를 시작했어요');
      onMutated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '실패');
    }
  }

  async function handleApprove() {
    if (!req) return;
    if (!window.confirm(`"${req.organizationName}" 을(를) 승인합니다. 실제 워크스페이스가 생성돼요.`))
      return;
    try {
      await approve.mutateAsync(req.id);
      toast.success('승인 완료. 워크스페이스가 생성됐어요');
      onMutated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '승인 실패');
    }
  }

  async function handleReject() {
    if (!req) return;
    if (!rejectReason.trim()) {
      toast.error('거절 사유는 필수예요');
      return;
    }
    try {
      await reject.mutateAsync({ id: req.id, reason: rejectReason.trim() });
      toast.success('거절 처리했어요');
      onMutated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '거절 실패');
    }
  }

  const pending = startReview.isPending || approve.isPending || reject.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-lg border bg-background shadow-lg">
        <div className="border-b px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-semibold">{req.organizationName}</h2>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[11px] font-medium',
                    STATUS_BADGE[req.status],
                  )}
                >
                  {STATUS_LABEL[req.status]}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                /{req.desiredSlug} ·{' '}
                {req.applicantEmail ?? `user ${req.applicantUserId.slice(0, 8)}…`}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto p-4 text-sm">
          <Field label="신청일">{formatDateTime(req.submittedAt)}</Field>
          {req.reviewStartedAt && <Field label="검토 시작">{formatDateTime(req.reviewStartedAt)}</Field>}
          {req.reviewedAt && (
            <Field label={req.status === 'APPROVED' ? '승인일' : '결정일'}>
              {formatDateTime(req.reviewedAt)}{' '}
              {req.reviewerEmail && (
                <span className="text-xs text-muted-foreground">by {req.reviewerEmail}</span>
              )}
            </Field>
          )}
          <Field label="소개">
            <p className="whitespace-pre-wrap text-muted-foreground">
              {req.description || '(입력 안 함)'}
            </p>
          </Field>
          <Field label="홈페이지">
            {req.homepageUrl ? (
              <a
                href={req.homepageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                {req.homepageUrl}
              </a>
            ) : (
              <span className="text-muted-foreground">(입력 안 함)</span>
            )}
          </Field>
          {req.status === 'REJECTED' && req.rejectionReason && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
              <div className="mb-1 font-medium text-destructive">거절 사유</div>
              <p className="whitespace-pre-wrap text-foreground/80">{req.rejectionReason}</p>
            </div>
          )}
          {req.status === 'APPROVED' && req.approvedOrganizationId && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
              승인 완료 — /organization/{req.desiredSlug} 에서 워크스페이스를 확인할 수 있어요.
            </div>
          )}

          {rejectOpen && canReject && (
            <div className="space-y-2 rounded-md border p-3">
              <label className="block text-xs font-medium">거절 사유 (필수)</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="신청자에게 노출됩니다."
                className="w-full rounded-md border border-input bg-background p-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectOpen(false)}
                  className="h-8 rounded-md border border-input bg-background px-3 text-xs hover:bg-accent"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={pending}
                  className="h-8 rounded-md bg-destructive px-3 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                >
                  거절 확정
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
          {canStartReview && (
            <button
              type="button"
              onClick={handleStartReview}
              disabled={pending}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent disabled:opacity-50"
            >
              검토 시작
            </button>
          )}
          {canReject && !rejectOpen && (
            <button
              type="button"
              onClick={() => setRejectOpen(true)}
              disabled={pending}
              className="h-9 rounded-md border border-destructive/30 bg-background px-3 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              거절
            </button>
          )}
          {canApprove && (
            <button
              type="button"
              onClick={handleApprove}
              disabled={pending}
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              승인
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
