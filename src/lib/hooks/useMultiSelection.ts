'use client';

// selectionStore 를 scope 별로 편하게 소비하기 위한 wrapper 훅.
// 컴포넌트는 scope 문자열만 넘기면 되고, 어떤 페이지든 동일 API 로 다룰 수 있다.

import { useSelectionStore, type SelectionScope } from '@/lib/store/selectionStore';

export function useMultiSelection(scope: SelectionScope) {
  const bucket = useSelectionStore((s) => s.buckets[scope]);
  const toggle = useSelectionStore((s) => s.toggle);
  const clear = useSelectionStore((s) => s.clear);
  const setAll = useSelectionStore((s) => s.setAll);

  const selectedIds = bucket ? Array.from(bucket) : [];

  return {
    selectedIds,
    count: selectedIds.length,
    isSelected: (id: string) => bucket?.has(id) ?? false,
    toggle: (id: string) => toggle(scope, id),
    clear: () => clear(scope),
    setAll: (ids: string[]) => setAll(scope, ids),
  };
}
