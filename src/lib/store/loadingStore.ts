// 전역 상단 프로그레스 바 카운터. 여러 액션이 겹쳐도 count 기반이라
// 마지막 stop() 이 발동해야 바가 사라진다.
//
// 사용법:
//   const { start, stop } = useLoadingStore.getState();
//   start();
//   try { await work(); } finally { stop(); }
//
// Generation SSE 스트림은 이 카운터를 쓰지 않고 useGenerationStore.streamStatus
// 를 TopProgressBar 가 직접 감지한다 (이미 스트림 상태가 그 store 에 있음).

import { create } from 'zustand';

interface LoadingState {
  activeCount: number;
  start: () => void;
  stop: () => void;
}

export const useLoadingStore = create<LoadingState>((set) => ({
  activeCount: 0,
  start: () => set((s) => ({ activeCount: s.activeCount + 1 })),
  stop: () => set((s) => ({ activeCount: Math.max(0, s.activeCount - 1) })),
}));
