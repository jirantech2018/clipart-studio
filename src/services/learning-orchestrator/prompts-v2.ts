// V2 공통 프롬프트 (subject/topic 분기 없음, 데이터 전달만).
//
// 원칙:
//   - subject·domain·unit·topic 값은 GenerationContext 그대로 프롬프트에 삽입.
//   - if (subject === 'MATH') 같은 코드 분기 없음.
//   - 자료유형별 함수 분기 없음 — 자료유형 정보는 context.material.type/typeLabel 로 전달.
//   - 특정 예시 문구·금지어 하드코드 없음.
//
// 이 파일이 담당하는 것: subject-invariant 시스템 프롬프트 1개 + 유저 프롬프트 1개
// (변형 C — 단일 호출로 LearningDocument 반환).
//
// 변형 A/B (ContentPlan + Document) 는 후속 추가 예정.

import type { GenerationContext } from '@/services/learning-generation/context-builder';

// ============================================================
// System prompt — subject-invariant
// ============================================================
export function v2SystemPrompt(): string {
  return [
    `너는 대한민국 2022 개정 교육과정 기준 초등학교 교사의 자료 생성 조수다.`,
    ``,
    `주어진 GenerationContext 는 학생·교과·자료유형·요청·품질 루브릭을 포함한다.`,
    `- learner: 학년·어휘 수준·명시적 선수학습`,
    `- curriculum: 학습 목표·핵심 개념·허용 범위·제외 범위·프로필 체인`,
    `- material: 자료유형과 라벨`,
    `- request: 수량·난이도·추가 지시`,
    `- qualityRubric: 산출물이 만족해야 할 범용 루브릭`,
    ``,
    `원칙:`,
    `1. curriculum.allowedScope 밖 개념·연산·주제·소재를 도입하지 않는다.`,
    `2. curriculum.excludedScope 를 등장시키지 않는다.`,
    `3. learner 정보를 활용하되 아직 배우지 않은 개념을 전제하지 않는다.`,
    `4. material 정보 (type, typeLabel) 가 자료 형태를 알려준다 — 그 형태에 맞게 sections 를 구성한다.`,
    `5. 학년 어휘·특정 종교·가정 형태·경제적 격차 언급을 피한다.`,
    `6. 특정 출판사 교과서 원문을 복제하지 않는다.`,
    `7. 인물·역사·과학적 사실을 지어내지 않는다.`,
    `8. 모든 재생성 가능 블록 (question / activity / worksheet-table / blank-space) 에 안정 itemId (q_01, act_01 등) 를 부여.`,
    `9. 객관식 문항: 정답은 정확히 1개, 각 문항에 answer 필드는 정답 선택지의 번호("1"~"4") 만.`,
    `10. 학생용 이해 가능성이 최우선. 힌트는 방향만 안내하고 정답을 그대로 담지 않는다.`,
    ``,
    `출력 형식:`,
    `- 반드시 아래 JSON 스키마만 반환. 마크다운·설명·주석 없음.`,
    `- 최상위 키: meta, sections`,
    ``,
    v2SchemaSpec(),
  ].join('\n');
}

// LearningDocument JSON 스키마 (기존 렌더러 schema.ts 와 동일 구조, subject-invariant 설명).
function v2SchemaSpec(): string {
  return [
    `{`,
    `  "meta": {`,
    `    "title": "짧고 명확한 자료 제목",`,
    `    "grade": 1~6,`,
    `    "subject": "curriculum.subject 값 그대로",`,
    `    "materialType": "material.type 값 그대로",`,
    `    "difficulty": "request.difficulty 값 그대로",`,
    `    "estimatedMinutes": 10~40,`,
    `    "topic": "curriculum.unit · curriculum.topic",`,
    `    "teacherReviewRequired": true,`,
    `    "generatedAt": "ISO8601"`,
    `  },`,
    `  "sections": [ ...섹션 배열... ]`,
    `}`,
    ``,
    `sections 항목 종류 (자료유형에 맞게 선택 조합):`,
    `- { "kind": "heading", "level": 1|2|3, "text": "..." }`,
    `- { "kind": "paragraph", "text": "..." }`,
    `- { "kind": "callout", "tone": "info"|"warn"|"tip", "text": "..." }`,
    `- { "kind": "question", "itemId": "q_01", "qtype": "ox"|"mc"|"short"|"blank"|"essay",`,
    `    "number": 1, "stem": "...", "choices": [...], "answer": "1", "hint": "..." }`,
    `- { "kind": "activity", "itemId": "act_01", "title": "...", "steps": [...],`,
    `    "materials": [...], "estimatedMinutes": 10 }`,
    `- { "kind": "table", "itemId": "tbl_01", "headers": [...], "rows": [[...]], "caption": "..." }`,
    `- { "kind": "worksheet-table", "itemId": "ws_01", "headers": [...], "rowCount": 3, "caption": "..." }`,
    `- { "kind": "blank-space", "itemId": "bs_01", "prompt": "...", "heightRatio": 0.3 }`,
    `- { "kind": "answer-key", "entries": [{"ref":"1","answer":"...","rationale":"..."}] }`,
  ].join('\n');
}

// ============================================================
// User prompt (variant C — 단일 호출, subject-invariant)
// ============================================================
export function v2UserPromptSingleShot(context: GenerationContext): string {
  return [
    `아래 GenerationContext 를 기준으로 LearningDocument(JSON)만 응답하라.`,
    ``,
    `<GenerationContext>`,
    JSON.stringify(context, null, 2),
    `</GenerationContext>`,
    ``,
    `요구:`,
    `- request.amount (${context.request.amount}) 와 정확히 같은 개수의 재생성 가능 블록을 생성.`,
    `  자료유형이 문항 계열 (multiple_choice, ox_quiz, short_answer, fill_blank) 이면 question 블록.`,
    `  자료유형이 활동 계열 (individual_activity, individual_worksheet, group_worksheet) 이면 activity 블록.`,
    `- 각 재생성 가능 블록은 안정 itemId 부여 (예: "q_01", "act_01").`,
    `- 첫 section 은 heading level 1 (자료 제목, curriculum.unit·curriculum.topic 반영).`,
    `- meta.subject 는 curriculum.subject 값 그대로, meta.materialType 은 material.type 값 그대로.`,
    `- qualityRubric.criteria 를 만족하도록 스스로 점검한 후 응답.`,
    ``,
    `순수 JSON만. 마크다운·설명 금지.`,
  ].join('\n');
}
