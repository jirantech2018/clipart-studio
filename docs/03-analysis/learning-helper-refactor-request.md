# Learning-Helper 구조 리팩터 — 조건부 승인 반영본 (v2)

> **상태**: 조건부 승인 반영. 기능 플래그 뒤에서 V2를 완성·검증한 후 프로덕션 전체 활성화 직전에만 사용자 승인 요청.
>
> **최우선 원칙**: 개별 결과물의 오류를 새로운 조건문·금지어·예외 검증으로 교정하지 않는다. 교육 데이터와 생성 맥락을 충분히 제공해 최초 생성 품질을 높이고, 교과와 무관한 공통 무결성 검증만 코드로 수행한다.

---

## 0. v1 → v2 변경 요약

사용자 조건부 승인(2026-09-09) 반영으로 다음이 변경됨:

| 항목 | v1 | v2 (반영) |
|---|---|---|
| 실행 순서 | S1·S2에서 운영 검증 먼저 삭제 | 신규 V2 완성·검증 후 전환. 기존 흐름은 유지. Legacy 삭제는 최종 단계 |
| ContentPlan | 실제 계산식·정답·오답까지 미리 작성 | 문항의 목적·범위·유형만 작성. 실제 문항 문장·수치·정답은 최종 Document 단계 |
| 선수학습 | `grade < 요청 AND subject = 요청` 전체 조회 | 명시적으로 연결된 프로필의 `prerequisiteProfileIds` 만 조회 |
| 프로필 사용 | excludedScope에 금지어 축적 가능성 | 교육 범위 설명 데이터만. 오류 문구를 정규식으로 검색하는 사용법 금지 |
| 허용 검증기 | 고정 목록 (§7) | 원칙 기반. 특정 목록 고정 X. 원칙 5개 만족 여부로 판정 |
| AI 호출 비용 | Plan+Doc+Semantic 3회 고정 | Plan은 필수 아님. 단순 자료는 단일 구조화 호출로 Plan+Doc 함께 반환하는 변형 비교 |
| QA 범위 | 1~6학년 60배치 | 현재 활성 프로필(1~2학년 국·수)만. 고정 세트 + 무작위 세트 분리. 사람 평가 포함 가능 구조 |
| 품질 목표 | 사용자에게 수치 결정 요구 | 개발자가 V1/V2 실측 후 근거와 함께 권장안 제안 |
| 운영 전환 | S8에서 handler 즉시 교체 | 기능 플래그 `LEARNING_GENERATION_V2` 뒤에 배치. 내부 대상만 우선 활성 |
| 승인 책임 | 사용자가 7개 기술 결정 | 개발자가 권장안 확정하고 결과로 증명. 프로덕션 전체 활성화 직전에만 승인 요청 |

**subject/domain/unit/topic 을 AI 컨텍스트로 전달하는 것은 금지 대상 아님** (v1의 자기 진단 §I 정정). 금지 대상은 이 값으로 코드가 케이스별 분기하는 것 (`if (subject === 'MATH')`).

---

## 1. 자기 진단 (v1 유지, 오해 정정)

현재 배포된 코드(`521249d`)의 원칙 위배 지점:

| # | 원칙 | 파일:줄 | 위배 내용 |
|---|---|---|---|
| A | ContentPlan 단계 없음 | `services/learning-orchestrator/index.ts` | 한 번 호출로 최종 문항 생성 |
| B | GenerationContext 통합 없음 | `services/jobs/handlers/learning-doc.ts:70-90` | OrchestratorInput + ResolvedLearningProfile 별개 전달 |
| C | L2 세트 편중 검증 | `l2-deterministic.ts:129-165` | 원칙 5개 중 "결과가 참·거짓으로 명확히 계산" 미충족 |
| D | L2 텍스트 regex 판별 | `l2-deterministic.ts:340-355` | `math-no-negative/decimal` — 텍스트에서 "음수"/`\d+\.\d+` 검색 |
| E | L2 텍스트 연산 감지 | `l2-deterministic.ts:187-200, 361-368` | OP_KEYWORDS regex |
| F | Handler에서 legacy 실행 | `learning-doc.ts:106-115` | 신규 생성 차단에 사용되지 않지만, 결과에 legacyFirstOk 로그. §6에서 "회귀 비교 로그"는 허용이지만 handler에서 매 요청 실행은 과함 |
| G | 프롬프트 case-specific 함수 | `prompts.ts:210-436` | jamoMcRules/koreanGeneralMcRules/mathMcRules/individualActivitySubjectGuidance — 특정 예시·금지어 하드코드 |
| H | 프롬프트 subject 분기 | `prompts.ts:325-345, 392-436` | `if (input.subject === 'MATH')` |
| ~~I~~ | ~~L3에 subject 전달~~ | ~~l3-semantic.ts:220-230~~ | **취소** — subject 전달은 필요. 금지 대상 아님 |

