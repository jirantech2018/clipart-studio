'use client';

// 폼(GenerationForm)이 현재 선택한 배치 크기/이미지 비율을 스트림이 시작되기 전에도
// BatchProgressPanel 이 미리 반영해서 "아직 생성되지 않은 빈 슬롯" 을 그릴 수 있도록
// 공유하는 아주 얇은 스토어. 폼이 값이 바뀔 때마다 여기 push 하고, 패널은 idle 상태일 때
// 이 값을 읽어 슬롯 개수와 aspect-ratio 를 결정한다. 스트림이 시작된 이후에는
// generationStore 쪽의 배치/비율(실행 시점 스냅샷)을 우선 사용한다.

import { create } from 'zustand';

import type { AspectRatio } from '@/types/domain';

interface GenerationDraftStore {
  batchSize: number;
  aspectRatio: AspectRatio;
  setBatchSize: (n: number) => void;
  setAspectRatio: (r: AspectRatio) => void;
}

export const useGenerationDraftStore = create<GenerationDraftStore>((set) => ({
  batchSize: 5,
  aspectRatio: 'square',
  setBatchSize: (batchSize) => set({ batchSize }),
  setAspectRatio: (aspectRatio) => set({ aspectRatio }),
}));
