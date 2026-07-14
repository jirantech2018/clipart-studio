'use client';

// /generate 페이지의 GenerationForm 과 하단 ReferenceLibrarySection 이 같은
// "선택된 참조 이미지" 상태를 공유해야 하므로 Zustand 로 단순 store 유지.

import { create } from 'zustand';

interface ReferenceStore {
  selectedReferenceId: string | null;
  select: (id: string | null) => void;
  clear: () => void;
}

export const useReferenceStore = create<ReferenceStore>((set) => ({
  selectedReferenceId: null,
  select: (id) => set({ selectedReferenceId: id }),
  clear: () => set({ selectedReferenceId: null }),
}));
