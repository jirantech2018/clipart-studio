// Content plan + review types (원칙 §4 / §6).
//
// 이 파일은 특정 과목·단원·주제를 언급하지 않는다. 모든 필드는 요청마다 동적으로
// 채워지는 GenerationContext 로부터 파생된다.

/**
 * Hint 계획 — 원칙 §4 (힌트가 필요한지 자체를 계획한다).
 *
 * 학습 목표에 따라 힌트가 태생적으로 정답을 시사하게 되는 경우 (자모·음운 인식,
 * 이름·용어 회상, 관찰 지문의 직접 관찰 등) 는 needed=false 로 결정하고 hint 필드
 * 자체를 생성하지 않는다. 이 판정은 요청마다 Plan 단계 AI 가 하며 특정 교과 문자열에
 * 의존하지 않는다.
 */
export interface HintPlan {
  /** 이 item 에 힌트가 교육적으로 필요한가. */
  needed: boolean;
  /**
   * 필요할 때: 학생의 어떤 사고 과정을 지원할지 (예: "선택지들이 어떤 축에서 다른지
   * 비교하도록 유도"). 특정 단어·정답·동의어 없이 사고 방법만 서술.
   */
  strategy?: string;
  /**
   * 왜 이 결정을 내렸는지: needed=false 면 "이 목표에서 힌트는 정답을 시사하게 됨"
   * 같은 이유. needed=true 면 힌트가 어떤 사고를 도와야 하는지 근거.
   */
  rationale: string;
}

export interface ItemBlueprint {
  /** 안정 식별자 (q_01, act_02, ...). 재생성·검수·병합의 앵커. */
  itemId: string;
  /** 이 item 이 평가하거나 훈련하는 학습 목표 문장. */
  intendedLearning: string;
  /** 학생이 실제로 수행할 사고 또는 행동. */
  studentTask: string;
  /** 문항 형식 (문항계, 활동계, 표, 빈칸 등). */
  itemFormat: string;
  /** 문항 안에 반드시 제시해야 할 정보 (self-contained 조건). */
  informationInsideItem: string;
  /** 정답 또는 성공을 판단하는 관찰 가능한 기준. */
  successCriterion: string;
  /** 오답 또는 어려움이 어떤 형태여야 교육적으로 타당한지 설명. */
  distractorDesignPrinciple: string;
  /** 힌트 계획 — needed / strategy? / rationale. hintRole 문자열을 대체. */
  hintPlan: HintPlan;
  /** 왜 이 학년 수준에 적합한지. */
  gradeSuitabilityReason: string;
  /** 다른 아이템과 구별되는 역할 (반복 방지). */
  distinctRoleFromOthers: string;
  /** 난이도 근거. */
  difficultyReason: string;
}

export interface ContentPlan {
  /** 이 자료 전체의 학습 목표 해석. */
  interpretedGoal: string;
  /** 이 학년 학생이 이미 안다고 가정할 수 있는 것들. */
  learnerAssumptions: string[];
  /** 각 아이템의 blueprint. 길이 = request.amount. */
  itemBlueprints: ItemBlueprint[];
  /** 아이템 전체가 학습 목표를 어떻게 커버하는지 요약. */
  coverageSummary: string;
}

export interface SemanticReviewItem {
  itemIndex: number;
  itemId: string;
  pass: boolean;
  /** 판정에 사용된 기준 키 (goalCoverage, selfContained, hintQuality, ...). */
  criteria: string[];
  reason: string;
  /** 실패 시 재생성 지시 문구. 원본 blueprint 를 유지하면서 어떤 부분을 고칠지. */
  repairInstruction: string;
}

export interface SemanticReviewResult {
  pass: boolean;
  reason: string;
  failedItemIndexes: number[];
  items: SemanticReviewItem[];
  /** AI 검수 자체가 실패(호출 오류 등) 했을 때는 서비스 지속을 위해 pass=true 로
   *  두되 이 필드로 그 사실을 기록한다. handler 가 이를 감시해 실제로 부분 재생성
   *  없이 진행할지 판단. */
  reviewerFailure?: { code: string; message: string };
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface PipelineTelemetry {
  contextBuildMs: number;
  planMs: number;
  docMs: number;
  reviewMs: number;
  repairMs?: number;
  reviewMs2?: number;
  totalMs: number;
  planTokens?: { in: number; out: number };
  docTokens?: { in: number; out: number };
  reviewTokens?: { in: number; out: number };
  repairTokens?: { in: number; out: number };
}
