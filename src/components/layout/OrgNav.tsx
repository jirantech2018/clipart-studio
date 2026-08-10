'use client';

// 로고 옆 조직 네비게이션.
//
// 구성:
//   1) "내 작업실" (personal organization) — 항상 첫번째, 좌측 고정, 드래그 대상 아님.
//   2) 사용자가 속한 school/general 조직들 — 사용자가 저장한 순서대로 표시.
//      드래그로 순서 변경 가능. 순서는 localStorage 에 저장 (`orgNavOrder`).
//   3) 헤더 폭에 다 못 담기면 넘친 만큼 우측 "더보기" 드롭다운으로 표시.
//
// 오버플로우 감지:
//   보이지 않는 measure 컨테이너에 실제 항목을 모두 렌더하고 각 항목의 폭을
//   측정한 뒤, container 실측 폭과 비교해 몇 개까지 노출할지 계산. `ResizeObserver`
//   로 헤더/컨테이너 크기 변화·항목 변경·순서 변경 시 재계산.
//
// 스타일:
//   AppHeader 가 홈 히어로 위에 얹힐 때 (overBanner) 는 흰 글자, 그 외는 기본.
//   overBanner 상태는 부모가 prop 으로 전달한다.

import { ChevronDown, GripVertical, Home } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useMyOrganizations } from '@/features/organization/hooks/useOrganizations';
import { cn } from '@/lib/utils';

import type { OrganizationWithMyRole } from '@/types/domain';

const STORAGE_KEY = 'orgNavOrder';
const OVERFLOW_BUTTON_WIDTH = 56; // "더보기" 트리거 폭 예상 (safety margin 포함)

function loadOrder(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

function saveOrder(order: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    // quota / private mode — skip silently
  }
}

/** 저장된 순서에 따라 정렬. 새로 추가된 조직은 뒤에 append. */
function sortByOrder(items: OrganizationWithMyRole[], order: string[]): OrganizationWithMyRole[] {
  const indexOf = new Map<string, number>();
  order.forEach((id, i) => indexOf.set(id, i));
  return items.slice().sort((a, b) => {
    const ai = indexOf.has(a.id) ? (indexOf.get(a.id) as number) : Number.MAX_SAFE_INTEGER;
    const bi = indexOf.has(b.id) ? (indexOf.get(b.id) as number) : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name, 'ko', { numeric: true });
  });
}

