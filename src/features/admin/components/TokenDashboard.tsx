'use client';

// Plan v0.2.9 §M4-1: Super Admin Token Dashboard.
//
// 목적 (사용자 확정): "어떤 조직이 있고, 현재 사용할 수 있는 크레딧과 멤버가
// 몇 명인지 빠르게 확인한 뒤 관리 화면으로 진입" — 통계 분석 화면이 아님.
//
// 정보 구조:
//   1. 상단 Dashboard
//      - 전체 현황 3개: 전체 조직 · 전체 보유 크레딧 · 전체 생성 이미지
//      - 기간별 breakdown 2개 카드: "사용 크레딧" · "생성 이미지"
//        각 카드에 오늘 / 이번 주 / 이번 달 (Asia/Seoul)
//   2. Organization 목록 — 2단 레이아웃 (md 이상)
//      - 좌: 일반 조직 (school + general) — 조직·크레딧·지급/회수·멤버
//      - 우: 개인 조직 (personal)         — 조직·크레딧·지급/회수 (멤버 열 없음)
//      - 조직명 옆 Type badge (개인/학교/일반)
//      - personal 조직은 name 대신 "내 작업실" 로 표시, 내부 slug 숨김
//      - 행 전체 클릭 → 히스토리 팝업

import { useMemo, useState } from 'react';

import { InlineCreditForm } from '@/features/admin/components/InlineCreditForm';
import { WorkspaceHistoryModal } from '@/features/admin/components/WorkspaceHistoryModal';
import { useTokenDashboard } from '@/features/admin/hooks/useTokenDashboard';
import type { AdminWorkspace } from '@/features/admin/hooks/useTokenDashboard';

type SortKey = 'credits' | 'memberCount' | 'name';
type SortDir = 'asc' | 'desc';

const TYPE_LABEL: Record<AdminWorkspace['type'], string> = {
  personal: '개인',
  school: '학교',
  general: '일반',
};

const TYPE_BADGE_CLASS: Record<AdminWorkspace['type'], string> = {
  personal: 'bg-slate-100 text-slate-700',
  school: 'bg-sky-100 text-sky-700',
  general: 'bg-emerald-100 text-emerald-700',
};

function displayName(w: AdminWorkspace): string {
  // personal-{user_id} 같은 내부 slug 는 노출하지 않고 표시명도 일관되게 처리.
  return w.type === 'personal' ? '내 작업실' : w.name;
}