취소(I)를 제외한 A~H 는 v2 리팩터 대상.

---

## 2. 과목·단원·주제별 분기 목록 (v1과 동일)

v1 §2 참조. 총 위배 지점 약 20건, 파일 4개.

**핵심 구분**:
- ✅ **허용**: `subject`, `domain`, `unit`, `topic`, `learningGoals`, `allowedScope`, `excludedScope` 값을 AI 프롬프트/GenerationContext/L3 검수 컨텍스트에 **데이터로 전달**하는 것
- ❌ **금지**: 위 값들로 코드가 갈라지는 것 (`if (subject === 'MATH') ...`), 특정 단원명·주제명 문자열 매칭, 금지어 리스트로 텍스트 검색

---

## 3. Legacy guards 처리 방침 (v1 개정)

### 3.1 삭제/유지 결정 — v1 그대로

`legacy-guards.ts` 15개 export 중 삭제 12·유지 2·부분 병합 1 (v1 §3.1 표 유지).

### 3.2 **삭제 시점 변경 (v1 → v2)**

| 단계 | v1 | v2 |
|---|---|---|
| Handler에서 legacy 호출 제거 | S2 (초기) | **최종 단계** — V2가 기능 플래그 뒤에서 안정화된 후 |
| `legacy-guards.ts` 파일 삭제 | S9 | **최종 단계** — V1 흐름 폐기 확정 후 |
| `prompts.ts` 재작성 | S6 | **V2와 별개 파일로 신설**. V1 `prompts.ts`는 그대로 유지. V2가 `prompts-v2.ts`에서 신규 프롬프트 사용. |

Legacy는 V1 흐름의 안전망으로 계속 동작. V2가 검증되기 전까지 방어막을 유지.

---

## 4. GenerationContext 실제 예시 (v1 유지 + 선수학습 정정)

**"2학년 · 수학 · 덧셈과 뺄셈 · 받아올림 덧셈"** 요청 시 GenerationContext:

