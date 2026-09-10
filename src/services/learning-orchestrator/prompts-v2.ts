// V2 공통 프롬프트 (원칙 §2 / §4 / §5).
//
// 원칙:
//   - subject·domain·unit·topic 값은 GenerationContext 그대로 프롬프트에 삽입.
//   - if (subject === 'MATH') 같은 코드 분기 없음.
//   - 자료유형별 함수 분기 없음.
//   - 특정 예시 문구·금지어·정답 하드코드 없음.
//
// 담당 프롬프트:
//   - v2SystemPromptCommon: 모든 단계 공통 시스템 프롬프트
//   - v2UserPromptContentPlan: Plan 생성 유저 프롬프트
//   - v2UserPromptDocumentFromPlan: Plan 기반 Document 생성 유저 프롬프트
//   - v2UserPromptRepairItem: 실패 item 부분 재생성 유저 프롬프트
//   - v2UserPromptSingleShot: 레거시 단일 호출 (fallback, 사용 안 함)

import type { GenerationContext } from '@/services/learning-generation/context-builder';
import type { ContentPlan, ItemBlueprint } from '@/services/learning-generation/types';

// ============================================================
// Common system prompt (subject-invariant)
// ============================================================
export function v2SystemPromptCommon(): string {
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
    `공통 원칙:`,
    `1. curriculum.allowedScope 밖 개념·연산·주제·소재를 도입하지 않는다.`,
    `2. curriculum.excludedScope 를 등장시키지 않는다.`,
    `3. learner 정보를 활용하되 아직 배우지 않은 개념을 전제하지 않는다.`,
    `4. material 정보 (type, typeLabel) 가 자료 형태를 알려준다 — 그 형태에 맞게 구성한다.`,
    `5. 학년 어휘·특정 종교·가정 형태·경제적 격차 언급을 피한다.`,
    `6. 특정 출판사 교과서 원문을 복제하지 않는다.`,
    `7. 인물·역사·과학적 사실을 지어내지 않는다.`,
    ``,
    `출력 형식:`,
    `- 반드시 요청된 JSON 스키마만 반환. 마크다운·설명·주석 없음.`,
    `- 응답 앞뒤에 다른 텍스트를 넣지 않는다.`,
  ].join('\n');
}

// ============================================================
// 1) ContentPlan generation (원칙 §4)
// ============================================================
export function v2UserPromptContentPlan(context: GenerationContext): string {
  return [
    `아래 GenerationContext 를 기준으로 ContentPlan(JSON)만 응답하라.`,
    ``,
    `<GenerationContext>`,
    JSON.stringify(context, null, 2),
    `</GenerationContext>`,
    ``,
    `ContentPlan 스키마:`,
    `{`,
    `  "interpretedGoal": "이 자료로 무엇을 확인/훈련하려는지 한 문장",`,
    `  "learnerAssumptions": ["이 학년 학생이 이미 안다고 가정할 수 있는 것"],`,
    `  "itemBlueprints": [`,
    `    {`,
    `      "itemId": "q_01" | "act_01" | ...,`,
    `      "intendedLearning": "이 아이템이 다루는 학습 지점",`,
    `      "studentTask": "학생이 실제로 할 사고 또는 행동",`,
    `      "itemFormat": "문항 형식 (객관식 4지선다 / 활동 단계 / ...)",`,
    `      "informationInsideItem": "문항 안에 반드시 제시해야 할 정보 (self-contained 조건)",`,
    `      "successCriterion": "정답 또는 성공 판단 기준 (관찰 가능하게)",`,
    `      "distractorDesignPrinciple": "오답이 어떤 형태여야 교육적으로 타당한지",`,
    `      "hintRole": "힌트가 도와야 할 사고 방법 (답을 담지 않도록)",`,
    `      "gradeSuitabilityReason": "학년 적합성 근거",`,
    `      "distinctRoleFromOthers": "다른 아이템과 구별되는 역할",`,
    `      "difficultyReason": "난이도 근거"`,
    `    }`,
    `  ],`,
    `  "coverageSummary": "전체 아이템이 학습 목표를 어떻게 분산해서 커버하는지 요약"`,
    `}`,
    ``,
    `요구:`,
    `- itemBlueprints 개수는 request.amount 와 정확히 같아야 한다.`,
    `- 문항 계열 자료유형이면 itemId 접두어는 "q_", 활동 계열이면 "act_" 를 사용.`,
    `- 각 blueprint 의 distinctRoleFromOthers 가 실제로 다른 역할이어야 한다 (동일 유형 반복 금지).`,
    `- successCriterion 은 "정답 문자열" 이 아니라 "무엇을 관찰하면 성공인가" 를 서술한다.`,
    `- hintRole 은 정답 그 자체·정의·동의어를 담지 않도록 명시한다.`,
    ``,
    `순수 JSON만. 마크다운·설명 금지.`,
  ].join('\n');
}