export function OrgNav({ overBanner }: { overBanner: boolean }) {
  const pathname = usePathname();
  const { data } = useMyOrganizations();
  const orgs = data?.organizations ?? [];

  const personal = orgs.find((o) => o.type === 'personal') ?? null;
  const others = useMemo(() => orgs.filter((o) => o.type !== 'personal'), [orgs]);

  const [order, setOrder] = useState<string[]>(() => loadOrder());
  useEffect(() => {
    // 새로 알게 된 조직 id 를 order 에 append (사용자가 아직 순서를 조정하지 않은
    // 상태를 보존하기 위해 rehydrate 시 자동으로 뒤에 붙이기만 한다).
    const known = new Set(order);
    const missing = others.map((o) => o.id).filter((id) => !known.has(id));
    if (missing.length === 0) return;
    const next = [...order, ...missing];
    setOrder(next);
    saveOrder(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [others.map((o) => o.id).join(',')]);

  const sortedOthers = useMemo(() => sortByOrder(others, order), [others, order]);

  const reorder = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return;
      // 현재 sortedOthers 기준 인덱스로 계산 → 그 결과를 새 order 로 저장.
      const ids = sortedOthers.map((o) => o.id);
      const fromIdx = ids.indexOf(fromId);
      const toIdx = ids.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return;
      const next = ids.slice();
      const [moved] = next.splice(fromIdx, 1);
      if (!moved) return;
      next.splice(toIdx, 0, moved);
      setOrder(next);
      saveOrder(next);
    },
    [sortedOthers],
  );

  // 오버플로우 계산 — measureRef 로 각 항목 폭을 측정 후 containerRef 폭에 맞춰
  // 몇 개 노출할지 결정.
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState<number>(sortedOthers.length);

  useEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    function recompute() {
      if (!container || !measure) return;
      const available = container.clientWidth;
      const children = Array.from(measure.children) as HTMLElement[];
      const total = children.length;
      if (total === 0) {
        setVisibleCount(0);
        return;
      }
      let used = 0;
      let count = 0;
      for (let i = 0; i < total; i += 1) {
        const child = children[i];
        if (!child) break;
        const w = child.getBoundingClientRect().width + 4; // + gap
        const budget = i === total - 1 ? available : available - OVERFLOW_BUTTON_WIDTH;
        if (used + w > budget) break;
        used += w;
        count = i + 1;
      }
      setVisibleCount(count);
    }

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    ro.observe(measure);
    window.addEventListener('resize', recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, [sortedOthers.length]);

  // 데이터가 아직 없어도 자리는 잡아둔다 (레이아웃 shift 최소화).
  const visibleItems = sortedOthers.slice(0, visibleCount);
  const overflowItems = sortedOthers.slice(visibleCount);

  // "더보기" 드롭다운
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  useEffect(() => setOverflowOpen(false), [pathname]);
  useEffect(() => {
    if (!overflowOpen) return;
    function onDown(e: MouseEvent) {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOverflowOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [overflowOpen]);

  const isPersonalActive = pathname.startsWith('/organization/my');

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {/* 내 작업실 — 고정 */}
      {personal && (
        <Link
          href="/organization/my"
          className={cn(
            'inline-flex h-9 shrink-0 items-center gap-1 rounded-md px-2.5 text-sm font-medium transition-colors',
            overBanner
              ? cn('text-white hover:bg-white/20', isPersonalActive && 'bg-white/25')
              : cn(
                  isPersonalActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                ),
          )}
        >
          <Home className="h-3.5 w-3.5" aria-hidden="true" />
          내 작업실
        </Link>
      )}

      {/* 조직 목록 (visible) — 컨테이너 폭에 담기는 만큼 */}
      <div ref={containerRef} className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {visibleItems.map((org) => (
          <DraggableOrgLink
            key={org.id}
            org={org}
            pathname={pathname}
            overBanner={overBanner}
            onReorder={reorder}
          />
        ))}
      </div>

      {/* 오버플로우 드롭다운 */}
      {overflowItems.length > 0 && (
        <div className="relative shrink-0" ref={overflowRef}>
          <button
            type="button"
            onClick={() => setOverflowOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            className={cn(
              'inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm font-medium transition-colors',
              overBanner
                ? 'text-white hover:bg-white/20'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            +{overflowItems.length}
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {overflowOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-1 min-w-[180px] max-h-[60vh] overflow-y-auto rounded-md border bg-background text-foreground shadow-md [text-shadow:none]"
            >
              {overflowItems.map((org) => (
                <div
                  key={org.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', org.id);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = e.dataTransfer.getData('text/plain');
                    reorder(from, org.id);
                  }}
                >
                  <Link
                    href={`/organization/${org.slug}`}
                    role="menuitem"
                    onClick={() => setOverflowOpen(false)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent',
                      pathname === `/organization/${org.slug}` && 'bg-accent/60 font-medium',
                    )}
                  >
                    <GripVertical
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="truncate">{org.name}</span>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Hidden measure — 실제 렌더와 동일한 스타일로 폭 측정 */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute -z-10 flex items-center gap-1"
      >
        {sortedOthers.map((org) => (
          <span
            key={org.id}
            className="inline-flex h-9 items-center gap-1 rounded-md px-2.5 text-sm font-medium"
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
            {org.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function DraggableOrgLink({
  org,
  pathname,
  overBanner,
  onReorder,
}: {
  org: OrganizationWithMyRole;
  pathname: string;
  overBanner: boolean;
  onReorder: (fromId: string, toId: string) => void;
}) {
  const href = `/organization/${org.slug}`;
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', org.id);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const from = e.dataTransfer.getData('text/plain');
        onReorder(from, org.id);
      }}
      className={cn('shrink-0', isDragOver && 'ring-2 ring-primary/40 rounded-md')}
    >
      <Link
        href={href}
        title={org.name}
        className={cn(
          'inline-flex h-9 max-w-[180px] items-center gap-1 rounded-md px-2.5 text-sm font-medium transition-colors',
          overBanner
            ? cn('text-white hover:bg-white/20', active && 'bg-white/25')
            : cn(
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              ),
        )}
      >
        <GripVertical
          className={cn(
            'h-3 w-3 shrink-0',
            overBanner ? 'text-white/60' : 'text-muted-foreground/60',
          )}
          aria-hidden="true"
        />
        <span className="truncate">{org.name}</span>
      </Link>
    </div>
  );
}