```json
{
  "learner": {
    "grade": 2,
    "vocabularyLevel": "2학년 (한 문장 25자 이내, 개념어 최소)",
    "priorKnowledge": [
      "1학년 · 덧셈과 뺄셈 · 10 이하 덧셈 (프로필 명시 관계)",
      "2학년 · 세 자리 수 · 100과 1000까지 알기 (프로필 명시 관계)"
    ]
  },
  "curriculum": {
    "subject": "MATH",
    "subjectLabel": "수학",
    "domain": "수와 연산",
    "unit": "덧셈과 뺄셈",
    "topic": "받아올림이 있는 덧셈",
    "learningGoals": [
      "두 자리 수 + 두 자리 수 덧셈에서 받아올림 원리를 이해한다",
      "일의 자리 합이 10 이상일 때 십의 자리에 1을 올려서 계산한다"
    ],
    "coreConcepts": ["자릿값", "받아올림", "덧셈의 결합"],
    "allowedScope": {
      "operationSet": ["addition"],
      "numberRange": { "min": 0, "max": 100 },
      "requiresCarry": true
    },
    "excludedScope": {
      "operationSet": ["subtraction", "multiplication", "division"],
      "topics": ["소수", "분수", "음수"],
      "note": "설명 데이터로만 사용. 코드가 이 문자열을 정규식으로 결과에서 검색하지 않는다."
    }
  },
  "material": {
    "type": "multiple_choice",
    "purpose": ["…자료 유형의 교육적 목적 (learning_material_types 신규 컬럼)…"],
    "expectedEvidence": ["…좋은 결과물의 증거…"],
    "compositionGuidance": { "…자료 유형별 구성 안내…": true }
  },
  "request": {
    "amount": 5,
    "difficulty": "normal",
    "variant": "basic",
    "additionalInstructions": null
  },
  "qualityRubric": {
    "criteria": [
      { "key": "goalCoverage",        "text": "요청한 학습 목표를 실제로 다루는가?" },
      { "key": "gradeSuitability",    "text": "해당 학년 학생이 이해하고 수행할 수 있는가?" },
      { "key": "materialFit",         "text": "자료유형의 목적에 맞는가?" },
      { "key": "selfContained",       "text": "외부 정보 없이 문제를 이해할 수 있는가?" },
      { "key": "internalConsistency", "text": "내용·정답·설명이 서로 모순되지 않는가?" },
      { "key": "diversity",           "text": "반복적이거나 편향된 구성이 아닌가?" }
    ]
  }
}
```

### 조립 규칙 (v2 반영)

| 필드 | 데이터 소스 |
|---|---|
| `learner.priorKnowledge` | **프로필의 명시적 `prerequisiteProfileIds` 만** 조회. 하위 학년 같은 과목 전체를 자동으로 가져오지 않음 |
| `learner.vocabularyLevel` | `ResolvedLearningProfile.vocabularyGuidance` |
| `curriculum.*` | 사용자 입력 + 프로필 병합 결과 |
| `material.purpose/expectedEvidence/compositionGuidance` | `learning_material_types` (Migration 093 신규 컬럼) |
| `qualityRubric.criteria` | 6개 범용 루브릭 (subject-invariant) + 프로필 `semanticCriteria` 병합 |

조립 함수 안에 subject/topic 기반 코드 분기 **0건**. subject 문자열은 데이터로만 흐름.

---

## 5. ContentPlan 실제 예시 (v2 축소)

**v1 오류**: 실제 계산식·정답·오답까지 작성해 최종 Document와 중복됨.

**v2 축소**: 목적·범위·유형만. 실제 문항 문장·수치·정답은 최종 Document 생성 단계.

```json
{
  "interpretedGoal": "학생이 두 자리 수 + 두 자리 수 덧셈에서 일의 자리 합이 10 이상인 경우 받아올림 원리를 정확히 적용할 수 있는지 확인",
  "learnerAssumptions": [
    "1학년까지 배운 10 이하 덧셈 기본 개념 이해",
    "두 자리 수 자릿값 분리 읽기 가능"
  ],
  "itemBlueprints": [
    {
      "itemId": "q_01",
      "intendedLearning": "일의 자리 합 10~14 받아올림 계산",
      "taskType": "compute",
      "expectedEvidenceType": "correct-sum-with-carry",
      "difficultyLevel": "basic",
      "variationIntent": "가장 기본형"
    },
    {
      "itemId": "q_02",
      "intendedLearning": "일의 자리 합 15~18 큰 받아올림",
      "taskType": "compute",
      "expectedEvidenceType": "correct-sum-with-carry",
      "difficultyLevel": "medium",
      "variationIntent": "일의 자리 합이 더 큰 조합"
    },
    {
      "itemId": "q_03",
      "intendedLearning": "일의 자리 합 = 10 인 경계 케이스",
      "taskType": "compute",
      "expectedEvidenceType": "correct-sum-with-carry",
      "difficultyLevel": "medium",
      "variationIntent": "일의 자리 결과가 0인 특수 상황"
    },
    {
      "itemId": "q_04",
      "intendedLearning": "이야기 상황에서 덧셈 세우기",
      "taskType": "word-problem-to-equation",
      "expectedEvidenceType": "correct-equation-and-sum",
      "difficultyLevel": "medium",
      "variationIntent": "문맥에서 수식 추출 후 받아올림"
    },
    {
      "itemId": "q_05",
      "intendedLearning": "받아올림 원리를 학생이 설명할 수 있는지 확인",
      "taskType": "explain-choice",
      "expectedEvidenceType": "select-correct-explanation",
      "difficultyLevel": "advanced",
      "variationIntent": "계산 결과가 아닌 절차 설명"
    }
  ],
  "coverageSummary": "5문항 전체가 받아올림 덧셈 주제 안. 3개는 순수 계산, 1개는 이야기 문제, 1개는 절차 설명. 뺨셈·곱셈·소수·음수 미등장."
}
```

