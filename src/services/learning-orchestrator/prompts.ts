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
// M2-1.5: subject/topic 기반 프롬프트 라우팅용 헬퍼
// ============================================================
const JAMO_KEYWORDS = ['자음', '모음', '자모', '한글', '초성', '중성', '종성', '낱자', '자음자', '모음자'];

/** 국어 자모(자음·모음) 관련 topic 인지 판정. multipleChoicePrompt 의 자모 예시 포함 여부 결정. */
export function isJamoRelatedTopic(unit: string, topic: string): boolean {
  const combined = `${unit} ${topic}`;
  return JAMO_KEYWORDS.some((k) => combined.includes(k));
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

// ============================================================
// 객관식 프롬프트 공통 규칙 (subject 무관)
// ============================================================
function commonMcRules(input: OrchestratorInput): string {
  return [
    `필수 규칙 (모두 지킬 것):`,
    `- sections 배열의 첫 항목은 heading level 1 (자료 제목). 제목·본문 문항이 반드시 단원 "${input.unit}" · 주제 "${input.topic}" 과 일치.`,
    `- 다음은 학습 안내 callout (tone: info)`,
    `- question kind 를 반드시 정확히 ${input.questionCount}개 (qtype: mc). 더도 덜도 안 됨.`,
    `- 각 문항은 stem + choices 4개 + answer + rationale 필수`,
    `- 각 문항의 number 필드는 1부터 ${input.questionCount}까지 순서대로`,
    `- meta.materialType = "multiple_choice"`,
    `- 마지막 section 은 answer-key kind (entries 수 = 문항 수)`,
    ``,
    `★ 정답 정합성 (매우 중요, 서버가 코드로 검증):`,
    `- 각 문항에는 정답이 정확히 1개만 존재해야 한다.`,
    `- 오답 선택지는 정답 조건을 절대로 만족하지 않아야 한다.`,
    `- answer 필드에는 정답 선택지의 "1"~"4" 번호만 (문자열) 넣는다.`,
    `  잘못된 예: answer="2번", "모두", "가·나". 올바른 예: answer="2".`,
    `- 문항끼리 stem 이 서로 다름. 선택지 중 실질적으로 같은 항목 (공백/구두점 제외 후 동일) 금지.`,
    ``,
    `★ 세트 단위 다양성 (서버가 코드로 검증):`,
    `- ${input.questionCount}문항의 정답 내용이 서로 달라야 함 (같은 정답이 절반 초과 X).`,
    `- 문항 stem 표현을 최소 2가지 이상 섞기.`,
    `- 인접 두 문항의 선택지 배열이 완전히 같으면 안 됨.`,
    ``,
    `★ 힌트 정책:`,
    `- 힌트는 개념 설명·관찰 포인트여야 하며, 이전 문항 답을 참조하는 방식 금지.`,
    `- 금지 문구: "앞의 문제와 같아요.", "'X'와 비슷해요.", "앞에서 나온 답과 같아요."`,
    ``,
    input.grade <= 2
      ? `1~2학년이므로 각 stem 은 15자 이내, choices 는 6자 이내로 짧게. "갯수" 는 "개수" 로 (표준어).`
      : `문항 지문·선택지는 학년 수준에 맞춰 길이 조절. "갯수" 는 "개수" 로 (표준어).`,
  ].join('\n');
}

// ============================================================
// 국어 자모(자음·모음) 특화 규칙 — 국어 + 자모 관련 topic 에만 부착
// ============================================================
function jamoMcRules(input: OrchestratorInput): string {
  return [
    `★ 한글 자음·모음 유형 특별 규칙 (이 자료는 자모 학습이므로 반드시 아래 형식):`,
    `- 문항이 "특정 자모 (예: ㅏ, ㅜ, ㄱ, ㄴ) 가 들어간 글자를 고르세요" 라면:`,
    `  · 정답 선택지만 그 자모를 포함, 나머지 3개는 절대 포함하지 않아야 한다.`,
    `  · 잘못된 예 (금지): "ㅏ가 있는 글자는?" 선택지 [가, 나, 다, 라]  ← 모두 ㅏ 포함, 정답 4개`,
    `  · 올바른 예: "모음 ㅏ가 들어간 글자를 고르세요." 선택지 [가, 고, 구, 기], 정답 "1"`,
    `- 힌트는 다음 규칙 정확히:`,
    `  · 초성 문제 → "글자의 첫소리를 살펴보세요."`,
    `  · 중성 문제 → "글자의 가운데소리를 살펴보세요." (절대 "첫소리·시작 소리·끝소리" 사용 금지)`,
    `  · 종성 문제 → "글자의 받침 (끝소리) 을 살펴보세요."`,
    `- 자모 다양성: ${input.questionCount}문항 모두 서로 다른 자모를 다룰 것.`,
    `  잘못된 예: 5문항 모두 ㅏ. 올바른 예: 1번=ㅏ, 2번=ㅓ, 3번=ㅗ, 4번=ㅜ, 5번=ㅣ`,
  ].join('\n');
}

// ============================================================
// 국어 (자모가 아닌 topic) — 낱말·문장·이해·읽기·쓰기
// ============================================================
function koreanGeneralMcRules(input: OrchestratorInput): string {
  return [
    `★ 국어 문항 유형 지침 (이 자료는 자모 학습이 아니므로 자모 예시를 절대 사용 금지):`,
    `- 자음·모음·초성·중성·종성·받침 관련 문항 금지. 학생이 낱말·문장·이야기 수준에서 답할 수 있어야 함.`,
    `- 주제 "${input.topic}" 에 맞는 문항 유형 예시:`,
    `  · 낱말의 뜻: "다음 낱말과 뜻이 가장 비슷한 것은?" / "빈칸에 알맞은 낱말은?"`,
    `  · 사물 이름 읽기: 실제 사물 이름 (연필, 지우개, 사과 …) 을 stem 에 등장시켜 "어떤 사물의 이름인가요?" / "이 사물의 이름을 바르게 읽은 것은?"`,
    `  · 문장 이해: 짧은 문장을 stem 에 제시하고 "이 문장에서 알 수 있는 것은?" / "빈칸에 알맞은 말은?"`,
    `  · 흉내 내는 말: "‘꼬끼오’ 는 어떤 소리를 흉내 낸 말인가요?"`,
    `- 각 문항은 실제 낱말·문장·상황을 stem 에 포함해야 하며 낱글자 자모 식별로 대체 금지.`,
  ].join('\n');
}

// ============================================================
// 수학 — 수 세기 · 비교 · 덧셈 · 뺄셈 · 곱셈 · 도형 · 측정
// ============================================================
function mathMcRules(input: OrchestratorInput): string {
  return [
    `★ 수학 문항 유형 지침 (한글 자모 관련 문항은 절대 금지, 서버가 거부):`,
    `- stem 에 자모(ㅏ, ㅜ, ㄱ 등) 나 "모음", "자음", "초성", "받침" 같은 단어를 넣으면 안 된다.`,
    `- 주제 "${input.topic}" 에 맞는 수학 문항 유형 예시:`,
    `  · 수 세기: "사과가 ○개 있어요. 몇 개인가요?" 선택지는 숫자.`,
    `  · 수의 크기 비교: "12 와 21 중 더 큰 수는?" / "다음 중 가장 큰 수는?"`,
    `  · 덧셈: "3 + 4 = ?" / "친구 2명이 사탕을 3개씩 나눠 가지면 모두 몇 개?"`,
    `  · 뺄셈: "7 - 2 = ?"`,
    `  · 곱셈 (2학년): "5 × 3 = ?" / "한 접시에 3개씩, 접시 4개면 모두 몇 개?"`,
    `  · 도형: "다음 중 세모 모양은?" (선택지는 도형 이름)`,
    `  · 길이 비교 등`,
    `- 각 문항은 실제 수·계산·상황을 stem 에 포함. 답 선택지도 숫자·계산 결과·도형·양 관련.`,
  ].join('\n');
}

function multipleChoicePrompt(input: OrchestratorInput, common: string): string {
  const parts: string[] = [common, ``, `자료 유형: 객관식 학습지`, ``, commonMcRules(input)];

  if (input.subject === 'MATH') {
    parts.push(``, mathMcRules(input));
  } else if (input.subject === 'KOR') {
    if (isJamoRelatedTopic(input.unit, input.topic)) {
      parts.push(``, jamoMcRules(input));
    } else {
      parts.push(``, koreanGeneralMcRules(input));
    }
  }

  return parts.join('\n');
}

function individualActivityPrompt(input: OrchestratorInput, common: string): string {
  const activityCount = input.questionCount;
  const subjectGuidance = individualActivitySubjectGuidance(input);
  return [
    common,
    ``,
    `자료 유형: 개별 활동지 (학생이 종이에 직접 작성하는 워크시트)`,
    ``,
    `핵심 원칙:`,
    `- 이 자료는 활동 설명만 있는 게 아니라 학생이 실제로 채우고 그리는 워크시트.`,
    `- 학생은 제공된 정보 (문항·상황·표) 만으로 활동을 완주할 수 있어야 한다.`,
    `- 이미지 없이 "그림을 봐요" · "가게 그림을 봐요" 같은 지시 금지 — 대신 상황을 문장으로 완전히 서술.`,
    ``,
    `각 활동은 아래 구성을 반드시 포함:`,
    `  1) heading level 2 (활동 이름)`,
    `  2) paragraph 1개로 짧은 활동 안내 (30자 이내)`,
    `  3) activity kind (steps 2~4단계) 로 진행 방법 안내`,
    `  4) 문제·상황이 미리 채워진 콘텐츠 (table 또는 paragraph). 학생이 채울 열은 빈 문자열로. 예: table rows [["27+15", ""], ["36+28", ""]]`,
    `  5) 선택: worksheet-table kind — 학생 자유 관찰/수집용 빈 표 (headers + rowCount). 이미 문제가 table 로 제공됐다면 생략 가능`,
    `  6) 선택: blank-space kind — 그리기·꾸미기 성격 활동일 때만`,
    ``,
    `필수 규칙:`,
    `- sections 배열의 첫 항목은 heading level 1 (자료 제목)`,
    `- callout (tone: tip) 로 학생 격려 메시지 1개`,
    `- 위 구성을 정확히 ${activityCount}개의 활동으로 반복`,
    `- meta.materialType = "individual_worksheet"`,
    `- answer-key kind 는 사용하지 않음`,
    `- 표기법: "갯수" 는 잘못된 표기. 반드시 "개수" 로.`,
    ``,
    subjectGuidance,
    ``,
    `★ 주제 무관 활동 금지:`,
    `- "친구에게 물어보기", "가족에게 물어보기", "선생님께 여쭤보기" 같은 활동은 주제와 직접 관련이 있을 때만 넣는다.`,
    `- 활동 채우기용으로 무관한 사회적 활동을 자동 삽입 금지.`,
    ``,
    `★ 1~2학년 쓰기 활동 규칙:`,
    input.grade <= 2
      ? [
          `- 1~2학년 학생은 아직 긴 글쓰기가 어렵다.`,
          `- 여러 개의 "이유"·"까닭"·"느낌"을 자유롭게 쓰게 하기보다는 문장 틀을 제공.`,
          `  예: 나는 ______을/를 좋아해요.  좋아하는 까닭은 ______이에요.`,
          `  아직 쓰기 어려우면 그림으로 표현해도 된다는 안내 (callout tone=tip) 를 활동 안내에 포함.`,
          `- 각 step / 표 헤더 / blank-space prompt 는 12자 이내.`,
          `- 준비물은 학교에 흔한 것만 (색연필·가위·풀 등).`,
        ].join('\n')
      : `학년 수준에 맞춰 절차·헤더 문구를 상세화.`,
  ].join('\n');
}

/** 개별 활동지에서 subject 별 콘텐츠 완결성 지침. */
function individualActivitySubjectGuidance(input: OrchestratorInput): string {
  if (input.subject === 'MATH') {
    return [
      `★ 수학 활동지 콘텐츠 완결성 (매우 중요, 서버가 거부 가능):`,
      `- 계산 문제는 실제 수식·상황이 stem/표에 채워져 있어야 함. 빈 표만 주고 "풀어보세요" 는 금지.`,
      `- 덧셈·뺄셈 예: table headers=["문제","받아올림","답"], rows=[["27+15","",""], ["36+28","",""], ["45+19","",""]] — 문제 열은 실제 수식으로, 계산·답 열은 빈 문자열.`,
      `- 곱셈·상황 문제 예: paragraph 로 "사과가 한 접시에 3개씩 있어요. 접시가 4개라면 사과는 모두 몇 개?" 처럼 완결된 문장 제공 → worksheet-table 로 학생 답변 칸.`,
      `- 도형·측정: 이미지 없이 풀 수 있게 상황을 문장으로 서술 (예: "네모 모양 물건 3가지를 떠올려 쓰세요").`,
      `- 자모·모음·자음 관련 문항 절대 금지 (자모는 국어 자료임).`,
    ].join('\n');
  }
  if (input.subject === 'KOR') {
    const isJamo = isJamoRelatedTopic(input.unit, input.topic);
    if (isJamo) {
      return [
        `★ 국어 자모 활동지 콘텐츠:`,
        `- 학생이 실제로 자모를 관찰·수집할 수 있는 활동. 예: 특정 자모를 포함한 낱말 찾기, 자모를 크게 따라 쓰기.`,
        `- worksheet-table headers 예: ["찾은 낱말","포함된 자모","그림"]`,
      ].join('\n');
    }
    return [
      `★ 국어 활동지 콘텐츠 (자모 아님):`,
      `- 자음·모음·초성·중성·종성 관련 활동 금지.`,
      `- 주제가 창작·표현·이야기이면 실제 창작 요소를 반드시 포함:`,
      `  · 빈칸이 있는 짧은 동시 완성하기 (paragraph 로 시의 일부를 제시하고 worksheet-table 로 빈 행)`,
      `  · 흉내 내는 말로 문장 만들기`,
      `  · 2~4행의 짧은 동시 짓기`,
      `- 관찰만으로 끝내지 말고 학생이 낱말·문장·짧은 글을 실제로 산출하도록 유도.`,
    ].join('\n');
  }
  return '';
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