export function TokenDashboard() {
  const { data, isLoading, isError, refetch, isFetching } = useTokenDashboard();
  const [query, setQuery] = useState('');
  // 기본 정렬을 조직명 오름차순 (ABC · 가나다) 로 고정. 지급/회수 후 잔액이
  // 바뀌어도 행 순서가 그대로 유지되어 사용자가 방금 조작한 조직을 계속
  // 눈으로 추적할 수 있다. 헤더를 클릭하면 크레딧·멤버 순으로 임시 전환 가능.
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [modalTarget, setModalTarget] = useState<AdminWorkspace | null>(null);

  const workspaces = data?.workspaces ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? workspaces.filter(
          (w) =>
            displayName(w).toLowerCase().includes(q) ||
            w.name.toLowerCase().includes(q) ||
            (w.ownerEmail ?? '').toLowerCase().includes(q),
        )
      : workspaces.slice();

    rows.sort((a, b) => {
      const sign = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'name') {
        // 한글/영문/숫자 혼재 정렬을 사용자가 예상하는 순서 (ABC · 가나다) 로
        // 정확히 잡기 위해 localeCompare('ko') 사용. numeric: true 로 "학교2"
        // vs "학교10" 도 자연스럽게 정렬.
        return (
          displayName(a).localeCompare(displayName(b), 'ko', { numeric: true }) *
          sign
        );
      }
      let av = 0;
      let bv = 0;
      if (sortKey === 'credits') {
        av = a.credits;
        bv = b.credits;
      } else if (sortKey === 'memberCount') {
        av = a.memberCount;
        bv = b.memberCount;
      }
      if (av < bv) return -1 * sign;
      if (av > bv) return 1 * sign;
      // 동률일 때는 이름 오름차순으로 tiebreaker — 새로고침해도 순서 흔들림 방지.
      return displayName(a).localeCompare(displayName(b), 'ko', { numeric: true });
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

  const totals = data?.totals;

  return (
    <div className="space-y-6">
      {/* 전체 현황 */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">전체 현황</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryCard label="전체 조직" value={totals?.workspaces ?? 0} />
          <SummaryCard label="전체 보유 크레딧" value={totals?.credits ?? 0} suffix="크레딧" />
          <SummaryCard label="전체 생성 이미지" value={totals?.totalImages ?? 0} suffix="장" />
        </div>
      </section>

      {/* 기간별 활동 */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">
          기간별 활동
          <span className="ml-2 text-xs font-normal text-muted-foreground/70">
            (기준: Asia/Seoul)
          </span>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <BreakdownCard
            title="사용 크레딧"
            today={totals?.creditsUsed.today ?? 0}
            week={totals?.creditsUsed.week ?? 0}
            month={totals?.creditsUsed.month ?? 0}
          />
          <BreakdownCard
            title="생성 이미지"
            today={totals?.imagesGenerated.today ?? 0}
            week={totals?.imagesGenerated.week ?? 0}
            month={totals?.imagesGenerated.month ?? 0}
            unit="장"
          />
        </div>
      </section>

      {/* Organization 목록 — 2단 레이아웃 (md 이상) */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Organization 목록</h2>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8 rounded-md border border-input bg-background px-3 text-xs hover:bg-accent disabled:opacity-50"
          >
            {isFetching ? '새로고침…' : '새로고침'}
          </button>
        </div>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="조직명 또는 이메일 검색"
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
        />

        <div className="grid gap-4 xl:grid-cols-2">
          <OrgTable
            title="일반 조직"
            rows={filtered.filter((w) => w.type !== 'personal')}
            showMember
            isLoading={isLoading}
            isError={isError}
            sortKey={sortKey}
            sortDir={sortDir}
            toggleSort={toggleSort}
            onRowClick={setModalTarget}
            onMutated={refetch}
          />
          <OrgTable
            title="개인 조직"
            rows={filtered.filter((w) => w.type === 'personal')}
            showMember={false}
            isLoading={isLoading}
            isError={isError}
            sortKey={sortKey}
            sortDir={sortDir}
            toggleSort={toggleSort}
            onRowClick={setModalTarget}
            onMutated={refetch}
          />
        </div>
      </section>

      <WorkspaceHistoryModal
        workspace={modalTarget}
        onClose={() => setModalTarget(null)}
      />
    </div>
  );
}

function OrgTable({
  title,
  rows,
  showMember,
  isLoading,
  isError,
  sortKey,
  sortDir,
  toggleSort,
  onRowClick,
  onMutated,
}: {
  title: string;
  rows: AdminWorkspace[];
  showMember: boolean;
  isLoading: boolean;
  isError: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
  toggleSort: (key: SortKey) => void;
  onRowClick: (w: AdminWorkspace) => void;
  onMutated: () => void;
}) {
  const colCount = showMember ? 4 : 3;
  const minWidthCls = showMember ? 'min-w-[560px]' : 'min-w-[480px]';

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {rows.length.toLocaleString('ko-KR')}개
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className={`w-full ${minWidthCls} text-sm`}>
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              <Th onClick={() => toggleSort('name')} active={sortKey === 'name'} dir={sortDir}>
                조직
              </Th>
              <Th
                onClick={() => toggleSort('credits')}
                active={sortKey === 'credits'}
                dir={sortDir}
                align="right"
              >
                현재 크레딧
              </Th>
              <Th align="right">지급 / 회수</Th>
              {showMember && (
                <Th
                  onClick={() => toggleSort('memberCount')}
                  active={sortKey === 'memberCount'}
                  dir={sortDir}
                  align="right"
                >
                  멤버
                </Th>
              )}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={colCount} className="py-8 text-center text-muted-foreground">
                  불러오는 중…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={colCount} className="py-8 text-center text-destructive">
                  불러오지 못했어요. 새로고침을 눌러 주세요.
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="py-8 text-center text-muted-foreground">
                  결과가 없어요.
                </td>
              </tr>
            ) : (
              rows.map((w) => (
                <tr
                  key={w.id}
                  onClick={() => onRowClick(w)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onRowClick(w);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${displayName(w)} 히스토리 보기`}
                  className="cursor-pointer border-t transition-colors hover:bg-muted/30 focus:bg-muted/40 focus:outline-none"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{displayName(w)}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          TYPE_BADGE_CLASS[w.type]
                        }`}
                      >
                        {TYPE_LABEL[w.type]}
                      </span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {w.ownerEmail ?? '(owner email 없음)'}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-primary">
                    {w.credits.toLocaleString('ko-KR')}
                  </td>
                  <td className="px-3 py-2">
                    <InlineCreditForm
                      organizationId={w.id}
                      displayName={displayName(w)}
                      currentBalance={w.credits}
                      onMutated={onMutated}
                    />
                  </td>
                  {showMember && (
                    <td className="px-3 py-2 text-right tabular-nums">{w.memberCount}</td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
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

function BreakdownCard({
  title,
  today,
  week,
  month,
  unit = '',
}: {
  title: string;
  today: number;
  week: number;
  month: number;
  unit?: string;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <dl className="mt-2 space-y-1 text-sm">
        <BreakdownRow label="오늘" value={today} unit={unit} />
        <BreakdownRow label="이번 주" value={week} unit={unit} />
        <BreakdownRow label="이번 달" value={month} unit={unit} />
      </dl>
    </div>
  );
}

function BreakdownRow({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit: string;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular-nums font-semibold">
        {value.toLocaleString('ko-KR')}
        {unit && <span className="ml-0.5 text-xs font-normal text-muted-foreground">{unit}</span>}
      </dd>
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