### ContentPlan 검증 (허용 검증기만)

- `itemBlueprints.length === request.amount`
- 각 blueprint의 `itemId` 유일
- `taskType` 값 열거형 안 (open enum, 자유롭게 확장 가능)

실제 문항 내용은 여기서 판정하지 않는다.

### 실제 문항 생성

Plan 승인 후 두 번째 AI 호출에서 Plan을 기반으로 실제 stem·choices·answer·hint를 생성.

---

## 6. 공통 프롬프트 구조 (v1 유지 + AI 호출 변형 추가)

### 6.1 시스템 프롬프트 (subject-invariant, 1가지)

```
너는 대한민국 2022 개정 교육과정 기준 초등학교 교사의 자료 생성 조수다.

주어진 GenerationContext는 학생·교과과정·자료유형·요청·품질 루브릭을 포함한다.
- learner: 어휘 수준·명시적 선수학습
- curriculum: 학습 목표·핵심 개념·허용 범위·제외 범위
- material: 자료유형의 교육적 목적과 좋은 결과물의 증거
- request: 수량·난이도·변형
- qualityRubric: 산출물이 만족해야 할 6개 범용 루브릭

원칙:
1. curriculum.allowedScope 밖 개념·연산·주제·소재를 도입하지 않는다.
2. curriculum.excludedScope 를 절대 등장시키지 않는다.
3. learner.priorKnowledge 는 활용 가능하지만 아직 배우지 않은 개념을 전제하지 않는다.
4. material.expectedEvidence 가 어떤 학생 행동을 관찰해야 하는지 알려준다.
5. 학년 어휘·특정 종교·가정 형태·경제적 격차 언급을 피한다.
6. 특정 출판사 교과서 원문을 복제하지 않는다.
7. 인물·역사·과학적 사실을 지어내지 않는다.

출력은 요청된 JSON 스키마만 반환. 마크다운·설명·주석 없음.
```

### 6.2 유저 프롬프트 (3가지 변형, 비용·품질 비교 대상)

**변형 A (기본, 두 단계)**:
- 호출 #1 → ContentPlan
- 호출 #2 → LearningDocument (Plan 참조)

**변형 B (경량, 단일 구조화 호출)**:
- 호출 #1 → `{ contentPlan, document }` 함께 반환 (Plan은 문서 안 field로)
- 검증도 한 번에 함께 수행 가능

**변형 C (Plan 스킵)**:
- 호출 #1 → LearningDocument 직접 (Plan 없이, 컨텍스트만)
- 단순 자료·저비용 케이스용

**선택 규칙**:
- request.amount ≤ 3 → 변형 C
- 4 ≤ amount ≤ 10 → 변형 B (기본값)
- amount > 10 또는 여러 재생성 발생 → 변형 A
- 상세 선택 규칙은 실측 후 조정. 초기값은 위대로.

### 6.3 후속 검증

- L1 (구조) + L2 (§7 원칙 만족 검증기) + L3 (범용 6개 루브릭 AI 검수)
- L3 실패 item_id → 부분 재생성 최대 1회 (Plan 유지, 실패 item만 재생성)

---

## 7. 허용되는 코드 검증기 (v2 원칙 기반)

### 7.1 원칙 5개

코드 검증기는 다음 **5개를 모두 만족**할 때만 구현 가능:

