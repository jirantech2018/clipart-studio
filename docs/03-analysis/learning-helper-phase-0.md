# Learning Helper — Phase 0 실증 결과 (v2, 2026-09-07)

> Phase 0.5 개선: 사용자 검토 후 6가지 구조적 문제 수정. 동일 sample 로 세 포맷 재생성.

---

## v2 개선 요약 (사용자 요청 6항목)

| # | 요청 | 반영 |
|---|---|---|
| 1 | PDF 고아 페이지 방지 | `page-break-inside: avoid` + `orphans/widows: 3~4` + heading `keepNext` + question/activity 블록 통째 유지 |
| 2 | 학생용/교사용 분리 옵션 | 세 렌더러 모두 `answerVariant: 'student' \| 'teacher' \| 'combined'` 지원 (기본 combined 유지) |
| 3 | PPT 발표용 레이아웃 | A4 축소판 폐기. 자료유형별 8종 chunk (cover / section-cover / question / activity / table / image / text / answer-key) — 각 슬라이드가 자신만의 레이아웃 |
| 4 | PPT 최소 글자 + 최대 정보량 | 제목 32pt · 섹션 26pt · 문항 24pt · 선택지 22pt · 본문 20pt / 슬라이드당 문항 1개, 표 1개, 이미지 1개, 텍스트 250자 |
| 5 | DOCX/PPTX 한글 fallback | docx `styles.default.document.run.font: { name: 'Pretendard' }` + 모든 TextRun 에 명시 fontFace. pptx `fontFace: 'Pretendard'` 통일. 폰트 없으면 열람 환경 대체 (안내 문구 UI 로 계획서에 명시) |
| 6 | 이미지 비율·캡션·크기·배치 | sharp 로 원본 dimensions 추출 → `fitDimensions()` 로 원본 비율 유지. 최대 폭 80% 상한. 캡션 (이탤릭 회색, 중앙 정렬) |

---

## 실행 환경

