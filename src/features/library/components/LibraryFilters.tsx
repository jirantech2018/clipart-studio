'use client';

// 라이브러리 상단 정렬 드롭다운.
//
// 사용자 지시 (2026-08): 기존 [전체 | 공개 중] filter chips 제거. 정렬 옵션만
// 노출한다. filter 는 항상 'all' 로 서버가 처리하므로 상태를 UI 에서 다루지
// 않는다.

import type { LibrarySort } from '@/features/library/hooks/useMyImages';

const SORT_LABELS: Record<LibrarySort, string> = {
  newest: '최신순',
  oldest: '오래된순',
};

interface LibraryFiltersProps {
  sort: LibrarySort;
  onSortChange: (next: LibrarySort) => void;
}

export function LibraryFilters({ sort, onSortChange }: LibraryFiltersProps) {
  return (
    <div className="flex items-center justify-end">
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
