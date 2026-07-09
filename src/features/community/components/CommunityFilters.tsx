'use client';

// Design Ref: §5.4 Community filter row — 12 fixed categories + sort dropdown.

import { SCHOOL_CATEGORIES } from '@/services/tagging';
import { cn } from '@/lib/utils';

import type { CommunitySort } from '@/features/community/hooks/useCommunity';

interface CommunityFiltersProps {
  category: string | null;
  sort: CommunitySort;
  onCategoryChange: (next: string | null) => void;
  onSortChange: (next: CommunitySort) => void;
}

const SORT_LABELS: Record<CommunitySort, string> = {
  newest: '최신순',
  popular: '인기순',
};

export function CommunityFilters({
  category,
  sort,
  onCategoryChange,
  onSortChange,
}: CommunityFiltersProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onCategoryChange(null)}
          className={cn(
            'h-8 rounded-full border px-3 text-sm transition-colors',
            category === null
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-input bg-background hover:bg-accent',
          )}
        >
          전체
        </button>
        {SCHOOL_CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => onCategoryChange(cat)}
            className={cn(
              'h-8 rounded-full border px-3 text-sm transition-colors',
              category === cat
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-background hover:bg-accent',
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="flex justify-end">
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as CommunitySort)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        >
          {(Object.keys(SORT_LABELS) as CommunitySort[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
