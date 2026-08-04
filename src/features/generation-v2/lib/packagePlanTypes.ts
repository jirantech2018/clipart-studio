// /api/package-plan 요청/응답 및 store 상태 공용 타입.
//
// Category 는 서버가 canonical whitelist 로 정규화한다. AI 가 아무 카테고리나
// 반환하지 못하도록 서버에서 매핑 · 병합 · 필터링한 뒤 client 로 내려온다.

export type PackageCategory =
  | 'cover'
  | 'poster'
  | 'banner'
  | 'illustration'
  | 'scene'
  | 'icon'
  | 'decoration'
  | 'border'
  | 'divider'
  | 'background'
  | 'monthly_image'
  | 'event_asset'
  | 'etc';

export const PACKAGE_CATEGORIES: ReadonlyArray<PackageCategory> = [
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
  'etc',
];

/** AI 추천 항목 원본. 사용자가 편집하지 않은 상태의 recommendation. */
export interface PackageAiItem {
  /** 서버가 정한 안정적 id (category + slug). AI 가 임의로 만들지 못한다. */
  id: string;
  category: PackageCategory;
  name: string;
  description: string;
  defaultQuantity: number;
}

/** 사용자 로컬 편집 상태 — packageItemState[id] 로 저장. */
export interface PackageItemState {
  enabled: boolean;
  quantity: number;
}

/** Client → server 요청 payload. */
export interface PackagePlanRequest {
  purpose: string;
  topicOrEvent: string;
  target: string;
  styleTone: string;
  additionalRequest: string;
  userAddedKeywords: string[];
  userRemovedKeywords: string[];
}

/** Server → client 응답 payload (apiOk wrap 이후 `data` 필드). */
export interface PackagePlanResponse {
  keywords: string[];
  items: PackageAiItem[];
  source: 'ai' | 'template' | 'fallback';
}
