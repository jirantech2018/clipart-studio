'use client';

// generation-v2 (Conversation UI) 전용 client store.
//
// 저장 원칙 (Q3 지시):
//   저장 대상 — conversation id / 임시 제목 / Prompt / 옵션 / Block 순서
//                / 완료된 이미지 메타데이터 / Block 의 마지막 확인 상태
//   저장 X   — 실제 진행률 · 진행 중 여부 · 예상 남은 시간 · 크레딧 상태
//                · Job 최종 성공/실패 상태 (서버 재조회 필요)
//
// 진행 중 (generating/queued) 상태의 Block 은 rehydrate 시 'unknown' 으로 강등.
// 사용자에게는 "생성 상태 확인이 필요합니다" 를 보여주고 잘못된 진행률을
// 표시하지 않는다. 서버 재조회 로직은 이번 커밋 스코프 외 (Phase 2).

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { resizeSlotPrompts } from '@/features/generation/lib/resizeSlotPrompts';

import type { AspectRatio } from '@/types/domain';

// ============ Types ============

export type BlockStatus =
  | 'draft' // 사용자가 입력 중, 아직 생성 요청 없음
  | 'queued' // 서버 요청 완료, SSE 대기 (session-only)
  | 'generating' // SSE 진행 중 (session-only)
  | 'completed' // 정상 종료 (일부 실패 포함 = "부분 성공" 도 여기)
  | 'failed' // 전체 실패
  | 'unknown'; // rehydrate 시 진행 중이던 Block → 서버 재조회 필요

export interface BlockOptions {
  batchSize: number;
  aspectRatio: AspectRatio;
  personalReferenceIds: string[];
  orgReferenceIds: string[];
  schoolProfileApplied: boolean;
  orgSlug: string | null;
  /** 다양성 생성 ON/OFF. OFF 시 submit payload 는 slotPrompts=null. */
  diversityCustomOn: boolean;
  /** 이미지별 추가 프롬프트. 길이는 batchSize 와 정합되어야 하며,
   *  addBlock / updateOptions / rehydrate 각 지점에서 자동 리사이즈된다. */
  slotPrompts: string[];
  /** Chaining (이미지→이미지) — 이 이미지로 다시 만들기 진입 시 세팅.
   *  세 필드 모두 함께 세팅되거나 함께 null. */
  parentImageId: string | null;
  parentImageThumbnailUrl: string | null;
  parentImagePrompt: string | null;
}

export interface CompletedImage {
  imageId: string;
  order: number;
  thumbnailUrl: string;
}

export interface FailedSlot {
  order: number;
  error: string;
}

export interface Block {
  id: string;
  status: BlockStatus;
  prompt: string;
  options: BlockOptions;
  jobId: string | null;
  succeeded: CompletedImage[];
  failed: FailedSlot[];
  errorMessage: string | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  /** 첫 생성 시점의 첫 Prompt 기준으로 확정. 이후 자동 변경 없음. null = 미확정. */
  title: string | null;
  blocks: Block[];
  createdAt: string;
  updatedAt: string;
}

interface ConversationState {
  currentId: string | null;
  conversations: Record<string, Conversation>;

  // ----- Conversation lifecycle -----
  createConversation: () => string;
  setCurrentConversation: (id: string) => void;
  removeEmptyConversation: (id: string) => void;
  confirmConversationTitle: (id: string, firstPrompt: string) => void;

  // ----- Block lifecycle -----
  addBlock: (convId: string, seedOptions?: Partial<BlockOptions>) => string;
  updateBlockPrompt: (convId: string, blockId: string, prompt: string) => void;
  updateBlockOptions: (
    convId: string,
    blockId: string,
    patch: Partial<BlockOptions>,
  ) => void;