1. 결과가 참·거짓으로 명확히 계산됨
2. 교과 내용에 관한 주관적 판단이 아님
3. 특정 과목·단원·주제 문자열을 사용하지 않음
4. 정상 콘텐츠를 막을 오탐 가능성이 매우 낮음
5. 입력·출력 계약의 무결성을 확인함

### 7.2 이 원칙에 부합하는 예시 (초기 구현 목록, 확장 가능)

| 항목 | 원칙 만족 근거 |
|---|---|
| 요청한 문항·활동 수와 실제 개수 일치 | 정수 비교, 오탐 0 |
| 필수 데이터 누락 (meta/section 필드) | 존재 여부, 오탐 0 |
| 잘못된 정답 인덱스 (범위 밖) | 수치 비교, 오탐 0 |
| 선택지 완전 중복 (정규화 후 동일) | 문자열 정규화 + 세트, 오탐 없음 |
| 학생용 결과에서 정답 노출 | 렌더러 출력에 answer 필드 미노출 검증, 계약 |
| JSON/파일 구조 손상 (Zod parse) | 계약 |
| 명시적 수식 (`27 + 15 = ?`) 결과 일치 | 파서로 정확히 계산, 파싱 실패 시 판정 유보 |
| 저장·권한·다운로드 실패 | 인프라 에러, 계약 |

### 7.3 이 원칙 밖 (V2에서 코드 검증 안 함)

- 정답 위치·내용 편중 (통계 규칙 · 원칙 1 실패)
- 텍스트에서 "음수/소수/자모/모음" 등 단어 검색 (원칙 3 실패)
- 텍스트에서 연산 감지 후 허용 밖 판정 (원칙 3·4 실패)
- 힌트가 정답을 의미상 노출하는지 (원칙 2 실패 — 주관 판단)
- 학년 어휘 적합성 (원칙 2·3 실패)

**대체**: 위 항목은 L3 semantic AI 검수의 6개 범용 루브릭으로 처리.

### 7.4 신규 검증기 추가 절차

- v1 §8 그대로 유지 (문서 제출 → 사용자 승인)
- 자동 반려 요건 유지
- **추가**: 원칙 5개 만족 여부를 문서에 명시적으로 표기

---

## 8. 신규 검증기 승인 절차 (v1 유지)

v1 §8 참조. 원칙 5개 명시 요구가 v2에 추가됨.

---

## 9. QA 방법 (v2 축소 + 사람 평가 여지)

### 9.1 QA 대상 (v2: 현재 활성 프로필만)

- **활성 프로필 조합** (2026-09-09 기준): 1~2학년 국·수
  - 1학년 국어 (초등 공통 + 1학년 국어 + 국어 읽기 영역 + 낱말과 문장 단원 조합)
  - 2학년 국어 (초등 공통 + 2학년 국어 + 국어 읽기 영역)
  - 1학년 수학 (초등 공통 + 1학년 수학 + 수학 수와 연산 영역)
  - 2학년 수학 (초등 공통 + 2학년 수학 + 수학 수와 연산 영역 + 덧셈과 뺄셈 단원)
- 3~6학년은 프로필 seed 확장 후 같은 QA 체계로 확장

### 9.2 두 종류 세트

**고정 평가 세트** (`scripts/qa/fixed-set.ts`, 결정론적):
- 위 4조합 × 자료유형 5종 = 20 시나리오 고정
- V1 vs V2 를 동일 조건으로 반복 실행 (seed 고정)
- 결과 diff 로 변경 사항 검출

**무작위 평가 세트** (`scripts/qa/random-set.ts`, 시드 지정 가능):
- 위 4조합 안에서 topic 무작위 (learning_common_topics seed)
- 자료유형 무작위 (5종)
- N=20 배치를 seed=20260909, 20260910, ... 로 5회 반복

### 9.3 지표 (v2: 개발자 실측 후 목표 제안)

수치는 v2 리팩터 완료 후 실측하여 아래 표에 채워 사용자에게 제안:

