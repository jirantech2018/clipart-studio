'use client';

// Design Ref: §5.4 Library Page — filter bar (전체/저장됨/Pending/공개중) + sort dropdown

import { cn } from '@/lib/utils';

import type { LibraryFilter, LibrarySort } from '@/features/library/hooks/useMyImages';

const FILTER_LABELS: Record<LibraryFilter, string> = {
  all: '전체',
  public: '공개 중',
};

const SORT_LABELS: Record<LibrarySort, string> = {
  newest: '최신순',
  oldest: '오래된순',
};

interface LibraryFiltersProps {
  filter: LibraryFilter;
  sort: LibrarySort;
  onFilterChange: (next: LibraryFilter) => void;
  onSortChange: (next: LibrarySort) => void;
  counts?: Partial<Record<LibraryFilter, number>>;
}

export function LibraryFilters({
  filter,
  sort,
  onFilterChange,
  onSortChange,
  counts,
}: LibraryFiltersProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(FILTER_LABELS) as LibraryFilter[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onFilterChange(key)}
            className={cn(
              'h-8 rounded-full border px-3 text-sm transition-colors',
              filter === key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-background hover:bg-accent',
            )}
          >
            {FILTER_LABELS[key]}
            {typeof counts?.[key] === 'number' && (
              <span className="ml-1 tabular-nums opacity-70">{counts[key]}</span>
            )}
          </button>
        ))}
      </div>

      <select
        value={sort}
        onChange={(e) => onSortChange(e.target.value as LibrarySort)}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
      >
        {(Object.keys(SORT_LABELS) as LibrarySort[]).map((key) => (
          <option key={key} value={key}>
            {SORT_LABELS[key]}
          </option>
        ))}
      </select>
    </div>
  );
}
