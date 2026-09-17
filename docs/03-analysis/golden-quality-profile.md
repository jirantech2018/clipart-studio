# Golden Quality Profile — 활동형 학습지 조판·수행 완전성 기준

> 첨부 골든 PDF (`한글-자음-소리-활동형-학습지-개선시안.pdf`) 를 분석해 추출한
> **구조적** 기준. 색상·형태·주제·낱말은 이 파일 고유의 사례로만 남기고,
> 이 문서는 새 학습자료가 반드시 만족해야 할 **활동 완전성** 을 정의한다.

## 1. 페이지 흐름 (Learning Flow)

골든 샘플은 4단계 인지 발전으로 구성됨:

1. **인식 (Recognition)** — 자음(개념)과 그림(사례)을 좌우로 놓고 선으로 연결
2. **식별 (Discrimination)** — 그림을 관찰해 자음 3개 중 하나 선택
3. **생산 (Production)** — 그림을 보고 첫 자음을 격자에 손으로 씀
4. **창의 확장 (Creative Extension)** — 예시 낱말을 참고해 자기 낱말 3개 씀

**원칙**: 학생 인지 부담이 낮은 것에서 높은 것으로 진행. 같은 primitive 를 5회
반복 나열하지 않는다. 각 블록은 앞 블록을 준비 단계로 삼는다.

## 2. 블록 완전성 (Content Completeness)

### 2.1 모든 primitive 공통
- `instruction` 필드는 10자 이상, 학생이 무엇을 해야 하는지 구체적 서술.
- placeholder 표기 절대 금지: `(그림)`, `(사진)`, `(이미지)`, `TODO`, `...`,
  `(예: XXX 그림)`, `[image]` 등. Layout Review 가 `PLACEHOLDER_TEXT_LEAKED`
  로 차단.

### 2.2 `picture-choice` / `choice-grid`
- 각 선택지는 **실제 이미지 URL** 또는 **정답을 노출하지 않는 실질 label** 중
  하나 이상을 가져야 한다.
- 두 조건 모두 없으면 Layout Review 가 `CHOICE_INCOMPLETE` 반환.
- label 을 `(그림)` 으로 대체하는 방식은 금지. 이미지가 필요한 자리는
  visualSlot 으로 확보하고, 이미지 확보가 불가능하면 primitive 를
  image-observation 으로 바꾼다.

### 2.3 `matching-board`
- leftColumn / rightColumn 모두 각 항목이 이미지 또는 실질 텍스트를 가져야 한다.
- 미충족 시 `MATCHING_COLUMN_INCOMPLETE`.
- `correctPairs` 는 컬럼 항목 수와 동일해야 한다 (짝 미완성 금지).

### 2.4 `image-observation`
- 이미지 URL 필수. `OBSERVATION_IMAGE_MISSING` 로 차단.
- `observationPrompts` 배열 필수 (학생 질문 유도).

### 2.5 `sequence-steps` / `classification`
- items 최소 3개. `SEQUENCE_ITEMS_TOO_FEW` 로 차단.
- 각 item 은 text 또는 imageAssetRef 중 하나 이상.
- classification 은 correctCategory 반드시 지정.

### 2.6 `writing-practice`
- gridType (square/lined/manuscript) + cellsPerRow + rowCount 모두 설정.
- 미충족 시 `WRITING_CONFIG_INCOMPLETE`.

### 2.7 `open-response`
- instruction 이 구체적 (10자 이상 + placeholder 아님).
- open-response 블록만 반복해 페이지를 채우지 않는다 (composition prompt 로 안내).

## 3. 이미지 소유권

- 이미지는 반드시 활동 블록 내부 `visualSlot` 소유 (standalone image section 금지).
- `blockToImageUrls[blockId]` 매핑을 통해 renderer 가 primitive HTML 안에 직접 삽입.
- Layout Review 가 `standaloneImageCount > 0` → `IMAGE_DUPLICATE_STANDALONE`.
- `visualSlot.needed=true` 인데 URL 이 없으면 `IMAGE_NOT_LINKED` (부분 실패 감지).

## 4. 페이지 밀도

- 각 페이지 예측 사용률 (`predictedPageFillRatio`) ≤ 0.92.
- 마지막 페이지가 아닌 페이지는 ≥ 0.35 (`pullUpUnderfilledPages` 가 자동 조정).
- 답안 공간·본문 글자 크기를 축소해 페이지에 맞추지 않는다. 필요하면 3~4쪽으로 확장.

## 5. ID 계약

- ContentPlan.itemBlueprints[].itemId
- WorksheetPlan.pages[].blocks[].sourceItemIds
- PageCompositionPlan.pages[].blocks[].sourceItemIds
- LearningDocument.sections[].itemId

네 층이 동일 ID 계보. `verifyCompositionLinkingContract` 가 검증하며
`missingBlueprintIds / unknownSourceItemIds / unlinkedSectionIds /
duplicateItemPlacements` 중 하나라도 있으면 재생성 1회 → fail hard.

## 6. Deployment Gate

Layout Review 는 감사 지표가 아니라 **배포 차단 게이트**:

- 실패 시 `learning_documents` INSERT 없음 → 사용자 노출 없음.
- 크레딧은 route 계층이 자동 refund.
- 실패 사유는 `learning_evaluations.layout_review_result` 에 감사 로그로 저장.

## 7. 학년별 폭 (Grade-Aware Sizing)

`pdf-composition.ts:baseStyles` 가 학년 기반으로 폰트/줄간격 조정:
- 1~2학년: 12pt / 1.6 line-height
- 3~4학년: 11pt / 1.5
- 5~6학년: 10pt / 1.45

답안 공간은 학년 낮을수록 크게, 활동은 짧게.

## 8. 학생용 vs 교사용

- 학생용은 `variant='student'` — teacherOverlay 미노출, answer 필드 숨김.
- 교사용은 `variant='teacher'` — 같은 구성 위에 answerNote / guidanceNote /
  정답만 추가로 렌더.
- STUDENT_ANSWER_LEAK 는 학생 문서에 "정답:" 등의 문구가 노출되면 발생.

## 9. 자기 점검 스트립 (선택)

골든에는 하단 "오늘의 확인" 자기평가가 있음. `reflection-strip` primitive 로
표현 가능. 필수 아님 (composition planner 판단).

## 10. 반사실 원칙

이 프로필은 subject/unit/topic/특정 낱말에 의존하지 않는 **구조적** 기준.
프로필의 어느 검사도 특정 정답 문자열, 특정 자음, 특정 단원명에 분기하지 않는다.