| 항목 | 값 |
|---|---|
| 실행일 | 2026-09-07 (v2 재실행) |
| 실행자 | Claude Code (개발자 환경) |
| OS | Windows 11 |
| Node | v20.x (`pnpm tsx`) |
| Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe` |

---

## 라이브러리

| 패키지 | 버전 | 용도 |
|---|---|---|
| `puppeteer-core` | 최신 | PDF 렌더 |
| `@sparticuz/chromium` | 최신 | Railway/Linux 용 Chromium |
| `docx` | 최신 | Word 파일 |
| `pptxgenjs` | 최신 | PPT 파일 |
| `sharp` | 이미 설치됨 | 이미지 dimensions 파싱 |
| `tsx` (dev) | 4.23.13 | 스크립트 실행 |

---

## 생성된 9개 파일 (v2, 최신)

| Sample | 포맷 | 크기 (bytes) | 시간 (ms) | 슬라이드 수 (pptx) |
|---|---|---:|---:|---:|
| workbook (3학년 국어 객관식) | pdf | 70,361 | 1,328 | — |
| workbook | docx | 9,832 | 25 | — |
| workbook | pptx | 146,500 | 17 | **9** |
| lessonPlan (5학년 수학 수업안 + 이미지) | pdf | 199,184 | 1,105 | — |
| lessonPlan | docx | 189,429 | 49 | — |
| lessonPlan | pptx | **347,647** | 15 | **9** |
| openingSlides (2학년 수업 도입) | pdf | 126,815 | 1,277 | — |
| openingSlides | docx | 9,644 | 7 | — |
| openingSlides | pptx | 131,808 | 4 | **9** |

**관찰**
- v1 대비 pptx 크기 증가 (56K → 146K, 267K → 348K, 84K → 132K) → 발표용 레이아웃 (도형·큰 텍스트·표 스타일) 반영
- workbook.pptx: 표지 + 섹션 표지 + 문항 3개 + 활동 1개 + text 2개 + 정답·해설 = 9 슬라이드
- 문항이 각자 자신만의 슬라이드에 큰 글자로 배치 (v1 은 여러 문항이 한 슬라이드에 압축)
- lessonPlan.pptx: 이미지 슬라이드 · 표 슬라이드 · rubric 슬라이드가 각각 분리

---

## v2 렌더러 세부 규칙

### PDF
- 페이지 규격: A4, margin 20/18/20/18 mm
- 폰트: Pretendard (CDN woff2 로 preload, `document.fonts.ready` 대기)
- **고아 방지**: heading `break-after: avoid-page`, question/activity/table `break-inside: avoid-page`, `orphans: 3, widows: 3`
- 이미지: 원본 비율 유지, 최대 폭 80%, 캡션 이탤릭 회색

### DOCX
- 페이지 규격: A4, margin 동일
- 폰트: `styles.default.document.run.font: { name: 'Pretendard' }` + 모든 TextRun 에 `font: FONT_STACK`
- **한글 fallback**: 폰트 이름만 지정 → 열람 환경 대체 (Word/한컴 모두 시스템 폰트)
- **`keepNext` / `keepLines`**: heading 뒤 콘텐츠 · 문항 stem 과 선택지 붙어있게
- 이미지: `sharp` 로 원본 dimensions 추출 → `fitDimensions(w=목표px, maxH=800px)` 로 비율 유지
- 학생/교사 variant 지원

### PPTX
- Layout: LAYOUT_WIDE (13.333 × 7.5 inch)
- 폰트: `fontFace: 'Pretendard'` (통일)
- **발표용 chunk 분류** (splitIntoSlides):
  - `cover` — 문서 표지 (큰 제목 중앙)
  - `section-cover` — heading L1 표지 (섹션 이름 상단, 부제 중앙)
  - `question` — 문항 1개 (질문 24pt + 선택지 22pt + 인라인 정답 combined 시)
  - `activity` — 활동 1개 (번호 원 + 스텝 목록)
  - `table` — 표 1개 (헤더 배경 강조)
  - `image` — 이미지 1개 (원본 비율, 중앙, 캡션)
  - `text` — 텍스트 슬라이드 (heading L2/3 + paragraph + callout, 최대 250자)
  - `answer-key` — 마지막 슬라이드로 몰아서 (표 형식)
- **최소 폰트**: 본문 20pt / 제목 32pt / 문항 24pt (선택지 22pt) — 인쇄물 6~7pt 최소보다 훨씬 큼
- **슬라이드당 최대 정보량**:
  - 문항 1개, 표 1개, 이미지 1개, 활동 1개
  - 텍스트 슬라이드는 250자 초과 시 분할
- 이미지: sharp 원본 dimensions + `fitDimensions(maxHeight=4.8in)` 로 비율 유지, 중앙 정렬, 캡션
- **AI `slide-break` 힌트**: 텍스트 버퍼 flush 만 트리거. 강제 분할 X (렌더러가 결정)
- 학생/교사 variant 지원

---

## Answer Variant 옵션 (사용자 요청 #2)

세 렌더러 모두 `RenderOptions.answerVariant?: 'student' | 'teacher' | 'combined'` 지원:

| variant | 학생용 문제 | 인라인 정답 (question.answer) | answer-key 섹션 |
|---|:-:|:-:|:-:|
| `combined` (기본) | ✅ | ✅ 표시 | ✅ 문서 뒤 |
| `student` | ✅ | ❌ 숨김 | ❌ 제외 |
| `teacher` | ❌ 헤딩만 유지 | (해당 없음) | ✅ 별도 문서 |

**스크립트에서는 combined 만 실행 (사용자 9개 파일 요청 유지). 실서비스에서는 UI 옵션으로 학생/교사 분리 다운로드 가능.**

---

## 사용자 검증 항목 (v2 재검토)

### B-1 세 포맷 내용 일치
- [ ] workbook: pdf/docx/pptx 텍스트 순서·문항 번호 일치 (특히 pptx 는 슬라이드 순서로 확인)
- [ ] lessonPlan: 표 내용·이미지 위치·루브릭 일치
- [ ] openingSlides: 수업 흐름 순서 동일

### B-2 한글 폰트 fallback
- [ ] docx: MS Word 로 열기 → Pretendard 미설치 컴퓨터에서 시스템 한글 폰트 자동 대체
- [ ] docx: 한컴오피스로 열기 → 정상 표시
- [ ] pptx: PowerPoint 로 열기 → 정상 표시 (fallback)

### B-3 표·이미지 배치 (원본 비율)
- [ ] lessonPlan.pdf 이미지 원본 비율 유지 (v1: 4:3 하드코딩 → v2: sharp 원본 사용)
- [ ] lessonPlan.docx 이미지 정중앙 정렬, 캡션 이탤릭
- [ ] lessonPlan.pptx 이미지 슬라이드 (별도 슬라이드로 분리됨)

### B-4 PDF 고아 페이지 (v2 개선 핵심)
- [ ] workbook.pdf: **정답 한 줄이 별도 페이지로 넘어가지 않음** 확인
- [ ] lessonPlan.pdf: **준비물 한 줄이 별도 페이지로 넘어가지 않음** 확인
- [ ] 문항·활동 블록이 페이지 중간에 잘리지 않음

### B-5 PPT 발표용 레이아웃 (v2 개선 핵심)
- [ ] workbook.pptx: 문항 하나가 슬라이드 하나 (질문 큰 글자 + 선택지 큰 글자)
- [ ] lessonPlan.pptx: 이미지 슬라이드, 표 슬라이드, 루브릭 슬라이드 분리
- [ ] openingSlides.pptx: 수업 도입 발문이 슬라이드마다 하나
- [ ] 최소 폰트 20pt 이상 확인 (뒷자리에서도 보이는 크기)

### B-6 편집 가능
- [ ] Word 로 lessonPlan.docx 편집 (표 수정, 텍스트 추가)
- [ ] 한컴 로 docx 편집
- [ ] PowerPoint 로 pptx 편집 (슬라이드 순서 변경, 도형 편집)

---

## 발견된 이슈 & 결정

| # | 심각도 | 이슈 | 대응 |
|---|---|---|---|
| 1 | Fixed | PDF 고아 페이지 (v1) | CSS `page-break-inside: avoid` + `keepNext` 로 해결 (v2) |
| 2 | Fixed | PPT 가 A4 축소판 (v1) | 자료유형별 chunk 분리 · 발표용 폰트 크기 (v2) |
| 3 | Info | Windows 파일 잠금 (Word/PPT 열려있으면 재저장 실패) | 스크립트에 재시도 로직 추가 (5회 × 800ms) |
| 4 | Info | 이미지 dimensions 파싱 시 sharp 사용 | 프로젝트에 이미 sharp 설치돼 있음 → 추가 dep 없음 |
| 5 | 계획 | Railway 실증 & R2 파이프라인 | 로컬 검증 승인 후 별도 스텝 |

---

## Phase 1 착수 가능 여부

- [ ] **Go** — 세 포맷 모두 실사용 가능 수준
- [ ] **Go with adjustment** — 특정 렌더러 세부 조정 후 진행
- [ ] **Hold** — 이슈 해결 후 재실증

**Phase 1 착수 승인자**: 
**승인일**: 
**비고**: 

---

## Railway + R2 파이프라인 (승인 시 다음 스텝)

1. **API route 신설**: `POST /api/lab/learning-render`
   - body: `{ sampleId, format, answerVariant }`
   - 서버: 렌더러 실행 → R2 업로드 (`learning-docs/phase-0/{userId}/{docId}-{variant}.{ext}`) → 서명 URL 반환
2. **Railway Puppeteer 실증**: `@sparticuz/chromium` 자동 로드 (`useLocalChrome=false`), 콜드/웜 시간 · 메모리 측정
3. **DB**: Phase 1 에서 `learning_documents` 신설
4. **UI**: 세 포맷 아이콘 다운로드 (`answerVariant` 선택 UI 별도)

**중요 원칙 (사용자 지시)**: 실서비스에서는 클립아트·최종 문서를 **Supabase + R2** 로만 저장. `tmp/phase-0/` 은 Phase 0 검수 전용 로컬 산출물이며 `.gitignore` 처리됨.

---

## 참고 링크

- 계획: [`docs/01-plan/features/learning-helper.plan.md`](../01-plan/features/learning-helper.plan.md)
- 스키마: `src/services/learning-renderer/schema.ts`
- Sample: `src/services/learning-renderer/sample.ts`
- 이미지 로더: `src/services/learning-renderer/image-loader.ts` (v2: sharp dimensions)
- 렌더러: `src/services/learning-renderer/{pdf,docx,pptx}.ts` (v2)
- 실행 스크립트: `scripts/learning-render-sample.ts`
- Sample 삽입 이미지: `public/generate-v2_intro_01.png`
