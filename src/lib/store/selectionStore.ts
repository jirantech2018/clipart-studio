// 다중 선택 상태를 scope 별로 분리해서 관리하는 Zustand store.
//
// 현재 사용 중인 scope 는 'library' 와 'community' 두 개.
// 확장 계획: `organization:{orgId}`, `collection:{collectionId}` 등이 나중에 추가됨.
// scope 별로 별도 bucket 을 유지하므로 서로의 선택 상태가 섞이지 않는다.

import { create } from 'zustand';

export type SelectionScope =
  | 'library'
  | 'community'
  | `organization:${string}`
  | `collection:${string}`;

interface SelectionState {
  buckets: Record<string, Set<string>>;
  toggle: (scope: SelectionScope, id: string) => void;
  clear: (scope: SelectionScope) => void;
  setAll: (scope: SelectionScope, ids: string[]) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  buckets: {},

  toggle: (scope, id) =>
    set((state) => {
      const current = state.buckets[scope] ?? new Set<string>();
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { buckets: { ...state.buckets, [scope]: next } };
    }),

  clear: (scope) =>
    set((state) => {
      if (!state.buckets[scope] || state.buckets[scope].size === 0) return state;
      const nextBuckets = { ...state.buckets };
      delete nextBuckets[scope];
      return { buckets: nextBuckets };
    }),

  setAll: (scope, ids) =>
    set((state) => ({
      buckets: { ...state.buckets, [scope]: new Set(ids) },
    })),
}));