| 지표 | V1 (실측) | V2 (실측) | 출시 기준 (개발자 권장안) | 측정 방법 |
|---|---|---|---|---|
| 최초 생성 사용 가능률 | TBD | TBD | TBD | L1+L2 통과 % |
| L3 루브릭별 pass율 | TBD | TBD | TBD | L3 별 항목 통과 % |
| 평균 생성 시간 | TBD | TBD | TBD | duration_ms 평균 |
| 최대 생성 시간 (p95) | TBD | TBD | TBD | duration_ms p95 |
| 평균 입력 토큰 | TBD | TBD | TBD | input_tokens 평균 |
| 평균 출력 토큰 | TBD | TBD | TBD | output_tokens 평균 |
| 평균 생성 비용 (원) | TBD | TBD | TBD | 토큰 × 가격표 |
| 부분 재생성률 | TBD | TBD | TBD | repair_attempts 있는 문서 % |
| 교사 수정 필요율 | TBD | TBD | TBD | 사람 표본 평가 (아래) |

**출시 기준은 사용자가 임의로 정하지 않는다**. 개발자가 실측 후 근거와 함께 제안.

### 9.4 사람 표본 평가 (자기 검수 한계 보완)

- 각 조합에서 5~10개 배치를 뽑아 사용자에게 짧은 리커트 (1~5) 평가지 제공
- 항목: 목표 커버·학년 적합·자연스러움·정확성·즉시 사용 가능성
- L3 AI 결과와 대조하여 AI 판정의 편향 검출
- 정기 스냅샷 (예: 매 배포 후 20개) 형태로 축적

### 9.5 실패 배치 저장

- `tmp/qa/failures/{run-id}/` 아래 `{ context, plan, document, evaluation }` JSONL 보존
- 실패 원인 분류 (사용자 §5 추가 제안 반영):
  1. 교육 데이터 부족
  2. 생성 맥락 조립 오류
  3. 생성 모델의 계획·실행 불일치
  4. 렌더링·저장 기술 오류
- 즉시 규칙 추가 금지. 동일 문제가 무작위 사례에서 반복되는지 확인 후 공통 구조 개선

---

## 10. 리팩터 실행 순서 (v2 개정)

### 10.1 실행 순서 (사용자 조건부 승인 §1 반영)

| # | 단계 | 파일 | 상태 |
|---|---|---|---|
| 1 | Migration 093 (learning_material_types 확장 컬럼) | supabase/migrations/ | v2 신규 |
| 2 | Migration 094 (learning_documents.content_plan JSONB + learning_profiles.prerequisite_profile_ids) | supabase/migrations/ | v2 신규 |
| 3 | GenerationContext 조립기 | src/services/learning-generation/ | 신규 파일 |
| 4 | ContentPlan(축소) + 공통 프롬프트 v2 | src/services/learning-orchestrator/prompts-v2.ts | 신규 파일 |
| 5 | V2 오케스트레이터 (변형 A/B/C 지원) | src/services/learning-orchestrator/orchestrator-v2.ts | 신규 파일 |
| 6 | 기능 플래그 `LEARNING_GENERATION_V2` + handler 분기 | services/jobs/handlers/learning-doc.ts | V1 흐름 그대로 유지 + V2 분기 |
| 7 | 고정 평가 세트 + 무작위 평가 세트 스크립트 | scripts/qa/ | 신규 파일 |
| 8 | V1 vs V2 비교 보고서 자동 생성 | scripts/qa/compare-report.ts | 신규 파일 |
| 9 | 내부 사용자·조직 화이트리스트로 V2 활성화 실측 | 환경변수·조직 slug 목록 | 별도 승인 대기 |
| 10 | 프로덕션 전체 활성화 | 플래그 on 전환 | **사용자 최종 승인 필수** |
| 11 | Legacy guards + prompts.ts (V1) 삭제 | services/ | 프로덕션 안정화 후 별도 승인 |
| 12 | 최종 무작위 배치 평가 리포트 | scripts/qa/ | 지표 문서화 |

