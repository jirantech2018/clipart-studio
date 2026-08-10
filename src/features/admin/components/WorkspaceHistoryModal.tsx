'use client';

// Plan v0.2.9 §M4-1: 조직 행 클릭 시 열리는 "전체 히스토리" 팝업.
//
// - 지급·조정 UI 는 이제 목록 인라인 폼에서 처리하므로 여기서는 제거.
// - 이 모달은 Ledger 이력만 표시 (읽기 전용).
// - Ledger API 응답을 그대로 사용 (최근 50건). 향후 pagination 필요 시 확장.

import { useEffect } from 'react';

import type { AdminWorkspace } from '@/features/admin/hooks/useTokenDashboard';
import { useOrgLedger } from '@/features/admin/hooks/useTokenDashboard';

const TYPE_LABEL: Record<AdminWorkspace['type'], string> = {
  personal: '개인 (MY)',
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

const LEDGER_TYPE_BADGE: Record<string, string> = {
  ISSUE: 'bg-emerald-100 text-emerald-700',
  TRANSFER: 'bg-indigo-100 text-indigo-700',
  USE: 'bg-slate-100 text-slate-700',
  REFUND: 'bg-amber-100 text-amber-700',
  ADJUST: 'bg-purple-100 text-purple-700',
  MIGRATION: 'bg-neutral-100 text-neutral-700',
};

function displayWorkspaceName(w: AdminWorkspace): string {
  return w.type === 'personal' ? '내 작업실' : w.name;
}

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

export function WorkspaceHistoryModal({
  workspace,
  onClose,
}: {
  workspace: AdminWorkspace | null;
  onClose: () => void;
}) {
  const ledger = useOrgLedger(workspace?.id ?? null, !!workspace);

  useEffect(() => {
    if (!workspace) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [workspace?.id, onClose]);

  if (!workspace) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-history-title"
    >
      <div className="w-full max-w-6xl overflow-hidden rounded-lg border bg-background shadow-lg">
        {/* Header */}
        <div className="border-b px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 id="workspace-history-title" className="truncate text-base font-semibold">
                  {displayWorkspaceName(workspace)}
                </h2>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium">
                  {TYPE_LABEL[workspace.type]}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {workspace.ownerEmail ?? '(owner email 없음)'} · 현재 크레딧{' '}
                <span className="tabular-nums font-medium text-foreground">
                  {workspace.credits.toLocaleString('ko-KR')}
                </span>
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
        </div>

        {/* Ledger 이력 */}
        <div className="max-h-[65vh] overflow-y-auto p-4">
          <div className="mb-2 text-xs text-muted-foreground">
            최근 50건. 발행·이동·사용·환불·조정·이관 모두 append-only.
          </div>
          {ledger.isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">불러오는 중…</p>
          ) : ledger.isError ? (
            <p className="py-6 text-center text-sm text-destructive">
              히스토리를 불러오지 못했어요.
            </p>
          ) : (ledger.data?.entries ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              아직 히스토리가 없어요.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-xs">
                <colgroup>
                  <col className="w-[140px]" />
                  <col className="w-[64px]" />
                  <col className="w-[80px]" />
                  <col className="w-[220px]" />
                  <col />
                </colgroup>
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-2 py-1 whitespace-nowrap">시각</th>
                    <th className="px-2 py-1 whitespace-nowrap">종류</th>
                    <th className="px-2 py-1 whitespace-nowrap text-right">amount</th>
                    <th className="px-2 py-1 whitespace-nowrap">actor</th>
                    <th className="px-2 py-1">memo</th>
                  </tr>
                </thead>
                <tbody>
                  {(ledger.data?.entries ?? []).map((e) => (
                    <tr key={e.id} className="border-t align-top">
                      <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                        {formatDateTime(e.createdAt)}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
                            LEDGER_TYPE_BADGE[e.type] ?? 'bg-secondary'
                          }`}
                        >
                          {LEDGER_TYPE_LABEL[e.type] ?? e.type}
                        </span>
                      </td>
                      <td
                        className={`px-2 py-1 whitespace-nowrap text-right tabular-nums font-medium ${
                          e.amount > 0 ? 'text-emerald-600' : 'text-destructive'
                        }`}
                      >
                        {e.amount > 0 ? `+${e.amount}` : e.amount}
                      </td>
                      <td className="px-2 py-1 truncate text-muted-foreground" title={e.actorEmail ?? ''}>
                        {e.actorEmail ?? '-'}
                      </td>
                      <td className="px-2 py-1">
                        <div className="break-words" title={e.memo ?? ''}>
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
