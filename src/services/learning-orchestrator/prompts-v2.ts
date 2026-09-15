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
import type { WorksheetPlan } from '@/services/learning-worksheet';

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
    `      "hintPlan": {`,
    `        "needed": true|false,`,
    `        "strategy": "needed=true 일 때만: 학생 사고를 어떻게 지원할지 (특정 단어·정답·동의어 없이 사고 방법만)",`,
    `        "rationale": "이 결정을 내린 이유"`,
    `      },`,
    `      "gradeSuitabilityReason": "학년 적합성 근거",`,
    `      "distinctRoleFromOthers": "다른 아이템과 구별되는 역할",`,
    `      "difficultyReason": "난이도 근거",`,
    `      "visualPlan": null 또는 {`,
    `        "purpose": "이 문항에 이미지가 필요한 사고 방법 관점의 이유",`,
    `        "studentObservation": "학생이 이미지에서 관찰·수행할 행동",`,
    `        "subjectMatter": "표현할 대상·상황·관계 (정답 단어·오답 단어 없이 시각 소재만)",`,
    `        "imageCount": 1~3,`,
    `        "educationalRoles": ["각 이미지의 교육적 역할 (imageCount 와 같은 길이)"],`,
    `        "composition": "화면 구성·배치 방식",`,
    `        "ageAppropriateStyle": "학년 수준에 맞는 표현 수준",`,
    `        "textPolicy": "이미지 안에 문자·기호 포함 여부와 조건 — 정답이 문자 자체인 학습이면 문자 금지",`,
    `        "answerLeakPolicy": "정답을 이미지가 직접 노출하지 않기 위해 지킬 조건",`,
    `        "styleGuide": "학교 클립아트 스타일 (\\"우리학교 클립아트 스타일\\" 로 서술)"`,
    `      }`,
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
    ``,
    `hintPlan 결정 규칙 (원칙 §4):`,
    `- 힌트가 학생 사고를 실질적으로 돕지 못하고 정답을 시사하게 될 학습 목표라면 needed=false 로 결정한다.`,
    `  예: 짧은 사실 회상, 인식 자체가 답이 되는 지각·인지 과제, 관찰 결과 그 자체를 묻는 문항 등.`,
    `- needed=true 인 경우 strategy 는 "어떤 관점·비교·단계별 사고를 도울지" 만 서술한다.`,
    `  정답 문자열·동의어·정의를 strategy 에 포함하지 않는다.`,
    `- rationale 은 이 결정을 내린 근거를 사고 방법 관점에서 설명한다.`,
    `- itemBlueprints 안에서 needed 결정이 일부는 true, 일부는 false 가 되어도 된다.`,
    ``,
    `visualPlan 결정 규칙 (신규 클립아트 생성 지침):`,
    `- 이 학습 자료의 렌더 형식은 텍스트 + 이미지뿐이다. 오디오·비디오는 존재하지 않는다.`,
    `  따라서 학습 목표가 "소리를 듣고" 같은 오디오 인식을 명시하더라도, 각 문항은 오디오 없이도 학생이 판단 가능하도록 재구성한다.`,
    `  예: "소리 인식" 학습 목표는 "그림의 대상 이름 첫 자음 인식" 같은 관찰 과제로 대체한다 (자음 소리와 대상 이름 첫 자음은 대응된다).`,
    `  studentTask 는 실제 자료 안에서 학생이 실행 가능해야 한다.`,
    `- 사용자 선택 (request.clipartMode) 를 반드시 반영한다:`,
    `  · 'none' → 모든 문항의 visualPlan 을 null 로 둔다 (이미지 없이 텍스트만).`,
    `  · 'auto' → 기본 자세는 "이미지를 넣는다". 각 문항에 대해 이미지가 학습을 돕는지 판단하고, 도움이 되면 visualPlan 을 반드시 만든다.`,
    `    다음 경우만 예외적으로 visualPlan=null 로 둔다: (1) 이미지가 정답을 부당하게 노출하는 것을 피할 방법이 없을 때, (2) 순수 개념·문자·기호 조작 문항이라 이미지가 실질적 도움이 안 될 때.`,
    `    관찰·비교·연결·인식·분류 계열 학습 목표에서는 이미지가 사실상 필수이므로 visualPlan 을 만든다.`,
    `    모든 문항에 이미지를 강제하지는 않지만, 'auto' 상태에서 대부분 문항 visualPlan=null 을 반환하는 것은 잘못된 판단이다.`,
    `- 학습 목표의 핵심이 문자·자모·발음 자체를 인식하는 것이라면 이미지 안에 그 문자를 넣지 않도록 textPolicy 로 명시한다.`,
    `  같은 원칙을 다른 소재에도 일반화한다 (정답이 되는 시각 요소를 이미지가 직접 보여주지 않는다).`,
    `- 문항마다 subjectMatter 가 서로 달라야 한다. 두 문항이 같은 소재를 반복하지 않는다.`,
    `- subjectMatter 는 이 이미지 하나에 실제로 그릴 단일 시각 소재 또는 하나의 장면만 서술한다.`,
    `  선택지 후보·정답·오답 소재 목록을 그대로 넣지 마라 (예: "고양이, 강아지, 기차, 나무" 처럼 여러 대상을 나열하지 않는다).`,
    `  이 이미지가 학생에게 관찰시킬 대상 하나만 명확히 표현한다.`,
    `- subjectMatter · studentTask · successCriterion 이 서로 정합해야 한다 — 학생이 이 subjectMatter 로 표현된 이미지를 관찰해 successCriterion 을 만족할 수 있어야 한다.`,
    `  이미지의 대상과 문항이 요구하는 판단이 어긋나지 않도록 blueprint 전체를 함께 검토한다.`,
    `- 이미지 필요 여부와 구성은 이 요청의 맥락에서 판단한다. 특정 과목·단원·주제·정답 단어에 대한 하드코드된 규칙을 만들지 않는다.`,
    `- styleGuide 에는 "우리학교 클립아트 스타일: 단순하고 밝은 색, 웃는 표정, 배경 최소화, 학생 친화적" 을 기본으로 사용하되, 학년 수준에 맞춰 표현 수준을 조정한다.`,
    `- imageCount 는 학생이 관찰해야 할 대상 수에 맞춘다 (기본 1). 여러 대상을 관찰해야 하면 imageCount 를 늘리고 각 slot 별 subjectMatter 는 educationalRoles 로 구분한다.`,
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
  worksheetPlan?: WorksheetPlan,
): string {
  const worksheetBlock = worksheetPlan
    ? [
        ``,
        `<WorksheetPlan (조판·활동 유형 · 이미 승인됨)>`,
        JSON.stringify(worksheetPlan, null, 2),
        `</WorksheetPlan>`,
      ].join('\n')
    : '';
  return [
    `아래 GenerationContext, ContentPlan, WorksheetPlan(있으면) 을 바탕으로 LearningDocument(JSON)만 응답하라.`,
    ``,
    `<GenerationContext>`,
    JSON.stringify(context, null, 2),
    `</GenerationContext>`,
    ``,
    `<ContentPlan (이미 승인됨)>`,
    JSON.stringify(plan, null, 2),
    `</ContentPlan>`,
    worksheetBlock,
    ``,
    v2DocumentSchemaSpec(worksheetPlan !== undefined),
    ``,
    `구현 규칙:`,
    `- 각 itemBlueprint 의 itemId 를 실제 section 의 itemId 로 그대로 사용한다.`,
    `- 각 문항·활동은 blueprint 의 studentTask / informationInsideItem / successCriterion 을 구현한다.`,
    `- 오답 선택지는 blueprint 의 distractorDesignPrinciple 에 따라 설계한다.`,
    `- 시각자료 처리 (blueprint.visualPlan 참조):`,
    `  · visualPlan 이 non-null 이면 이후 파이프라인에서 그 문항 뒤에 실제 이미지가 삽입된다.`,
    `    stem 은 이 이미지 관찰을 지시하는 형태로 작성한다 (예: "다음 그림을 관찰하여 ...", "이 그림에 어울리는 ...").`,
    `    stem·choices 안에 정답이 되는 대상·글자·기호를 그대로 노출하지 마라 (이미지가 그 역할을 한다).`,
    `  · visualPlan.subjectMatter 와 answer / choices 가 반드시 정합해야 한다.`,
    `    이미지가 표현하는 대상을 학생이 관찰해 정답에 도달할 수 있어야 하며, subjectMatter 와 정답의 특성이 어긋나면 안 된다.`,
    `    예: subjectMatter 로 표현될 대상의 특성이 정답을 지지하지 않는 경우 이 문항을 그렇게 만들지 마라.`,
    `  · visualPlan 이 null 이면 stem 이 자기완결적이어야 한다 (텍스트만으로 정답 판단 가능).`,
    `- 객관식 필수 검증 (반환 직전에 스스로 확인):`,
    `  · choices 의 answer 번호가 실제로 stem 의 조건을 만족하는지 확인한다.`,
    `  · 예: stem 이 "X 조건에 맞는 것" 을 묻는데 answer 로 지목된 choice 가 X 조건을 만족하지 않으면 문항 자체가 잘못이다. 이런 문항은 만들지 말고, 정답이 되는 choice 를 실제로 그 조건을 만족하는 것으로 교체하거나 stem 을 바꾼다.`,
    `  · 특히 visualPlan 이 있는 문항에서 subjectMatter 가 answer 의 조건을 지지하지 못하면 blueprint 를 재해석하지 말고 정답과 subjectMatter 가 자연스럽게 정합하도록 stem/choices/answer 를 다시 구성한다.`,
    `- 힌트 생성은 blueprint.hintPlan 에 따른다:`,
    `  · hintPlan.needed === false 이면 이 문항의 section 에 "hint" 필드를 절대 생성하지 않는다 (필드 자체 생략).`,
    `  · hintPlan.needed === true 이면 hintPlan.strategy 를 따르되 정답 문자열·동의어·정의를 담지 않는다.`,
    `  · needed=true 라도 실제 문항 맥락에서 힌트가 사고를 돕지 못하고 정답을 시사하게 되면 hint 필드를 생략하는 편이 낫다.`,
    `- 반환 전에 스스로 다음을 확인한다:`,
    `  · 모든 문항이 blueprint 와 연결되는가`,
    `  · 각 문항을 실제 학생처럼 풀어봤을 때 successCriterion 이 결정 가능한가`,
    `  · 오답이 설계 원칙과 일치하는가`,
    `  · needed=false 문항에 hint 필드가 없는가`,
    `  · needed=true 문항의 hint 가 정답을 담지 않는가`,
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
    `  distractorDesignPrinciple / hintPlan / gradeSuitabilityReason / distinctRoleFromOthers`,
    `  / difficultyReason 은 그대로 유지한다.`,
    `- 힌트 처리:`,
    `  · BlueprintToPreserve.hintPlan.needed === false 이면 "hint" 필드를 아예 만들지 않는다.`,
    `  · true 이면 hintPlan.strategy 를 다시 구현한다 — 기존 hint 표현만 살짝 바꾸는 것 금지.`,
    `  · 힌트가 실제로 정답을 시사하게 될 수밖에 없다면 hint 필드를 생략한다.`,
    `- ReviewReason 이 지적한 문제를 RepairInstruction 대로 구조적으로 고친다.`,
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
function v2DocumentSchemaSpec(worksheetMode = false): string {
  const stage4Kinds = [
    `- { "kind": "picture-choice", "itemId": "pc_01", "number": 1, "stem": "학생이 실제로 읽을 지시문",`,
    `    "choices": [{"label":"실제로 학생이 볼 텍스트","imageAssetRef":"__will_be_replaced__"}, {"label":"...","imageAssetRef":"__will_be_replaced__"}],`,
    `    "answer": "1" }  // 선택지 label 은 반드시 학생이 문항 맥락에서 이해할 수 있는 실제 문자열이어야 한다. "A", "B", "선택지1" 같은 자리표시자 금지.`,
    `- { "kind": "matching", "itemId": "mt_01", "stem": "학생이 실제로 읽을 지시문",`,
    `    "leftColumn": [{"id":"L1","text":"실제 왼쪽 항목"}, {"id":"L2","text":"..."}],`,
    `    "rightColumn": [{"id":"R1","text":"실제 오른쪽 항목"}, {"id":"R2","text":"..."}],`,
    `    "correctPairs": [["L1","R1"], ["L2","R2"]] }  // text 는 반드시 학습 맥락의 실제 낱말·수식·문장.`,
    `- { "kind": "classification", "itemId": "cl_01", "stem": "학생 지시문",`,
    `    "categories": ["실제 기준 이름1","실제 기준 이름2"],`,
    `    "items": [{"id":"i1","text":"실제 분류 대상","correctCategory":"실제 기준 이름1"}] }`,
    `- { "kind": "fill-blank", "itemId": "fb_01", "stem": "학생 지시문",`,
    `    "sentences": [{"template":"학생이 볼 실제 문장 __ 이곳이 빈 칸","answers":["정답 낱말/수"]}] }`,
    `  // template 의 __ 은 반드시 실제 문장 안의 빈 칸 위치. "__ 이 __ 을 ..." 같은 자리표시자 문장 금지.`,
    `- { "kind": "writing-grid", "itemId": "wg_01", "stem": "학생 지시문",`,
    `    "gridType": "square"|"lined"|"manuscript",`,
    `    "cellsPerRow": 10, "rowCount": 3, "tracingText": "따라 쓸 실제 견본(선택)" }`,
    `- { "kind": "guided-practice", "itemId": "gp_01", "stem": "학생 지시문",`,
    `    "workedExample": {"problem":"실제 예시 문제 (수식·문장 그대로)","solutionSteps":["실제 1단계 설명","실제 2단계 설명"]},`,
    `    "practiceProblems": [{"problem":"실제 연습 문제","answer":"실제 기대 정답"}] }`,
    `  // problem/answer 는 학습자가 그대로 풀 수 있는 실제 내용. "예시 문제", "1단계" 같은 자리표시자 금지.`,
    `- { "kind": "independent-practice", "itemId": "ip_01", "stem": "학생 지시문",`,
    `    "problems": [{"problem":"실제 문제","answer":"실제 정답","answerSpaceLines":2}] }`,
    `- { "kind": "sequence", "itemId": "sq_01", "stem": "학생 지시문",`,
    `    "items": [{"id":"a","text":"실제 항목1"}, {"id":"b","text":"실제 항목2"}],`,
    `    "correctOrder": ["a","b"] }`,
    `- { "kind": "observation", "itemId": "ob_01", "stem": "학생 지시문",`,
    `    "imageAssetRef": "__will_be_replaced__",`,
    `    "observationPrompts": [{"prompt":"실제 유도 질문","answer":"실제 기대 답"}] }`,
    `- { "kind": "open-response", "itemId": "or_01", "stem": "학생 지시문",`,
    `    "responseMode": "lines"|"box"|"both", "lineCount": 5, "boxHeightRatio": 0.3 }`,
    `- { "kind": "student-header", "fields": ["이름","날짜"] }  // 학생 정보란 (첫 페이지 상단).`,
    `- { "kind": "page-break", "reason": "..." }  // 새 페이지 강제.`,
    ``,
    `!! 매우 중요 !!  스키마의 예시 필드 값 (예: "실제 왼쪽 항목", "실제 연습 문제") 을 그대로 복사하지 말고, 이 요청의 실제 학습 내용으로 완전히 채워라. 자리표시자 그대로 반환하면 자료가 무용지물이 된다.`,
  ].join('\n');

  const worksheetHint = worksheetMode
    ? [
        ``,
        `Stage 4 활동형 학습지 모드 (WorksheetPlan 있음):`,
        `- WorksheetPlan.pages 순서대로 section 을 생성한다. 각 page 사이에는 { "kind": "page-break" } 를 반드시 삽입.`,
        `- 각 페이지 첫 부분에 필요하면 heading (예: 페이지 목적) 을 넣고, 첫 페이지 최상단에는 student-header 를 넣는다.`,
        `- 각 WorksheetBlock 은 그 activityType 에 맞는 section 하나로 변환한다 (blockId 는 section.itemId 로 재사용).`,
        `  · activityType='picture-choice' → kind='picture-choice'`,
        `  · activityType='matching' → kind='matching'`,
        `  · activityType='classification' → kind='classification'`,
        `  · activityType='fill-blank' → kind='fill-blank'`,
        `  · activityType='writing-grid' → kind='writing-grid'`,
        `  · activityType='guided-practice' → kind='guided-practice'`,
        `  · activityType='independent-practice' → kind='independent-practice'`,
        `  · activityType='sequence' → kind='sequence'`,
        `  · activityType='observation' → kind='observation'`,
        `  · activityType='open-response' → kind='open-response'`,
        `- WorksheetBlock.visualRequirement.needed=true 인 활동에서만 imageAssetRef 필드를 두고 값은 "__will_be_replaced__" 문자열 하나로 둔다. 이후 파이프라인이 R2 URL 로 치환한다.`,
        `- WorksheetBlock.instruction 을 각 section 의 stem 앞에 그대로 반영해도 되고 stem 에 자연스럽게 녹여도 된다.`,
        `- teacherOverlay 가 있으면 section 의 teacherNote 필드에 요약 문장으로 저장한다.`,
        `- ContentPlan.itemBlueprints 의 모든 itemId 가 어딘가의 section 에 sourceItemIds 또는 itemId 형태로 반드시 등장해야 한다.`,
      ].join('\n')
    : '';

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
    `sections 항목 종류 (Stage 3 이전):`,
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
    `Stage 4 활동형 블록 (활동형 학습지 모드에서 사용):`,
    stage4Kinds,
    ``,
    `첫 section 은 반드시 heading level 1 (자료 제목, curriculum.unit·curriculum.topic 반영).`,
    worksheetHint,
  ].join('\n');
}

// Backward-compat: 기존 이름 유지
export const v2SystemPrompt = v2SystemPromptCommon;