### 10.2 기능 플래그 사양

```
LEARNING_GENERATION_V2=false          # 기본값 (V1 사용)
LEARNING_GENERATION_V2=true           # 전체 활성화
LEARNING_GENERATION_V2=slug:...       # 조직 slug 화이트리스트
```

- 실행 위치: handler 진입부
- 실패 시 자동 폴백: V2 예외 → V1 흐름으로 재시도 (요청 실패 방지)
- 로그: 어떤 흐름이 사용됐는지 evaluations.result 안에 `variant: "v1" | "v2A" | "v2B" | "v2C"` 기록

### 10.3 롤백

- 각 단계 롤백: `git revert`
- 프로덕션에서 V2 문제 발생: 플래그 off → 즉시 V1 복귀 (DB 무변경)
- Migration 093/094: 순수 CREATE·ADD COLUMN 이므로 사용 안 하면 무영향

### 10.4 완료 기준 (v1 유지)

- ✅ 새 학년·과목·단원을 데이터로 추가할 때 생성 코드 수정 X
- ✅ 특정 교과·단원·주제 문자열을 검사하는 코드 없음
- ✅ Legacy guards가 생성 성공 여부를 결정하지 않음 (V2 활성화 후 삭제)
- ✅ GenerationContext + ContentPlan 저장돼 문제 원인 추적 가능
- ✅ 실패 사례가 생겨도 예외 규칙 추가하지 않고 데이터·맥락·생성 구조로 대응
- ✅ 무작위 배치에서 §9.3 지표 만족

### 10.5 v2에서 명시적으로 하지 않는 것 (사용자 §11 반영)

- 전체 사용자에게 V2 활성화 (별도 승인 후)
- Legacy 파일 삭제 (프로덕션 안정화 후 별도 승인)
- M2-2 대량 표본 생성
- 3~6학년 프로필 없이 대량 QA
- 개별 결과 통과용 조건문·금지어 추가

---

## 11. 확인 시점 (사용자 §12 반영)

중간 승인 요청 없음. 다음 상태가 되면 **한 번만** 보고:

- V2가 기능 플래그 뒤에서 실행 가능
- DB 변경 (093·094) 및 자동 테스트 완료
- V1 vs V2 품질·속도·비용 비교 준비
- 브라우저에서 사용자가 V2 결과 직접 체험 가능

보고 5줄 (그 이상 없음):
1. 무엇이 달라졌는지
2. 최초 생성 품질이 좋아졌는지
3. 생성 시간·비용이 얼마나 달라졌는지
4. 기존 서비스에 영향이 없는지
5. 사용자가 직접 확인할 URL·테스트 방법

---

## 12. 오류 사례의 사용 원칙 (사용자 §5 추가 제안)

개별 PDF 오류 발견 시:
1. 아래 4분류 중 하나로 원인 분류만 하고 즉시 수정 안 함
   - 교육 데이터 부족
   - 생성 맥락 조립 오류
   - 계획·실행 불일치
   - 렌더링/저장 기술 오류
2. 동일 문제가 다양한 무작위 사례에서 반복되는지 확인
3. 반복 확인되면 공통 구조 개선 (프로필 데이터·GenerationContext·프롬프트·검수 루브릭 중 하나)
4. 조건문·금지어·예외 처리·특정 주제 전용 검증은 절대 추가 금지

---

## 13. 조건부 승인 요약

**승인됨**:
- 리팩터 요청서 v2 커밋·push
- Migration 093·094 작성 및 apply
- GenerationContext·ContentPlan·공통 프롬프트 v2 구현
- V2 오케스트레이터 구현
- 기능 플래그 기반 내부 검증
- 자동 QA 및 V1 vs V2 비교 보고

**미승인 (별도 승인 필요)**:
- 프로덕션 전체 사용자 V2 활성화
- Legacy 파일 삭제
- M2-2 대량 표본 생성
- 3~6학년 프로필 없는 상태에서의 대량 QA
- 개별 결과 통과용 조건문·금지어·예외 코드
