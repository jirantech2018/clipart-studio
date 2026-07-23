'use client';

// 조직 컨텍스트 생성 시 (`/generate?org=<slug>`) 선택된 조직 참조 이미지 id.
// 개인 referenceStore 와 완전히 분리 — 두 스토어의 값이 자동으로 섞이지
// 않는다 (사용자 명세: 개인·조직 자동 mix 금지).

import { create } from 'zustand';

interface OrgReferenceStore {
  selectedOrgReferenceId: string | null;
  select: (id: string | null) => void;
  clear: () => void;
}

export const useOrgReferenceStore = create<OrgReferenceStore>((set) => ({
  selectedOrgReferenceId: null,
  select: (id) => set({ selectedOrgReferenceId: id }),
  clear: () => set({ selectedOrgReferenceId: null }),
}));
