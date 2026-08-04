// /api/package-plan 요청/응답 및 store 상태 공용 타입.
//
// Category 는 서버가 canonical whitelist 로 정규화한다. 새 목적이 늘어나면
// PACKAGE_CATEGORIES 배열에 새 카테고리를 추가하는 것만으로 확장 가능한
// registry 구조를 유지한다 (enum union 이 아니라 array 기반 whitelist).
//
// 각 항목은 UI 표시용 name/description 외에 Phase 2 프롬프트 조립에 필요한
// aspectRatio / transparentBackground / promptHint 를 함께 가지고 다닌다.
// Phase 1 UI 는 이 세 필드를 표시하지 않지만 응답 · store · 템플릿까지
// 일관되게 유지해 Phase 2 착수 시 그대로 사용할 수 있게 한다.

/** 결과물 카테고리 whitelist. 새 카테고리는 이 배열에만 추가하면 된다. */
export const PACKAGE_CATEGORIES = [
  'cover',
  'poster',
  'banner',
  'illustration',
  'scene',
  'icon',
  'decoration',
  'border',
  'divider',
  'background',
  'monthly_image',
  'event_asset',
  'calendar',
  'certificate',
  'award',
  'etc',
] as const;

export type PackageCategory = (typeof PACKAGE_CATEGORIES)[number];

/** 결과물 종횡비 힌트. AspectRatio 와 별개로 관리 (패키지 전용 확장 여지). */
export const PACKAGE_ASPECT_RATIOS = [
  'square',
  'landscape',
  'portrait',
] as const;

export type PackageAspectRatio = (typeof PACKAGE_ASPECT_RATIOS)[number];

/**
 * 활용 목적 (usage channel) — 결과물이 최종적으로 쓰일 매체/형태.
 *
 * 기존 `purpose` (독서 행사·운동회 등 이벤트 카테고리) 와 별개.
 * 사용자는 복수 선택하고, AI 는 선택된 매체에 맞춰 결과물 종류·비율·수량·
 * promptHint 를 보정한다. 새 항목은 이 배열에만 추가하면 registry 로 확장.
 */
export const USAGE_CHANNELS = [
  '학교신문',
  '학급문집',
  '가정통신문',
  '교수학습 자료',
  '발표자료(PPT)',
  '리플렛',
  '포스터',
  '학교 홈페이지',
  'SNS',
  '현수막',
] as const;

export type UsageChannel = (typeof USAGE_CHANNELS)[number];

/** AI 추천 항목 원본. 사용자가 편집하지 않은 상태의 recommendation. */
export interface PackageAiItem {
  /** 서버가 정한 안정적 id (category + slug). AI 가 임의로 만들지 못한다. */
  id: string;
  category: PackageCategory;
  name: string;
  description: string;
  defaultQuantity: number;
  /** Phase 2 프롬프트 조립용. 결과물 특성상 어울리는 종횡비. */
  aspectRatio: PackageAspectRatio;
  /** Phase 2 프롬프트 조립용. 아이콘/장식 등 배경 투명이 자연스러운 항목. */
  transparentBackground: boolean;
  /** Phase 2 프롬프트 조립용. 결과물의 성격을 짧게 설명. */
  promptHint: string;
}

/** 사용자 로컬 편집 상태 — packagePlan.itemState[id] 로 저장. */
export interface PackageItemState {
  enabled: boolean;
  quantity: number;
}

/** BlockOptions 안에 nested 로 보관되는 패키지 계획 상태 전체. */
export interface PackagePlanState {
  purpose: string;
  topicOrEvent: string;
  target: string;
  styleTone: string;
  additionalRequest: string;
  /** 결과물 매체 (복수 선택). 예: ['포스터','학교 홈페이지','SNS']. */
  usageChannels: UsageChannel[];
  aiKeywords: string[];
  userAddedKeywords: string[];
  userRemovedKeywords: string[];
  aiItems: PackageAiItem[];
  itemState: Record<string, PackageItemState>;
  userModifiedItemIds: string[];
}

/** Client → server 요청 payload. */
export interface PackagePlanRequest {
  purpose: string;
  topicOrEvent: string;
  target: string;
  styleTone: string;
  additionalRequest: string;
  usageChannels: UsageChannel[];
  userAddedKeywords: string[];
  userRemovedKeywords: string[];
}

/** Server → client 응답 payload (apiOk wrap 이후 `data` 필드). */
export interface PackagePlanResponse {
  keywords: string[];
  items: PackageAiItem[];
  source: 'ai' | 'template' | 'fallback';
}

/** PackagePlanState 초기 빈 값. store DEFAULT_OPTIONS 와 rehydrate 에서 재사용. */
export function emptyPackagePlanState(): PackagePlanState {
  return {
    purpose: '',
    topicOrEvent: '',
    target: '',
    styleTone: '',
    additionalRequest: '',
    usageChannels: [],
    aiKeywords: [],
    userAddedKeywords: [],
    userRemovedKeywords: [],
    aiItems: [],
    itemState: {},
    userModifiedItemIds: [],
  };
}
