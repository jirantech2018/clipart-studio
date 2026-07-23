'use client';

// 학교 스타일 적용 여부 상태. GenerationForm 과 별도 카드 (SchoolContextCard)
// 가 이 값을 공유. 페이지 최초 로드 시 컨텍스트 (개인/조직) 의 기본값을
// `initApplied` 로 세팅한다.

import { create } from 'zustand';

interface SchoolApplyStore {
  applied: boolean;
  set: (next: boolean) => void;
  /** 페이지 최초 로드 시 컨텍스트 기본값을 반영. */
  initFromContext: (defaultValue: boolean) => void;
}

export const useSchoolApplyStore = create<SchoolApplyStore>((set) => ({
  applied: false,
  set: (next) => set({ applied: next }),
  initFromContext: (defaultValue) => set({ applied: defaultValue }),
}));
