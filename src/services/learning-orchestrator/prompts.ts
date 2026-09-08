// 자료유형별 프롬프트 템플릿. M1 은 객관식 + 개별활동지 2종만 완성.
// 시스템 프롬프트는 공통, 유저 프롬프트는 자료유형·학년·주제별로 파라미터화.

import type { Difficulty, Grade } from '@/services/learning-renderer/schema';

import { amountLabelForPrompt } from '@/features/learning-helper/domain/amount';
import { SUBJECT_LABEL, type SubjectCode } from '@/features/learning-helper/domain/subjects';
import type { MaterialTypeCode } from '@/features/learning-helper/domain/material-types';

export interface OrchestratorInput {
  grade: Grade;
  subject: SubjectCode;
  materialType: MaterialTypeCode;
  /** M2-1 (v0.5): 단원 (seed 기반 선택). AI 컨텍스트에 명시적으로 전달. */
  unit: string;
  topic: string;
  questionCount: number;
  difficulty: Difficulty;
  additionalRequest?: string;
}

// ============================================================
// 공통 시스템 프롬프트
// ============================================================
export function systemPrompt(input: OrchestratorInput): string {
  const subjectKo = SUBJECT_LABEL[input.subject];
  return [
    `너는 대한민국 2022 개정 교육과정 기준 초등학교 ${input.grade}학년 ${subjectKo} 교사다.`,
    `학년 수준에 맞는 어휘와 문장 길이를 엄격히 준수한다.`,
    ``,
    `학년별 어휘·문장 원칙:`,
    input.grade <= 2
      ? [
          `- 1~2학년: 한 문장 15자 이내 권장, 받침 있는 어려운 낱말은 피한다.`,
          `- 흉내 내는 말, 짧은 대화체를 적극 활용한다.`,
          `- 한자어보다 순우리말을 우선한다.`,
        ].join('\n')
      : input.grade <= 4
        ? [
            `- 3~4학년: 한 문장 25자 이내 권장, 문장 부호를 다양하게 사용한다.`,
            `- 접속어와 조사 사용을 늘리되 과하지 않게.`,
          ].join('\n')
        : [
            `- 5~6학년: 복문·중문 사용 가능, 한 문장 40자 이내.`,
            `- 개념어·한자어를 학년 수준에서 도입할 수 있다.`,
          ].join('\n'),
    ``,
    `절대 규칙:`,
    `- 특정 출판사 교과서 원문을 복제하지 않는다.`,
    `- 인물·역사·과학적 사실을 지어내지 않는다. 불확실하면 활동 위주로 구성한다.`,
    `- 학생이 상처받을 수 있는 예시(가정 형태·경제적 격차·특정 종교)를 피한다.`,
    `- 모든 문항에는 정답과 간단한 해설(rationale)을 answer-key 로 함께 만든다.`,
    ``,
    `출력 형식:`,
    `- 반드시 아래 JSON 스키마 그대로 응답한다. 마크다운·설명 없이 순수 JSON.`,
    `- section kind 유니온: heading | paragraph | callout | question | activity | table | answer-key`,
    `- image / rubric / slide-break kind 는 M1 에서는 사용하지 않는다.`,
    ``,
    schemaSpec(),
  ].join('\n');
}

// GPT 가 응답해야 하는 JSON 스키마 문서 (한국어 주석).
function schemaSpec(): string {
  return [
    `{`,
    `  "meta": {`,
    `    "title": "짧고 명확한 자료 제목 (예: '1학년 국어 · 낱말의 뜻 익히기')",`,
    `    "grade": 1~6,`,
    `    "subject": "KOR|MATH|INT|SOC|MOR|SCI|PRA|PE|MUS|ART|ENG|CREATIVE",`,
    `    "materialType": "multiple_choice|individual_worksheet|ox_quiz|concept_summary|reading_material",`,
    `    "difficulty": "easy|normal|hard",`,
    `    "estimatedMinutes": 10~40,`,
    `    "topic": "사용자가 입력한 주제 그대로 다시 기록",`,
    `    "teacherReviewRequired": true,`,
    `    "generatedAt": "ISO8601 문자열"`,
    `  },`,
    `  "sections": [`,
    `    { "kind": "heading", "level": 1|2|3, "text": "..." },`,
    `    { "kind": "paragraph", "text": "..." },`,
    `    { "kind": "callout", "tone": "info|warn|tip", "text": "..." },`,
    `    {`,
    `      "kind": "question",`,
    `      "qtype": "ox|mc|short|blank|essay",`,
    `      "number": 1,`,
    `      "stem": "문항 지문",`,
    `      "choices": ["...", "..."],       // qtype=mc 일 때 4개 권장`,
    `      "answer": "정답 (문자열)",`,
    `      "hint": "선택. 학생용 힌트"`,
    `    },`,
    `    {`,
    `      "kind": "activity",`,
    `      "title": "활동 이름 (선택)",`,
    `      "steps": ["단계 1", "단계 2", ...],`,
    `      "materials": ["준비물"],`,
    `      "estimatedMinutes": 10`,
    `    },`,
    `    {`,
    `      "kind": "table",`,
    `      "caption": "표 제목",`,
    `      "headers": ["열 제목", ...],`,
    `      "rows": [["셀", "셀"], ...]`,
    `    },`,
    `    {`,
    `      "kind": "answer-key",`,
    `      "entries": [{ "ref": "1", "answer": "...", "rationale": "..." }]`,
    `    },`,
    `    {`,
    `      "kind": "worksheet-table",  // 학생이 채워넣는 빈 표 — 개별 활동지 필수`,
    `      "headers": ["열 제목1", "열 제목2", "..."],`,
    `      "rowCount": 3,              // 빈 행 개수 (1~12)`,
    `      "caption": "선택 안내"`,
    `    },`,
    `    {`,
    `      "kind": "blank-space",      // 학생이 그리거나 꾸미는 사각형 — 개별 활동지 필수`,
    `      "prompt": "여기에 크게 그려 보세요",`,
    `      "heightRatio": 0.3          // 0.1~0.6 페이지 세로 비율`,
    `    }`,
    `  ]`,
    `}`,
  ].join('\n');
}

