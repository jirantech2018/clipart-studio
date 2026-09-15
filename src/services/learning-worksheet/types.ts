// WorksheetPlan — Stage 4 활동형 학습지 조판 계획.
//
// ContentPlan (무엇을 학습하고 평가할지) 과 LearningDocument (실제 sections) 사이에
// "그것을 어떤 활동과 지면 구성으로 표현할지" 계획을 두는 계층이다.

export type ActivityType =
  | 'picture-choice'
  | 'matching'
  | 'classification'
  | 'fill-blank'
  | 'writing-grid'
  | 'guided-practice'
  | 'independent-practice'
  | 'sequence'
  | 'observation'
  | 'open-response';

export interface LearningFlowStage {
  id: string;
  role: 'warmup' | 'guided' | 'practice' | 'assessment' | 'reflection';
  goal: string;
  /** 이 단계에 배치될 WorksheetBlock 의 blockId 목록. */
  blockIds: string[];
}

export interface VisualRequirement {
  /** 이 블록이 이미지를 필요로 하는가. */
  needed: boolean;
  /** 필요할 때: 이미지 개수 (기본 1). */
  count?: number;
  /** 이미지가 이 블록 안에서 담당할 역할 (선택지 그림 / 관찰 대상 / 참고 삽화 등). */
  role?: 'choice' | 'observation' | 'illustration' | 'reference';
  /** subjectMatter 는 VisualPlan 생성 단계에서 결정. */
  hint?: string;
}

export interface ResponseAreaPlan {
  /** 응답 공간 유형. */
  type: 'lines' | 'grid' | 'box' | 'connect' | 'select' | 'buckets' | 'none';
  /** lines/grid: 줄/칸 수. */
  count?: number;
  /** box: 높이 비율 (0.1~0.6). */
  heightRatio?: number;
}

export interface LayoutHint {
  /** 페이지 가로 폭 기준 이 블록이 차지할 폭 비율 (0.4~1.0). */
  widthFraction: number;
  /** 최소 세로 높이 (mm) — 조판 엔진이 페이지 분할 시 참고. */
  minHeightMm?: number;
  /** 다음 블록과 붙여둘지 힌트 (같은 페이지에 함께 두기 강제). */
  keepWithNext?: boolean;
}

export interface TeacherOverlayPlan {
  /** 교사용 자료에만 노출되는 정답·해설·지도 포인트. */
  answerNote?: string;
  guidanceNote?: string;
}

export interface WorksheetBlock {
  blockId: string;
  /** 이 블록이 다루는 ContentPlan.itemId 리스트 (하나 이상). 감사·추적용. */
  sourceItemIds: string[];
  activityType: ActivityType;
  /** 이 블록이 학습 흐름에서 담당하는 역할 (warmup / guided / practice / assessment / reflection). */
  learningRole: LearningFlowStage['role'];
  /** 학생에게 보일 지시문. */
  instruction: string;
  responseArea: ResponseAreaPlan;
  visualRequirement: VisualRequirement;
  layoutHint: LayoutHint;
  teacherOverlay?: TeacherOverlayPlan;
  /** activityType 별 세부 데이터 (스키마는 유형별 다름). Doc 단계에서 사용. */
  detail?: Record<string, unknown>;
}

export interface WorksheetPagePlan {
  pageId: string;
  pageNumber: number;
  /** 이 페이지가 담당하는 학습 목적 요약. */
  purpose: string;
  layout: 'single-column' | 'two-column' | 'grid' | 'mixed';
  blocks: WorksheetBlock[];
}

export interface WorksheetDesignSystem {
  /** 기본 폰트 크기 (11pt~13pt). */
  bodyFontSize: number;
  /** 페이지 여백 (mm). */
  pageMarginMm: number;
  /** 블록 사이 간격 (mm). */
  blockGapMm: number;
  /** 정답 칸 색상 (학생용에서 표시). */
  answerBoxColor: string;
  /** 대비 색상 (제목·강조). */
  accentColor: string;
  /** 카드 모서리 반경 (pt). */
  cardRadiusPt: number;
}

export interface WorksheetPlan {
  version: 'v1';
  title: string;
  subtitle?: string;
  estimatedMinutes: number;
  learningFlow: LearningFlowStage[];
  designSystem: WorksheetDesignSystem;
  pages: WorksheetPagePlan[];
  studentInstructions: string[];
  teacherNotes?: string[];
}

export const DEFAULT_DESIGN_SYSTEM: WorksheetDesignSystem = {
  bodyFontSize: 11,
  pageMarginMm: 18,
  blockGapMm: 6,
  answerBoxColor: '#f5f7ff',
  accentColor: '#2d2f77',
  cardRadiusPt: 6,
};
