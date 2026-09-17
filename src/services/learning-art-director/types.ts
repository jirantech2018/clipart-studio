// Stage 4.2 — Hybrid Art Direction 계약.
//
// 원칙 (지시서 §3, §4, §15):
//   - 절대 좌표 금지. x/y/width/height percentage, pixel 위치 모두 금지.
//   - PageArtDirection 은 페이지 구성의 의미와 시각적 역할만 표현.
//   - block/instruction/activity 분할 금지. 한 blockId 는 한 번만.
//   - vision 은 이 계약 안에서만 응답. 새 blockId 생성 금지.
//   - renderer 는 이 계약을 CSS 변수 + modifier class + Grid/Flex 규칙으로 적용.
//     실제 크기·배치·페이지 분할은 콘텐츠를 아는 renderer 가 결정.

export type LayoutIntent =
  | 'stacked'
  | 'image-left-response-right'
  | 'image-right-response-left'
  | 'image-top-response-bottom'
  | 'balanced-split'
  | 'activity-grid'
  | 'hero-then-practice'
  | 'comparison-pair'
  | 'sequence-flow';

export type EmphasisLevel = 'low' | 'medium' | 'high' | 'hero';
export type SizeLevel = 'small' | 'medium' | 'large' | 'hero';
export type DensityLevel = 'airy' | 'comfortable' | 'compact';
export type CardEmphasis = 'none' | 'soft' | 'primary' | 'contrast';
export type DecorationLevel = 'minimal' | 'soft' | 'playful';

export interface PageArtDirection {
  version: '1.0';
  pageId: string;
  /** 스타일 계열 (예: "soft-pastel", "high-contrast-classic" 등 자유 문자열). 캐시 키로도 사용. */
  styleFamily: string;
  pageIntent: LayoutIntent;
  density: DensityLevel;
  decorationLevel: DecorationLevel;
  /** blockId 순서 (읽기 순서). validBlockIds 부분집합. */
  readingOrder: string[];
  paletteRoles: {
    pageBackground: string;
    surface: string;
    surfaceAlt: string;
    primary: string;
    secondary: string;
    accent: string;
    textPrimary: string;
    textSecondary: string;
    answerArea: string;
    border: string;
  };
  typographyRoles: {
    displayScale: SizeLevel;
    instructionScale: SizeLevel;
    bodyScale: 'small' | 'medium' | 'large';
    weightContrast: 'soft' | 'clear' | 'strong';
  };
  shapeRoles: {
    radiusScale: 'small' | 'medium' | 'large';
    badgeStyle: 'circle' | 'pill' | 'rounded-square';
    borderStyle: 'none' | 'soft' | 'clear';
    shadowLevel: 'none' | 'soft';
  };
  blocks: BlockArtDirection[];
}

export interface BlockArtDirection {
  sourceBlockId: string;
  layoutIntent: LayoutIntent;
  hierarchy: EmphasisLevel;
  imageScale: SizeLevel;
  responseSpace: 'none' | 'small' | 'medium' | 'large';
  cardEmphasis: CardEmphasis;
  preferredColumns?: 1 | 2 | 3 | 4;
  imagePosition?: 'top' | 'left' | 'right' | 'inline';
  decorationRole?: 'none' | 'badge' | 'soft-shape' | 'divider';
}

// Vision 실패 · 계약 위반 시 활용될 판정.
export interface DirectionContractReport {
  pass: boolean;
  missingBlockIds: string[];
  duplicateBlockIds: string[];
  unknownBlockIds: string[];
  hasReadingOrder: boolean;
}

// 렌더러 최종 입력 (composition + document + 이미지 + art direction).
export interface HybridRenderInput {
  compositionPlan: import('@/services/learning-composition').PageCompositionPlan;
  document: import('@/services/learning-renderer/schema').LearningDocument;
  blockToImages: Map<string, string[]>;
  /** 페이지별 art direction. 특정 페이지에 없으면 renderer 가 Stage 4.1 fallback 을 사용. */
  directionByPage: Map<string, PageArtDirection>;
}

// Reference 대응 감사 (지시서 §9.3).
export type ReferenceAdherence = 'applied' | 'partially-applied' | 'not-applied';
export interface ReferenceAdherenceReport {
  pageId: string;
  palette: ReferenceAdherence;
  typography: ReferenceAdherence;
  badge: ReferenceAdherence;
  card: ReferenceAdherence;
  imageScale: ReferenceAdherence;
  responseSpace: ReferenceAdherence;
  layoutIntent: ReferenceAdherence;
  decoration: ReferenceAdherence;
}

// 페이지 밀도 지표 (지시서 §9.2).
export interface PageDensityMetrics {
  pageIndex: number;
  usedContentAreaRatio: number;
  largestEmptyRegionRatio: number;
  responseSpaceRatio: number;
  visualAssetAreaRatio: number;
  topHalfUsageRatio: number;
  bottomHalfUsageRatio: number;
}

// 구조/완전성 게이트 (지시서 §9.1). 하나라도 감지되면 hard fail.
export type HybridQualityIssueCode =
  | 'ABSOLUTE_ACTIVITY_POSITIONING_USED'
  | 'BLOCK_CLIPPED'
  | 'BLOCK_OVERLAPPED'
  | 'BLOCK_RENDERED_TWICE'
  | 'UNKNOWN_ART_DIRECTION_BLOCK_ID'
  | 'CONTENT_CHANGED_BY_ART_DIRECTION'
  | 'MIN_FONT_SIZE_VIOLATED'
  | 'RESPONSE_SPACE_COLLAPSED';

export interface HybridQualityIssue {
  code: HybridQualityIssueCode;
  where: string;
  detail: string;
}
