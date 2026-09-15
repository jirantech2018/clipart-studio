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
    }
  // Stage 4: 활동형 학습지 블록 (범용 · 과목 무관).
  // ---
  // 학습자 상단 정보란 (이름/날짜/반).
  | {
      kind: 'student-header';
      /** 학생이 채워야 할 필드. 기본 ['이름', '날짜']. */
      fields: string[];
    }
  // 그림/보기 중 선택. 각 선택지에 이미지 URL 가능 (선택지 이미지).
  | {
      kind: 'picture-choice';
      itemId?: string;
      number?: number;
      stem: string;
      choices: Array<{ label: string; imageAssetRef?: string; imageCaption?: string }>;
      /** 정답 index (1-based, 문자열). */
      answer: string;
      hint?: string;
      teacherNote?: string;
    }
  // 좌우 두 컬럼 연결. 학생은 선을 그어 짝을 맞춘다.
  | {
      kind: 'matching';
      itemId?: string;
      number?: number;
      stem: string;
      leftColumn: Array<{ id: string; text?: string; imageAssetRef?: string }>;
      rightColumn: Array<{ id: string; text?: string; imageAssetRef?: string }>;
      /** 정답 짝: [leftId, rightId] */
      correctPairs: Array<[string, string]>;
      teacherNote?: string;
    }
  // 기준별 분류 (버킷).
  | {
      kind: 'classification';
      itemId?: string;
      number?: number;
      stem: string;
      categories: string[];
      items: Array<{
        id: string;
        text?: string;
        imageAssetRef?: string;
        correctCategory: string;
      }>;
      teacherNote?: string;
    }
  // 빈칸 채우기 (낱말/문장/식). template 안의 __ 가 빈칸 위치.
  | {
      kind: 'fill-blank';
      itemId?: string;
      number?: number;
      stem: string;
      sentences: Array<{ template: string; answers: string[] }>;
      teacherNote?: string;
    }
  // 격자 쓰기 (따라 쓰기 · 네모칸 · 원고지 · 라인).
  | {
      kind: 'writing-grid';
      itemId?: string;
      number?: number;
      stem: string;
      gridType: 'square' | 'lined' | 'manuscript';
      cellsPerRow: number;
      rowCount: number;
      /** 흐린 안내글 (따라쓰기용, 선택). */
      tracingText?: string;
      teacherNote?: string;
    }
  // 워크드 예시 + 학생 연습.
  | {
      kind: 'guided-practice';
      itemId?: string;
      number?: number;
      stem: string;
      workedExample: {
        problem: string;
        solutionSteps: string[];
        imageAssetRef?: string;
      };
      practiceProblems: Array<{
        problem: string;
        answer?: string;
        imageAssetRef?: string;
      }>;
      teacherNote?: string;
    }
  // 학생이 도움 없이 수행하는 문제 목록.
  | {
      kind: 'independent-practice';
      itemId?: string;
      number?: number;
      stem: string;
      problems: Array<{
        problem: string;
        answer?: string;
        imageAssetRef?: string;
        answerSpaceLines?: number;
      }>;
      teacherNote?: string;
    }
  // 순서 배열: 무작위 항목을 올바른 순서로 정렬.
  | {
      kind: 'sequence';
      itemId?: string;
      number?: number;
      stem: string;
      items: Array<{ id: string; text?: string; imageAssetRef?: string }>;
      correctOrder: string[]; // items.id 순서
      teacherNote?: string;
    }
  // 관찰 문항: 큰 이미지 + 관찰 유도 질문.
  | {
      kind: 'observation';
      itemId?: string;
      number?: number;
      stem: string;
      imageAssetRef: string;
      imageCaption?: string;
      observationPrompts: Array<{ prompt: string; answer?: string }>;
      teacherNote?: string;
    }
  // 개방형 응답 (자유 쓰기/그리기).
  | {
      kind: 'open-response';
      itemId?: string;
      number?: number;
      stem: string;
      /** 응답 공간 유형. */
      responseMode: 'lines' | 'box' | 'both';
      /** 줄 수 (lines/both 일 때). */
      lineCount?: number;
      /** 사각형 높이 비율 (box/both 일 때). */
      boxHeightRatio?: number;
      teacherNote?: string;
    }
  // 페이지 브레이크 힌트 (PDF 조판이 새 페이지 강제).
  | {
      kind: 'page-break';
      reason?: string;
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
