// Design Ref: §9.4 Application layer — client-side generation state (Zustand)
// Design Ref: §2.2 Batch generation data flow (SSE consumer targets this store)
// Policy: generated images auto-save to library on creation. No pending/discarded state on client.

import { create } from 'zustand';

import type { AspectRatio } from '@/types/domain';

export interface ResultCard {
  order: number;
  imageId: string;
  thumbnailUrl: string;
}

export interface ChunkFailure {
  order: number;
  error: string;
}

export interface DoneSummary {
  completed: number;
  failed: number;
  refundedCredits: number;
  finalRemainingCredits: number | null;
}

export type StreamStatus = 'idle' | 'starting' | 'streaming' | 'done' | 'error';

type GenerationState = {
  jobId: string | null;
  batchSize: number;
  aspectRatio: AspectRatio;
  streamStatus: StreamStatus;
  cards: ResultCard[];
  failures: ChunkFailure[];
  summary: DoneSummary | null;
  errorMessage: string | null;

  startJob: (jobId: string, batchSize: number, aspectRatio: AspectRatio) => void;
  markStreaming: () => void;
  appendCard: (card: ResultCard) => void;
  appendFailure: (failure: ChunkFailure) => void;
  finish: (summary: DoneSummary) => void;
  fail: (message: string) => void;
  reset: () => void;
};

const initial = {
  jobId: null,
  batchSize: 0,
  aspectRatio: 'square' as AspectRatio,
  streamStatus: 'idle' as StreamStatus,
  cards: [] as ResultCard[],
  failures: [] as ChunkFailure[],
  summary: null as DoneSummary | null,
  errorMessage: null as string | null,
};

export const useGenerationStore = create<GenerationState>((set) => ({
  ...initial,
  startJob: (jobId, batchSize, aspectRatio) =>
    set({
      ...initial,
      jobId,
      batchSize,
      aspectRatio,
      streamStatus: 'starting',
    }),
  markStreaming: () => set({ streamStatus: 'streaming' }),
  appendCard: (card) =>
    set((state) => ({
      cards: [...state.cards, card].sort((a, b) => a.order - b.order),
    })),
  appendFailure: (failure) =>
    set((state) => ({ failures: [...state.failures, failure] })),
  finish: (summary) => set({ streamStatus: 'done', summary }),
  fail: (message) => set({ streamStatus: 'error', errorMessage: message }),
  reset: () => set(initial),
}));
