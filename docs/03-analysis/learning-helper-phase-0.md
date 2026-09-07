# Learning Helper — Phase 0 실증 결과 (Placeholder)

> Phase 0 실행 완료 후 아래 표를 채운다. 채워진 결과를 근거로 Phase 1 착수를 최종 승인한다.

---

## 실행 환경

| 항목 | 값 |
|---|---|
| 실행일 | (예: 2026-09-05) |
| 실행자 | |
| OS / Node | Windows 11 / Node.js 20.x |
| 로컬 크롬 경로 | `PPTR_LOCAL_CHROME_PATH` |
| Railway 티어 | Hobby ($5/mo) |

---

## Sample 문서 3종

| 이름 | 자료유형 | 학년/과목 |
|---|---|---|
| workbook | 객관식 문제집 | 3학년 국어 |
| lessonPlan | 수업안 + 루브릭 | 5학년 수학 |
| openingSlides | 수업 도입 슬라이드 | 2학년 통합교과 |

---

## A. 세 포맷 산출물 지표

| Sample | 포맷 | 크기 (bytes) | 로컬 생성 시간 (ms) | Railway 생성 시간 (ms) |
|---|---|---:|---:|---:|
| workbook | pdf | | | |
| workbook | docx | | | |
| workbook | pptx | | | |
| lessonPlan | pdf | | | |
| lessonPlan | docx | | | |
| lessonPlan | pptx | | | |
| openingSlides | pdf | | | |
| openingSlides | docx | | | |
| openingSlides | pptx | | | |

---

## B. 사용자 검증 항목 체크

### B-1 세 포맷 내용 일치
- [ ] workbook: pdf/docx/pptx 텍스트 순서 동일
- [ ] lessonPlan: 표 내용 동일
- [ ] openingSlides: 슬라이드 순서 동일

### B-2 한글 폰트와 줄바꿈
- [ ] pdf: Pretendard 정상 렌더 (Puppeteer 캡처)
- [ ] docx: Word 열람 시 Pretendard 지정 확인
- [ ] docx: Pretendard 미설치 환경에서 fallback 폰트 확인
- [ ] pptx: PowerPoint 열람 시 Pretendard 지정 확인
- [ ] pptx: Pretendard 미설치 환경 fallback

### B-3 표·이미지 배치
- [ ] 표 셀 경계 유지 (pdf/docx/pptx)
- [ ] 이미지 크기·정렬 (Phase 0 은 placeholder 텍스트 — Phase 1 R2 매핑 후 재검증)

### B-4 페이지·슬라이드 자동 분할
- [ ] pdf: 페이지 자동 분할 · `page-break-inside: avoid` 정상 동작
- [ ] pptx: `splitIntoSlides()` 기준값 검증
  - maxQuestionsPerSlide=3 — 넘치면 새 슬라이드로 이동?
  - maxCharsPerSlide=400 — 텍스트 짤림 없는지
  - maxRowsPerSlideTable=8 — 큰 표 분할
  - maxImagesPerSlide=2

### B-5 실제 편집 가능 여부
- [ ] Word (Microsoft 365) 로 docx 열기 → 텍스트 수정 → 저장 → 재열람 정상
- [ ] 한컴오피스 (한글 2020 이상) 로 docx 열기
- [ ] PowerPoint (Microsoft 365) 로 pptx 열기 → 슬라이드 순서 변경 · 도형 편집
- [ ] Keynote 로 pptx 열기 (Mac)
- [ ] Google Slides 로 pptx 열기

### B-6 Railway 리소스
- [ ] Puppeteer 콜드 스타트: `___초`
- [ ] Puppeteer 웜: `___초`
- [ ] RSS 메모리 피크 (Puppeteer 실행 중): `___MB`
- [ ] Railway Hobby RAM 상한 (512MB) 내 안정 동작 여부: [ ] 안정 / [ ] 불안정
- [ ] docx/pptx 는 순수 Node → 메모리 영향 미미 예상 확인

---

## C. 발견된 이슈

| # | 심각도 | 이슈 | 대응 방향 |
|---|---|---|---|
| 1 | | | |
| 2 | | | |

---

## D. 슬라이드 분할 기준값 튜닝

Phase 0 결과에 따라 `src/services/learning-renderer/pptx.ts` 의 `SPLIT` 상수 조정:

```ts
const SPLIT = {
  maxQuestionsPerSlide: 3,  // ← 실증 후 조정
  maxCharsPerSlide: 400,    // ← 실증 후 조정
  maxRowsPerSlideTable: 8,  // ← 실증 후 조정
  maxImagesPerSlide: 2,     // ← 실증 후 조정
};
```

**결정된 값 (실증 후 기록)**:
- maxQuestionsPerSlide: 
- maxCharsPerSlide: 
- maxRowsPerSlideTable: 
- maxImagesPerSlide: 

---

## E. Phase 1 착수 가능 여부

- [ ] **Go** — 세 포맷 모두 실사용 가능 수준 · Railway 리소스 안정
- [ ] **Go with fallback** — PDF 는 react-pdf 로 대체 결정 · 나머지 유지
- [ ] **Hold** — 이슈 해결 후 재실증
- [ ] **Escalate** — Railway 티어 상향 or 다른 인프라 검토 필요

**Phase 1 착수 승인자**: 
**승인일**: 
**비고**: 

---

## F. 참고 링크

- 계획: [`docs/01-plan/features/learning-helper.plan.md`](../01-plan/features/learning-helper.plan.md)
- 지시서 (원본): `docs/00-pm/learning-helper.prd.md`
- 스키마: `src/services/learning-renderer/schema.ts`
- Sample: `src/services/learning-renderer/sample.ts`
- 렌더러: `src/services/learning-renderer/{pdf,docx,pptx}.ts`
- 실행 스크립트: `scripts/learning-render-sample.ts`
