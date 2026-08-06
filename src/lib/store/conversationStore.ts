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

import {
  emptyPackagePlanState,
  type PackagePlanState,
} from '@/features/generation-v2/lib/packagePlanTypes';

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

  // ── 테마별(목적별) 패키지 생성 모드 ──
  // 토글 (packageMode) 와 계획 상태 (packagePlan) 를 분리. Phase 3 에서
  // Generating/Completed 를 packagePlan 단위로 다루기 위해 하나의 nested
  // 객체로 관리한다. Phase 1 에서는 실제 생성 파이프라인이 연결되지
  // 않으므로 CTA disabled + /api/jobs 호출 없음.
  packageMode: boolean;
  packagePlan: PackagePlanState;
}

export interface CompletedImage {
  imageId: string;
  order: number;
  thumbnailUrl: string;
  // Phase 2 — package job 에서만 채워진다. single job 은 undefined.
  slotId?: string;
  category?: string;
  name?: string;
  /** Phase 3 UI 편의를 위해 slot / job 의 aspect ratio 를 함께 저장.
   *  package 는 slot.aspectRatio, single 은 job.aspectRatio. Legacy 저장본
   *  은 undefined — 소비 측에서 fallback 필요. */
  aspectRatio?: AspectRatio;
  /** 동일 category 내부 순서. Package Completed UI 그룹 내 정렬에 사용.
   *  Legacy · single 은 undefined → 소비 측이 order 로 fallback. */
  categoryOrder?: number;
}

export interface FailedSlot {
  order: number;
  error: string;
  // Package job 에서만 채워지는 slot metadata (Completed UI 그룹 내 실패 수 표시용).
  slotId?: string;
  category?: string;
  name?: string;
  categoryOrder?: number;
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
  createConversation: (seedOptions?: Partial<BlockOptions>) => string;
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

  /** 서버 재조회 결과로 Block 상태 · 이미지 목록을 통째로 대체. Package job
   *  재진입 복구에서 사용. SSE 가 이미 진행 중인 상태와 충돌하지 않도록
   *  호출자 (hook) 가 status 판단을 완료한 뒤 넘겨준다. */
  applyServerJobState: (
    convId: string,
    blockId: string,
    payload: {
      status: BlockStatus;
      jobId: string | null;
      succeeded: CompletedImage[];
      failed: FailedSlot[];
      errorMessage: string | null;
    },
  ) => void;

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
  packageMode: false,
  packagePlan: emptyPackagePlanState(),
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
      createConversation: (seedOptions) => {
        const id = uid();
        const now = new Date().toISOString();
        const firstBlock = makeBlock(seedOptions);
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

      applyServerJobState: (convId, blockId, payload) =>
        set((state) =>
          patchBlock(state, convId, blockId, (b) => ({
            ...b,
            status: payload.status,
            jobId: payload.jobId,
            succeeded: payload.succeeded,
            failed: payload.failed,
            errorMessage: payload.errorMessage,
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
            // Package mode 필드 — packageMode(flag) + packagePlan(nested).
            if (typeof opts.packageMode !== 'boolean') opts.packageMode = false;

            // v1 (flat) → v2 (nested) migrate. 예전 저장본에 flat 필드가
            // 있으면 packagePlan 서브객체로 옮기고, 없으면 빈 값을 채운다.
            const legacy = opts as unknown as Record<string, unknown>;
            if (
              !opts.packagePlan ||
              typeof opts.packagePlan !== 'object' ||
              Array.isArray(opts.packagePlan)
            ) {
              opts.packagePlan = emptyPackagePlanState();
            }
            const plan = opts.packagePlan;

            function pickString(key: string): string {
              const v = legacy[key];
              return typeof v === 'string' ? v : '';
            }
            function pickStrArray(key: string): string[] {
              const v = legacy[key];
              return Array.isArray(v)
                ? v.filter((x) => typeof x === 'string')
                : [];
            }

            if (!plan.purpose) plan.purpose = pickString('packagePurpose');
            if (!plan.topicOrEvent) plan.topicOrEvent = pickString('packageTopic');
            if (!plan.target) plan.target = pickString('packageTarget');
            if (!plan.styleTone) plan.styleTone = pickString('packageStyleTone');
            if (!plan.additionalRequest) {
              plan.additionalRequest = pickString('packageAdditionalRequest');
            }
            if (!Array.isArray(plan.usageChannels)) {
              plan.usageChannels = [];
            }
            if (!plan.aiKeywords.length) {
              plan.aiKeywords = pickStrArray('packageAiKeywords');
            }
            if (!plan.userAddedKeywords.length) {
              plan.userAddedKeywords = pickStrArray('packageUserAddedKeywords');
            }
            if (!plan.userRemovedKeywords.length) {
              plan.userRemovedKeywords = pickStrArray(
                'packageUserRemovedKeywords',
              );
            }
            if (!plan.aiItems.length && Array.isArray(legacy.packageAiItems)) {
              // 이전 스키마의 item 은 aspectRatio/promptHint/transparentBackground
              // 필드가 없을 수 있음. sanitize 없이 통째로 옮기고 누락 필드는
              // 기본값으로 채운다.
              plan.aiItems = (legacy.packageAiItems as unknown[])
                .map((raw) => {
                  if (!raw || typeof raw !== 'object') return null;
                  const r = raw as Record<string, unknown>;
                  return {
                    id: typeof r.id === 'string' ? r.id : '',
                    category:
                      typeof r.category === 'string' ? r.category : 'etc',
                    name: typeof r.name === 'string' ? r.name : '',
                    description:
                      typeof r.description === 'string' ? r.description : '',
                    defaultQuantity:
                      typeof r.defaultQuantity === 'number'
                        ? r.defaultQuantity
                        : 1,
                    aspectRatio:
                      typeof r.aspectRatio === 'string' &&
                      ['square', 'landscape', 'portrait'].includes(r.aspectRatio)
                        ? r.aspectRatio
                        : 'square',
                    transparentBackground:
                      typeof r.transparentBackground === 'boolean'
                        ? r.transparentBackground
                        : false,
                    promptHint:
                      typeof r.promptHint === 'string' ? r.promptHint : '',
                  };
                })
                .filter((v): v is NonNullable<typeof v> => v !== null && !!v.id)
                // 타입 강제 — sanitize 통과했다고 가정하고 as
                .map((v) => v as (typeof plan.aiItems)[number]);
            }
            if (
              !Object.keys(plan.itemState).length &&
              legacy.packageItemState &&
              typeof legacy.packageItemState === 'object' &&
              !Array.isArray(legacy.packageItemState)
            ) {
              plan.itemState = legacy.packageItemState as typeof plan.itemState;
            }
            if (
              !plan.userModifiedItemIds.length &&
              Array.isArray(legacy.packageUserModifiedItemIds)
            ) {
              plan.userModifiedItemIds = (
                legacy.packageUserModifiedItemIds as unknown[]
              ).filter((x): x is string => typeof x === 'string');
            }

            // 마지막으로 legacy flat 필드는 제거해 이후 오해 방지.
            delete legacy.packagePurpose;
            delete legacy.packageTopic;
            delete legacy.packageTarget;
            delete legacy.packageStyleTone;
            delete legacy.packageAdditionalRequest;
            delete legacy.packageAiKeywords;
            delete legacy.packageUserAddedKeywords;
            delete legacy.packageUserRemovedKeywords;
            delete legacy.packageAiItems;
            delete legacy.packageItemState;
            delete legacy.packageUserModifiedItemIds;
          });
        });
      },
    },
  ),
);