  // ----- Job lifecycle -----
  markBlockQueued: (convId: string, blockId: string, jobId: string) => void;
  markBlockGenerating: (convId: string, blockId: string) => void;
  appendBlockImage: (
    convId: string,
    blockId: string,
    image: CompletedImage,
  ) => void;
  appendBlockFailure: (
    convId: string,
    blockId: string,
    failure: FailedSlot,
  ) => void;
  markBlockCompleted: (convId: string, blockId: string) => void;
  markBlockFailed: (convId: string, blockId: string, message: string) => void;

  reset: () => void;
}

// ============ Helpers ============

const DEFAULT_BATCH_SIZE = 1;

const DEFAULT_OPTIONS: BlockOptions = {
  batchSize: DEFAULT_BATCH_SIZE,
  aspectRatio: 'square',
  personalReferenceIds: [],
  orgReferenceIds: [],
  schoolProfileApplied: false,
  orgSlug: null,
  diversityCustomOn: false,
  slotPrompts: Array.from({ length: DEFAULT_BATCH_SIZE }, () => ''),
  parentImageId: null,
  parentImageThumbnailUrl: null,
  parentImagePrompt: null,
};

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function makeBlock(seed?: Partial<BlockOptions>): Block {
  const merged: BlockOptions = { ...DEFAULT_OPTIONS, ...(seed ?? {}) };
  // slotPrompts 길이는 항상 batchSize 와 정합. seed 로 batchSize 만 오는
  // 일반 경로에서도 default slotPrompts 길이를 새 batchSize 로 맞춘다.
  merged.slotPrompts = resizeSlotPrompts(merged.slotPrompts, merged.batchSize);
  return {
    id: uid(),
    status: 'draft',
    prompt: '',
    options: merged,
    jobId: null,
    succeeded: [],
    failed: [],
    errorMessage: null,
    createdAt: new Date().toISOString(),
  };
}

function isConversationEmpty(conv: Conversation): boolean {
  // "실제 생성 기록이 없다" = 모든 Block 이 draft 상태이며 어떤 이미지도 없음
  return conv.blocks.every(
    (b) => b.status === 'draft' && b.succeeded.length === 0 && b.failed.length === 0,
  );
}

function patchBlock(
  state: ConversationState,
  convId: string,
  blockId: string,
  patcher: (b: Block) => Block,
): Partial<ConversationState> {
  const conv = state.conversations[convId];
  if (!conv) return {};
  const nextBlocks = conv.blocks.map((b) => (b.id === blockId ? patcher(b) : b));
  return {
    conversations: {
      ...state.conversations,
      [convId]: {
        ...conv,
        blocks: nextBlocks,
        updatedAt: new Date().toISOString(),
      },
    },
  };
}

// ============ Store ============

