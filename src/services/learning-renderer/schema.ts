// LearningDocument SoT — 세 렌더러(pdf/docx/pptx) 가 공유하는 산출물 스키마.
//
// AI 응답 → 이 스키마 → (pdf | docx | pptx) 로 파생.
// 렌더러는 순수 변환 함수. 새 자료유형이 생기면 sections 의 kind 유니온을 확장하고
// 세 렌더러가 각자 케이스를 추가한다.

export type Grade = 1 | 2 | 3 | 4 | 5 | 6;

export type Subject =
  | 'KOR'
  | 'MATH'
  | 'INT'
  | 'SOC'
  | 'MOR'
  | 'SCI'
  | 'PRA'
  | 'PE'
  | 'MUS'
  | 'ART'
  | 'ENG'
  | 'CREATIVE';

export type MaterialType =
  | 'ox_quiz'
  | 'multiple_choice'
  | 'short_answer'
  | 'fill_blank'
  | 'essay'
  | 'mixed_workbook'
  | 'formative_eval'
  | 'unit_eval'
  | 'concept_summary'
  | 'reading_material'
  | 'individual_worksheet'
  | 'group_worksheet'
  | 'discussion'
  | 'inquiry_observation'
  | 'creative_expression'
  | 'review_worksheet'
  | 'opening_question'
  | 'teacher_prompt'
  | 'lesson_plan'
  | 'performance_task'
  | 'rubric'
  | 'model_answer'
  | 'emotional_activity';

export type Difficulty = 'easy' | 'normal' | 'hard';

// 산출물의 논리적 블록. 세 렌더러가 각자 이 배열을 순회한다.
//
// itemId (M2-1.8): 부분 재생성 대상 지정용 안정 식별자. question / activity /
//   worksheet-table / blank-space / table 등 재생성 가능 블록에 orchestrator 가
//   자동 부여 ("q_01", "act_02" 등). 렌더러는 이 필드를 사용하지 않음.
export type Section =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'callout'; tone: 'info' | 'warn' | 'tip'; text: string }
  | {
      kind: 'question';
      itemId?: string;
      qtype: 'ox' | 'mc' | 'short' | 'blank' | 'essay';
      /** 문항 번호 표시용 (렌더러가 자동 번호매김도 가능하지만 SoT 우선). */
      number?: number;
      stem: string;
      choices?: string[];
      /** answer 는 렌더러가 학생 배포용이면 숨기고 교사용/모범답안 섹션에만 노출. */
      answer?: string;
      hint?: string;
    }
  | {
      kind: 'activity';
      itemId?: string;
      /** 활동 이름 (예: "모둠 관찰 활동"). */
      title?: string;
      steps: string[];
      /** 준비물 목록 (선택). */
      materials?: string[];
      /** 예상 소요 시간 (분). */
      estimatedMinutes?: number;
    }
  | {
      kind: 'table';
      itemId?: string;
      headers?: string[];
      rows: string[][];
      caption?: string;
    }
  | {
      kind: 'image';
      /** clipart 는 기존 clipart-studio library, ai 는 즉석 생성, external 은 URL. */
      source: 'clipart' | 'ai' | 'external';
      /** clipart = image id, ai = generation id, external = URL. */
      assetRef: string;
      caption?: string;
      widthPct?: number; // 페이지 폭 기준 %, 기본 60
    }
  | {
      kind: 'answer-key';
      /** answer-key 섹션은 세 렌더러 모두 문서 끝(또는 별도 슬라이드/문서) 로 이동. */
      entries: Array<{ ref: string; answer: string; rationale?: string }>;
    }
  | {
      kind: 'rubric';
      criteria: Array<{
        criterion: string;
        levels: string[]; // e.g. ['우수', '보통', '노력 필요'] 순서 그대로.
      }>;
    }
  | {
      kind: 'slide-break';
      /** pptx 렌더러가 새 슬라이드를 강제로 시작하도록 AI 가 제안. 다른 렌더러는 무시.
       *  최종 슬라이드 분할은 pptx 렌더러가 글자 수·문항 수·레이아웃 기준으로 결정하며
       *  이 마커는 힌트로만 사용한다 (D-12 확정). */
      reason?: string;
    }
  // M2-1.1: 개별 활동지용 학생 작성 요소.
  | {
      /** 학생이 채워넣을 표. headers + rowCount 만큼의 빈 행이 렌더된다. */
      kind: 'worksheet-table';
      itemId?: string;
      headers: string[];
      /** 빈 행의 개수 (기본 3, 최대 12). */
      rowCount: number;
      caption?: string;
    }
  | {
      /** 학생이 그리거나 크게 쓸 수 있는 사각형 빈 공간. */
      kind: 'blank-space';
      itemId?: string;
      /** 안내 문구 (예: "여기에 크게 그려 보세요"). */
      prompt?: string;
      /** 페이지 폭 기준 세로 높이 비율 (0.1~0.6, 기본 0.3). PDF 렌더러가 실제 mm 로 변환. */
      heightRatio?: number;
    };

export interface LearningDocumentMeta {
  title: string;
  grade: Grade;
  subject: Subject;
  materialType: MaterialType;
  difficulty: Difficulty;
  /** 수업 40분 등 예상 사용 시간. */
  estimatedMinutes?: number;
  /** 사용자가 입력하거나 AI 가 추천한 공통 학습 주제. */
  topic?: string;
  /** 항상 true — 산출물 상단 안내 배지 표시용. */
  teacherReviewRequired: true;
  /** 생성 시각 (footer 표시용). */
  generatedAt: string;
}

export interface LearningDocument {
  meta: LearningDocumentMeta;
  sections: Section[];
}
