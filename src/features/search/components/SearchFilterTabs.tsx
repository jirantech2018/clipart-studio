'use client';

// Design Ref: §5.4 Search Result Page — filter tabs [전체 / 내 라이브러리 / Community]

import { cn } from '@/lib/utils';

import type { SearchScope } from '@/features/search/hooks/useSearch';

const TABS: Array<{ key: SearchScope; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'mine', label: '내 라이브러리' },
  { key: 'community', label: '공유 라이브러리' },
];

interface SearchFilterTabsProps {
  scope: SearchScope;
  onChange: (next: SearchScope) => void;
}

export function SearchFilterTabs({ scope, onChange }: SearchFilterTabsProps) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="검색 범위">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={scope === tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            'h-8 rounded-full border px-3 text-sm transition-colors',
            scope === tab.key
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-input bg-background hover:bg-accent',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