// ============================================================
// 자료유형별 사용자 프롬프트
// ============================================================
export function userPrompt(input: OrchestratorInput): string {
  const subjectKo = SUBJECT_LABEL[input.subject];
  // 자료유형별 amount 의미가 다르므로 사용자 노출용 라벨을 프롬프트에 그대로 반영.
  const amountLine = `요청 ${amountLabelForPrompt(input.materialType, input.questionCount)}`;
  const common = [
    `학년: ${input.grade}학년`,
    `과목: ${subjectKo}`,
    `단원: ${input.unit}`,
    `주제: ${input.topic}`,
    `난이도: ${input.difficulty}`,
    amountLine,
    input.additionalRequest ? `추가 요청: ${input.additionalRequest}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  switch (input.materialType) {
    case 'multiple_choice':
      return multipleChoicePrompt(input, common);
    case 'individual_activity':
      return individualActivityPrompt(input, common);
    case 'ox_quiz':
      return oxQuizPrompt(input, common);
    case 'concept_summary':
      return conceptSummaryPrompt(input, common);
    case 'reading_material':
      return readingMaterialPrompt(input, common);
    default:
      return `${common}\n\n객관식 문항 ${input.questionCount}개로 학습지를 만드세요.`;
  }
}

function multipleChoicePrompt(input: OrchestratorInput, common: string): string {
  return [
    common,
    ``,
    `자료 유형: 객관식 학습지`,
    ``,
    `필수 규칙:`,
    `- sections 배열의 첫 항목은 heading level 1 (자료 제목). 제목에 단원명과 주제를 자연스럽게 포함.`,
    `- 다음은 학습 안내 callout (tone: info) 로 학생에게 어떻게 풀지 안내`,
    `- 이어서 question kind 를 반드시 정확히 ${input.questionCount}개 (qtype: mc). 더도 덜도 안 됨.`,
    `- 각 문항은 stem + choices 4개 + answer + rationale 필수`,
    `- 각 문항의 number 필드는 1부터 ${input.questionCount}까지 순서대로 지정`,
    `- choices 는 오답도 그럴듯하게 (무성의한 오답 금지)`,
    `- 문항끼리 stem 이 서로 달라야 함 (중복 문항 금지)`,
    `- meta.materialType = "multiple_choice"`,
    `- 마지막 section 은 answer-key kind 하나로 모든 문항 정답·해설 집약 (entries 개수 = 문항 수)`,
    ``,
    input.grade <= 2
      ? `1~2학년이므로 각 stem 은 15자 이내, choices 는 6자 이내로 짧게.`
      : `문항 지문·선택지는 학년 수준에 맞춰 길이 조절.`,
  ].join('\n');
}

function individualActivityPrompt(input: OrchestratorInput, common: string): string {
  const activityCount = input.questionCount; // 개별 활동지에서는 활동 수 의미
  return [
    common,
    ``,
    `자료 유형: 개별 활동지 (학생이 종이에 직접 작성하는 워크시트)`,
    ``,
    `핵심 원칙:`,
    `- 이 자료는 활동 설명만 있는 게 아니라 학생이 직접 채우고 그리는 실제 워크시트.`,
    `- 각 활동은 아래 구성을 반드시 포함:`,
    `  1) heading level 2 (활동 이름)`,
    `  2) paragraph 1개로 짧은 활동 안내 (30자 이내)`,
    `  3) activity kind (steps 2~4단계) 로 진행 방법 안내`,
    `  4) worksheet-table kind — 학생이 채워넣는 빈 표. headers 는 활동에 맞게 (예: "찾은 장소" / "찾은 글자" / "글자를 써 보세요"), rowCount 3~5`,
    `  5) blank-space kind — 학생이 크게 그리거나 꾸미는 사각형 (prompt 에 안내 문구). 그리기·꾸미기 활동일 때 필수, 아닐 땐 생략 가능`,
    ``,
    `필수 규칙:`,
    `- sections 배열의 첫 항목은 heading level 1 (자료 제목)`,
    `- callout (tone: tip) 로 학생 격려 메시지 1개`,
    `- 위 구성을 정확히 ${activityCount}개의 활동으로 반복`,
    `- meta.materialType = "individual_worksheet"`,
    `- answer-key kind 는 사용하지 않음 (개별 활동지는 정답이 없음)`,
    ``,
    input.grade <= 2
      ? `1~2학년이므로 각 step / 표 헤더 / blank-space prompt 는 12자 이내. 준비물은 학교에 흔한 것만 (색연필·가위·풀 등).`
      : `학년 수준에 맞춰 절차·헤더 문구를 상세화.`,
  ].join('\n');
}

function oxQuizPrompt(input: OrchestratorInput, common: string): string {
  return [
    common,
    ``,
    `자료 유형: OX 퀴즈`,
    ``,
    `필수 규칙:`,
    `- heading level 1 + info callout + question(qtype: ox) 반드시 정확히 ${input.questionCount}개 + answer-key`,
    `- 각 문항의 number 는 1부터 ${input.questionCount}까지 순서대로`,
    `- 문항끼리 stem 이 서로 다름 (중복 금지)`,
    `- 각 answer 는 "O" 또는 "X"`,
    `- meta.materialType = "ox_quiz"`,
  ].join('\n');
}

function conceptSummaryPrompt(input: OrchestratorInput, common: string): string {
  return [
    common,
    ``,
    `자료 유형: 개념 정리`,
    ``,
    `필수 규칙:`,
    `- heading + heading level 2 로 소단원 3개 이하 + 각 소단원마다 paragraph·callout·table 중 적절히`,
    `- 마지막에 짧은 short 문항 2~3개로 확인`,
    `- meta.materialType = "concept_summary"`,
  ].join('\n');
}

function readingMaterialPrompt(input: OrchestratorInput, common: string): string {
  return [
    common,
    ``,
    `자료 유형: 읽기 자료`,
    ``,
    `필수 규칙:`,
    `- heading + 짧은 이야기·설명 paragraph 3~6개`,
    `- 이야기 뒤 short/mc 확인 문항 3개 + answer-key`,
    `- meta.materialType = "reading_material"`,
    ``,
    input.grade <= 2 ? `1~2학년이므로 총 글자 수 300자 이내.` : `학년 수준에 맞춰 400~800자.`,
  ].join('\n');
}

// ============================================================
// 추천 3개 프롬프트 (별도 저비용 호출)
// ============================================================
export function recommendationSystemPrompt(): string {
  return [
    `너는 대한민국 초등 교육과정 전문가다.`,
    `학년·과목·자료유형이 주어지면 그에 맞는 단원·주제 3가지를 서로 다른 성격으로 제안한다:`,
    `  1) 교육과정 기본형 — 표준 단원 그대로`,
    `  2) 실생활 연결형 — 학생 일상과 연결된 응용 주제`,
    `  3) 탐구·확장형 — 학생이 직접 관찰·조사하는 주제`,
    ``,
    `출력은 반드시 아래 JSON 만:`,
    `{ "recommendations": [`,
    `  { "type": "basic",     "unit": "...", "topic": "...", "reason": "..." },`,
    `  { "type": "realworld", "unit": "...", "topic": "...", "reason": "..." },`,
    `  { "type": "inquiry",   "unit": "...", "topic": "...", "reason": "..." }`,
    `] }`,
    ``,
    `- unit: 단원명 (10자 이내)`,
    `- topic: 학습 주제 (20자 이내)`,
    `- reason: 이 주제가 왜 이 학년에 적합한지 (30자 이내)`,
  ].join('\n');
}

export function recommendationUserPrompt(
  grade: Grade,
  subject: SubjectCode,
  materialType: MaterialTypeCode,
  hintTopics: Array<{ unit: string; topic: string }>,
): string {
  return [
    `학년: ${grade}학년`,
    `과목: ${SUBJECT_LABEL[subject]}`,
    `자료유형: ${materialType}`,
    hintTopics.length > 0
      ? `참고할 만한 이 학년 대표 주제 (교육과정 seed):\n${hintTopics
          .map((t) => `- ${t.unit}: ${t.topic}`)
          .join('\n')}`
      : ``,
    ``,
    `위 정보에 맞춰 세 가지 성격의 주제를 제안하라.`,
  ]
    .filter(Boolean)
    .join('\n');
}