// ============================================================
// 2) Document generation from Plan (원칙 §5)
// ============================================================
export function v2UserPromptDocumentFromPlan(
  context: GenerationContext,
  plan: ContentPlan,
): string {
  return [
    `아래 GenerationContext 와 ContentPlan 을 바탕으로 LearningDocument(JSON)만 응답하라.`,
    ``,
    `<GenerationContext>`,
    JSON.stringify(context, null, 2),
    `</GenerationContext>`,
    ``,
    `<ContentPlan (이미 승인됨)>`,
    JSON.stringify(plan, null, 2),
    `</ContentPlan>`,
    ``,
    v2DocumentSchemaSpec(),
    ``,
    `구현 규칙:`,
    `- 각 itemBlueprint 의 itemId 를 실제 section 의 itemId 로 그대로 사용한다.`,
    `- 각 문항·활동은 blueprint 의 studentTask / informationInsideItem / successCriterion 을 구현한다.`,
    `- 오답 선택지는 blueprint 의 distractorDesignPrinciple 에 따라 설계한다.`,
    `- 힌트는 blueprint 의 hintRole 을 따르며 정답 그 자체·정의·동의어를 담지 않는다.`,
    `- 반환 전에 스스로 다음을 확인한다:`,
    `  · 모든 문항이 blueprint 와 연결되는가`,
    `  · 각 문항을 실제 학생처럼 풀어봤을 때 successCriterion 이 결정 가능한가`,
    `  · 오답·힌트가 설계 원칙과 일치하는가`,
    `  · 문항 간 역할이 실제로 구별되는가`,
    `- 하나라도 어긋나면 응답 직전에 스스로 다시 만든다.`,
    ``,
    `출력은 순수 JSON. 마크다운·설명 금지.`,
  ].join('\n');
}

// ============================================================
// 3) Repair a single item (원칙 §7)
// ============================================================
export function v2UserPromptRepairItem(
  context: GenerationContext,
  plan: ContentPlan,
  blueprint: ItemBlueprint,
  originalItemJson: unknown,
  reviewReason: string,
  repairInstruction: string,
): string {
  return [
    `아래 GenerationContext, ContentPlan, 원래 blueprint, 원래 생성된 item, 검수 지시를`,
    `기준으로 이 item 하나만 재작성한 결과를 JSON 으로 응답하라.`,
    ``,
    `<GenerationContext>`,
    JSON.stringify(context, null, 2),
    `</GenerationContext>`,
    ``,
    `<ContentPlan>`,
    JSON.stringify(plan, null, 2),
    `</ContentPlan>`,
    ``,
    `<BlueprintToPreserve>`,
    JSON.stringify(blueprint, null, 2),
    `</BlueprintToPreserve>`,
    ``,
    `<OriginalItem>`,
    JSON.stringify(originalItemJson, null, 2),
    `</OriginalItem>`,
    ``,
    `<ReviewReason>`,
    reviewReason,
    `</ReviewReason>`,
    ``,
    `<RepairInstruction>`,
    repairInstruction,
    `</RepairInstruction>`,
    ``,
    `규칙:`,
    `- BlueprintToPreserve 의 intendedLearning / studentTask / itemFormat / successCriterion /`,
    `  distractorDesignPrinciple / hintRole / gradeSuitabilityReason / distinctRoleFromOthers`,
    `  / difficultyReason 은 그대로 유지한다.`,
    `- ReviewReason 이 지적한 문제만 RepairInstruction 대로 고친다.`,
    `- itemId 는 BlueprintToPreserve.itemId 와 반드시 같게 유지한다.`,
    `- 새로운 금지어 목록·조건문·특정 사례 예외를 도입하지 않는다.`,
    ``,
    `응답은 단 하나의 section 객체 JSON. 배열이 아니라 객체 하나.`,
    `예: { "kind": "question", "itemId": "q_02", ... } 형식.`,
    `마크다운·설명 금지.`,
  ].join('\n');
}

// ============================================================
// Legacy: single-shot (variant C, 지금 사용 안 함)
// ============================================================
export function v2UserPromptSingleShot(context: GenerationContext): string {
  return [
    `아래 GenerationContext 를 기준으로 LearningDocument(JSON)만 응답하라.`,
    ``,
    `<GenerationContext>`,
    JSON.stringify(context, null, 2),
    `</GenerationContext>`,
    ``,
    v2DocumentSchemaSpec(),
    ``,
    `순수 JSON만. 마크다운·설명 금지.`,
  ].join('\n');
}

// ============================================================
// LearningDocument JSON 스키마 안내 (공통)
// ============================================================
function v2DocumentSchemaSpec(): string {
  return [
    `LearningDocument 스키마:`,
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
    `sections 항목 종류:`,
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
    ``,
    `첫 section 은 반드시 heading level 1 (자료 제목, curriculum.unit·curriculum.topic 반영).`,
  ].join('\n');
}

// Backward-compat: 기존 이름 유지
export const v2SystemPrompt = v2SystemPromptCommon;
