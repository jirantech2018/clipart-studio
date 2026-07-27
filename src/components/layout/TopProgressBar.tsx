'use client';

// 상단 얇은 indeterminate 프로그레스 바. AppHeader (h-14) 바로 아래에 고정.
// 활성 조건:
//   1) 전역 로딩 카운터 (다운로드/업스케일/기타 명시적 액션) > 0
//   2) 이미지 생성 SSE 스트림이 진행 중 (streamStatus starting|streaming)
// 색상: 브랜드 인디고 #373d8e.

import { useGenerationStore } from '@/lib/store/generationStore';
import { useLoadingStore } from '@/lib/store/loadingStore';

export function TopProgressBar() {
  const active = useLoadingStore((s) => s.activeCount > 0);
  const streaming = useGenerationStore(
    (s) => s.streamStatus === 'starting' || s.streamStatus === 'streaming',
  );

  if (!active && !streaming) return null;

  return (
    <div
      role="progressbar"
      aria-label="로딩 중"
      className="pointer-events-none fixed inset-x-0 top-14 z-50 h-[3px] overflow-hidden bg-transparent"
    >
      <div className="h-full w-1/3 animate-loading-bar bg-[#373d8e]" />
    </div>
  );
}
