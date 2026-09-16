// PageCompositionPlan — WorksheetPlan 과 LearningDocument 사이의 페이지 조판 계층.
//
// WorksheetPlan 은 학습 흐름·활동 배열까지 계획. PageCompositionPlan 은 그 활동을
// A4 지면에 어떤 layout primitive 로, 어느 컬럼·어느 순서·어떤 이미지 배치·어떤 답안
// 공간으로 배치할지를 구조화된 JSON 으로 확정한다.
//
// 렌더러는 이 계획을 직접 읽고 실행하며, 계획 밖의 값을 스스로 추가하지 않는다.

/**
 * Primitive 목록.
 * 이름만 다르고 외형이 같은 구현은 인정하지 않는다 — 각 primitive 는 정보 배치,
 * 컬럼 구조, 이미지 위치, 답안 공간, 학생 시선 흐름, 학생 행동이 실제로 달라야 한다.
 */
export type LayoutPrimitive =
  | 'instruction-strip'    // 상단 지시 밴드 (짧은 안내 + 필요 시 예시 이미지)
  | 'concept-panel'         // 개념 요약 카드 (제목 + 설명 + 시각 참고)
  | 'example-panel'         // 워크드 예시 (문제 + 단계별 풀이)
  | 'matching-board'        // 좌우 컬럼 매칭 (연결선 유도)
  | 'choice-grid'           // 선택지 그리드 (그림/텍스트 선택)
  | 'image-observation'     // 큰 이미지 + 관찰 유도 질문
  | 'compare-panel'         // 좌우 비교 (2 대상 나란히)
  | 'sequence-steps'        // 순서 나열 (좌→우 또는 상→하)
  | 'writing-practice'      // 격자 쓰기 (원고지·네모칸·라인)
  | 'calculation-practice'  // 세로 계산 (수식 + 답 칸)
  | 'open-response'         // 자유 응답 (박스·라인)
  | 'reflection-strip'      // 하단 자기 점검 스트립
  | 'visual-canvas';        // 큰 그림 캔버스 (전체 폭)

export type LayoutKey = 'single' | 'split' | 'grid' | 'sequence' | 'canvas';

export type Density = 'low' | 'medium' | 'high';

/**
 * 문서 전체 전략. 학습 흐름·시각 위계·페이지 목표·디자인 방향을 명시.
 * 색상 팔레트가 아니라 "구성 방향" 을 담는다.
 */
export interface DocumentStrategy {
  /** 학습 흐름 요약 (예: "관찰 → 안내 예시 → 반복 연습 → 자기 표현"). */
  learningFlow: string;
  /** 시각 위계 방향 (예: "제목/이미지/답안 순으로 정보 계단"). */
  visualHierarchy: string;
  /** 페이지 밀도. */
  density: Density;
  /** 목표 페이지 수. */
  pageTarget: number;
  /** 디자인 방향 요약 (예: "밝은 파스텔 · 학년별 큰 글자 · 카드 최소화"). */
  designDirection: string;
  /** 왜 이 조합을 선택했는지 근거. */
  designRationale: string;
}

/**
 * 블록의 페이지 내 배치 지점.
 * 렌더러는 이 정보를 직접 CSS grid/flex 로 실행.
 */
export interface Placement {
  /** 몇 번째 컬럼 (1-based). */
  column: number;
  /** 이 블록이 컬럼 폭에서 차지할 비율 (0.3~1.0). 컬럼 병합 표현. */
  widthFraction: number;
  /** 컬럼 안에서의 순서 (1-based). */
  order: number;
  /** 병합 컬럼 span (기본 1). */
  columnSpan?: number;
}

/**
 * 활동 블록의 시각 자료 슬롯. VisualPlan/이미지 생성 결과가 여기에 삽입.
 */
export interface VisualSlotPlan {
  needed: boolean;
  /** 이 이미지가 담당할 교육 역할. */
  role?: 'observation' | 'choice' | 'illustration' | 'reference' | 'process';
  /** primitive 안에서 이미지가 놓일 위치. */
  placement?: 'inline' | 'side' | 'background' | 'choice-grid' | 'top' | 'bottom';
  /** primitive 폭 대비 이미지 폭 비율 (0.15~1.0). */
  widthFraction?: number;
  /** 필요 이미지 수 (선택지 그리드 등). 기본 1. */
  count?: number;
  /** VisualPlan 을 위해 생성 힌트 (subjectMatter 서술). */
  hint?: string;
}

/**
 * 답안 공간 유형과 크기.
 */
export interface ResponseSpacePlan {
  type: 'none' | 'line' | 'box' | 'grid' | 'manuscript' | 'drawing';
  size?: 'small' | 'medium' | 'large';
  /** grid/manuscript 셀 수 (필요 시). */
  cells?: number;
  /** 라인 수 (line 일 때). */
  lines?: number;
}

/**
 * PageCompositionPlan 의 최소 단위. 한 activity 또는 정보 블록의 배치 계획.
 * WorksheetBlock 과 1:1 매칭되지만, layout 관점의 정보를 갖는다.
 */
export interface CompositionBlock {
  blockId: string;
  /** 이 블록이 다루는 ContentPlan.itemBlueprints[].itemId 목록. 다수 가능. */
  sourceItemIds: string[];
  /** 렌더러가 사용할 primitive (13종 중 하나). */
  primitive: LayoutPrimitive;
  /** 학생에게 보일 지시문. */
  instruction: string;
  /** 페이지 내 배치. */
  placement: Placement;
  /** 렌더 전 예측 높이 (mm). 조판 엔진이 페이지 분할·이동 결정에 사용. */
  estimatedHeightMm: number;
  /** 이 블록의 이미지 슬롯. */
  visualSlot: VisualSlotPlan;
  /** 학생 답안 공간. */
  responseSpace: ResponseSpacePlan;
  /** 교사용 answer/guidance 오버레이 (선택). */
  teacherOverlay?: {
    answerNote?: string;
    guidanceNote?: string;
  };
}

export interface CompositionPage {
  pageId: string;
  pageNumber: number;
  /** 이 페이지의 학습 목적 (짧은 문장). */
  purpose: string;
  /** 페이지 layout 유형. renderer 가 CSS grid template 을 결정. */
  layout: LayoutKey;
  /** 컬럼 개수 (1~3). single/canvas 는 1, split 은 2, grid 는 2~3. */
  columns: number;
  blocks: CompositionBlock[];
}

export interface PageCompositionPlan {
  version: 'v1';
  documentStrategy: DocumentStrategy;
  pages: CompositionPage[];
}

/**
 * 렌더러가 실제 적용한 composition 스냅샷 — 감사·재현·Layout Review 입력용.
 */
export interface AppliedComposition {
  compositionPlan: PageCompositionPlan;
  /** blockId → 실제 렌더된 section itemId (변경됐다면). */
  blockToSectionId: Record<string, string>;
  /** blockId → 이 블록에 배치된 이미지 URL (visualSlot.needed 인 경우). */
  blockToImageUrls: Record<string, string[]>;
  /** 사전 조판이 예측한 페이지별 사용 높이 비율 (0~1). */
  predictedPageFillRatio: number[];
}