export const useConversationStore = create<ConversationState>()(
  persist(
    (set, get) => ({
      currentId: null,
      conversations: {},

      // ----- Conversation lifecycle -----
      createConversation: () => {
        const id = uid();
        const now = new Date().toISOString();
        const firstBlock = makeBlock();
        set((state) => ({
          currentId: id,
          conversations: {
            ...state.conversations,
            [id]: {
              id,
              title: null,
              blocks: [firstBlock],
              createdAt: now,
              updatedAt: now,
            },
          },
        }));
        return id;
      },

      setCurrentConversation: (id) => set({ currentId: id }),

      removeEmptyConversation: (id) => {
        const conv = get().conversations[id];
        if (!conv || !isConversationEmpty(conv)) return;
        set((state) => {
          const next = { ...state.conversations };
          delete next[id];
          return {
            conversations: next,
            currentId: state.currentId === id ? null : state.currentId,
          };
        });
      },

      confirmConversationTitle: (id, firstPrompt) => {
        set((state) => {
          const conv = state.conversations[id];
          if (!conv || conv.title) return state; // 이미 확정된 제목은 자동 변경 금지
          const firstLine = firstPrompt.split(/\r?\n/)[0]?.trim() ?? '';
          const trimmed = firstLine.length > 30
            ? `${firstLine.slice(0, 30)}…`
            : firstLine;
          const title = trimmed.length > 0 ? trimmed : '새로운 대화';
          return {
            conversations: {
              ...state.conversations,
              [id]: { ...conv, title, updatedAt: new Date().toISOString() },
            },
          };
        });
      },

      // ----- Block lifecycle -----
      addBlock: (convId, seedOptions) => {
        const block = makeBlock(seedOptions);
        set((state) => {
          const conv = state.conversations[convId];
          if (!conv) return state;
          return {
            conversations: {
              ...state.conversations,
              [convId]: {
                ...conv,
                blocks: [...conv.blocks, block],
                updatedAt: new Date().toISOString(),
              },
            },
          };
        });
        return block.id;
      },

      updateBlockPrompt: (convId, blockId, prompt) =>
        set((state) => patchBlock(state, convId, blockId, (b) => ({ ...b, prompt }))),

      updateBlockOptions: (convId, blockId, patch) =>
        set((state) =>
          patchBlock(state, convId, blockId, (b) => ({
            ...b,
            options: { ...b.options, ...patch },
          })),
        ),

      // ----- Job lifecycle -----
      markBlockQueued: (convId, blockId, jobId) =>
        set((state) =>
          patchBlock(state, convId, blockId, (b) => ({
            ...b,
            status: 'queued',
            jobId,
          })),
        ),

      markBlockGenerating: (convId, blockId) =>
        set((state) =>
          patchBlock(state, convId, blockId, (b) => ({ ...b, status: 'generating' })),
        ),

      appendBlockImage: (convId, blockId, image) =>
        set((state) =>
          patchBlock(state, convId, blockId, (b) => ({
            ...b,
            succeeded: [...b.succeeded, image],
          })),
        ),

      appendBlockFailure: (convId, blockId, failure) =>
        set((state) =>
          patchBlock(state, convId, blockId, (b) => ({
            ...b,
            failed: [...b.failed, failure],
          })),
        ),

      markBlockCompleted: (convId, blockId) =>
        set((state) =>
          patchBlock(state, convId, blockId, (b) => ({ ...b, status: 'completed' })),
        ),

      markBlockFailed: (convId, blockId, message) =>
        set((state) =>
          patchBlock(state, convId, blockId, (b) => ({
            ...b,
            status: 'failed',
            errorMessage: message,
          })),
        ),

      reset: () => set({ currentId: null, conversations: {} }),
    }),
    {
      name: 'clipart-conversation-v2',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // 진행 중 상태는 저장 X — rehydrate 시 'unknown' 으로 강등.
      // 개인/조직 참조 이미지 선택도 세션 상태로 보되 편의상 저장 유지.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        Object.values(state.conversations).forEach((conv) => {
          conv.blocks.forEach((b) => {
            if (b.status === 'queued' || b.status === 'generating') {
              b.status = 'unknown';
            }
            // 하위호환: 다양성 생성 필드가 없는 예전 payload 보정.
            // (버전 1 저장본에는 diversityCustomOn / slotPrompts 가 없다)
            const opts = b.options as Partial<BlockOptions>;
            if (typeof opts.diversityCustomOn !== 'boolean') {
              opts.diversityCustomOn = false;
            }
            if (!Array.isArray(opts.slotPrompts)) {
              opts.slotPrompts = [];
            }
            const batchSize =
              typeof opts.batchSize === 'number' && opts.batchSize > 0
                ? opts.batchSize
                : DEFAULT_BATCH_SIZE;
            if (opts.slotPrompts.length !== batchSize) {
              opts.slotPrompts = resizeSlotPrompts(opts.slotPrompts, batchSize);
            }
            // Chaining 신규 필드 — 예전 저장본에는 없다.
            if (opts.parentImageId === undefined) opts.parentImageId = null;
            if (opts.parentImageThumbnailUrl === undefined) {
              opts.parentImageThumbnailUrl = null;
            }
            if (opts.parentImagePrompt === undefined) {
              opts.parentImagePrompt = null;
            }
          });
        });
      },
    },
  ),
);
