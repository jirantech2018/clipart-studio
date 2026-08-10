'use client';

// Plan v0.2.9 §M4-1: Super Admin Token Dashboard client component.
//
// - Workspace 목록 테이블 + 검색 + 정렬 (credits 기본 desc)
// - 각 행에서 [지급] [조정] [Ledger] 버튼 → 모달
// - 지급/조정 성공 시 dashboard refetch 로 잔액 즉시 반영
// - profiles.credits / token_pools.balance 직접 UPDATE 없음 (Credit Service 만)

import { useMemo, useState } from 'react';

import { WorkspaceActionsModal } from '@/features/admin/components/WorkspaceActionsModal';
import { useTokenDashboard } from '@/features/admin/hooks/useTokenDashboard';
import type { AdminWorkspace } from '@/features/admin/hooks/useTokenDashboard';

type SortKey = 'credits' | 'monthUsed' | 'totalUsed' | 'memberCount' | 'lastUsedAt' | 'name';
type SortDir = 'asc' | 'desc';

const TYPE_LABEL: Record<AdminWorkspace['type'], string> = {
  personal: 'MY',
  school: '학교',
  general: '일반',
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TokenDashboard() {
  const { data, isLoading, isError, refetch, isFetching } = useTokenDashboard();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('credits');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [modalTarget, setModalTarget] = useState<AdminWorkspace | null>(null);

  const workspaces = data?.workspaces ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? workspaces.filter(
          (w) =>
            w.name.toLowerCase().includes(q) ||
            w.slug.toLowerCase().includes(q) ||
            (w.ownerEmail ?? '').toLowerCase().includes(q),
        )
      : workspaces.slice();

    rows.sort((a, b) => {
      const sign = sortDir === 'asc' ? 1 : -1;
      let av: number | string = 0;
      let bv: number | string = 0;
      switch (sortKey) {
        case 'name':
          av = a.name;
          bv = b.name;
          break;
        case 'credits':
          av = a.credits;
          bv = b.credits;
          break;
        case 'monthUsed':
          av = a.monthUsed;
          bv = b.monthUsed;
          break;
        case 'totalUsed':
          av = a.totalUsed;
          bv = b.totalUsed;
          break;
        case 'memberCount':
          av = a.memberCount;
          bv = b.memberCount;
          break;
        case 'lastUsedAt':
          av = a.lastUsedAt ?? '';
          bv = b.lastUsedAt ?? '';
          break;
      }
      if (av < bv) return -1 * sign;
      if (av > bv) return 1 * sign;
      return 0;
    });
    return rows;
  }, [workspaces, query, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  }

  return (
    <div className="space-y-4">
      {/* 상단 요약 */}
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Workspace 수" value={data?.totals.workspaces ?? 0} />
        <SummaryCard label="총 잔액" value={data?.totals.credits ?? 0} suffix="크레딧" />
        <SummaryCard label="이번 달 사용" value={data?.totals.monthUsed ?? 0} suffix="크레딧" />
      </div>

      {/* 검색 + 새로고침 */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="name · slug · owner email 검색"
          className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent disabled:opacity-50"
        >
          {isFetching ? '새로고침…' : '새로고침'}
        </button>
      </div>

      {/* 테이블 */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              <Th onClick={() => toggleSort('name')} active={sortKey === 'name'} dir={sortDir}>
                Workspace
              </Th>
              <Th>Type</Th>
              <Th onClick={() => toggleSort('credits')} active={sortKey === 'credits'} dir={sortDir} align="right">
                크레딧
              </Th>
              <Th align="right">누적 지급</Th>
              <Th onClick={() => toggleSort('totalUsed')} active={sortKey === 'totalUsed'} dir={sortDir} align="right">
                누적 사용
              </Th>
              <Th onClick={() => toggleSort('monthUsed')} active={sortKey === 'monthUsed'} dir={sortDir} align="right">
                이번 달
              </Th>
              <Th
                onClick={() => toggleSort('memberCount')}
                active={sortKey === 'memberCount'}
                dir={sortDir}
                align="right"
              >
                멤버
              </Th>
              <Th onClick={() => toggleSort('lastUsedAt')} active={sortKey === 'lastUsedAt'} dir={sortDir}>
                최근 사용
              </Th>
              <Th align="right">액션</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-muted-foreground">
                  불러오는 중…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-destructive">
                  불러오지 못했어요. 새로고침을 눌러 주세요.
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-muted-foreground">
                  결과가 없어요.
                </td>
              </tr>
            ) : (
              filtered.map((w) => (
                <tr key={w.id} className="border-t hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <div className="font-medium">{w.name}</div>
                    <div className="text-xs text-muted-foreground">
                      /{w.slug} · {w.ownerEmail ?? '(owner email 없음)'}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className="rounded-full bg-secondary px-2 py-0.5">
                      {TYPE_LABEL[w.type] ?? w.type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-primary">
                    {w.credits.toLocaleString('ko-KR')}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {w.totalIssued.toLocaleString('ko-KR')}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {w.totalUsed.toLocaleString('ko-KR')}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {w.monthUsed.toLocaleString('ko-KR')}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{w.memberCount}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {formatDateTime(w.lastUsedAt)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setModalTarget(w)}
                      className="rounded-md border border-input bg-background px-2 py-1 text-xs hover:bg-accent"
                    >
                      관리
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <WorkspaceActionsModal
        workspace={modalTarget}
        onClose={() => setModalTarget(null)}
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
  suffix,
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular-nums">
          {value.toLocaleString('ko-KR')}
        </span>
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  dir,
  align = 'left',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  dir?: SortDir;
  align?: 'left' | 'right';
}) {
  const alignCls = align === 'right' ? 'text-right' : 'text-left';
  const clickable = !!onClick;
  return (
    <th className={`px-3 py-2 text-xs font-medium ${alignCls}`}>
      {clickable ? (
        <button
          type="button"
          onClick={onClick}
          className={`inline-flex items-center gap-1 hover:text-foreground ${active ? 'text-foreground' : ''}`}
        >
          {children}
          {active && <span aria-hidden="true">{dir === 'asc' ? '↑' : '↓'}</span>}
        </button>
      ) : (
        <span>{children}</span>
      )}
    </th>
  );
}
