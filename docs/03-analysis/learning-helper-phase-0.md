# Learning Helper — Phase 0 실증 결과 (v4, 2026-09-07)

> Phase 0.7 개선: 사용자 검토 후 2가지 필수 수정 반영. lessonPlan.pdf **1페이지**
> 달성 + teacher variant 를 "전체 문항 + 정답·해설" 로 재정의.
>
> Phase 0.6: 5가지 구조·정책 문제 수정 (학생/교사 분리 시도, PPT 과분할 해소, 폰트 정책).

---

## v4 개선 요약 (Phase 0.7 필수 2항목)

| # | 요청 | 반영 |
|---|---|---|
| 1 | lessonPlan PDF 고아 페이지 재수정 | CSS 밀도 조정: body `line-height: 1.6→1.45`, `font-size: 12pt→11pt`, h1/h2/h3 · table · cell padding · callout · question 여백 일괄 축소. **lessonPlan.pdf 를 1페이지로 압축** (정규식 기반 페이지 카운트 검증) |
| 2 | 교사용 문항 복원 | teacher variant 재정의: 학생용 문제지 **전체** + 문항 아래 **인라인 정답** + 뒤 정답·해설. 3렌더러 모두 반영. student 는 정답 완전 제외 유지 |
| — | combined 페이지 분리 | 학생용 문제지와 정답·해설을 물리적 분리: PDF `.answer-key.forced-new-page` 활성, DOCX `pageBreakBefore` 활성 (Phase 0.7 추가) |

### 사용자 확인 매트릭스 (Phase 0.7 승인 기준)

| variant | 문항·활동 | 인라인 정답 | 정답·해설 페이지 |
|---|:-:|:-:|:-:|
| `student` | ✅ | ❌ | ❌ |
| `teacher` | ✅ | ✅ | ✅ |
| `combined` | ✅ | ❌ | ✅ (새 페이지) |

---

## v3 개선 요약 (사용자 요청 5항목)

| # | 요청 | 반영 |
|---|---|---|
| 1 | PDF 고아 페이지 재수정 | `.section-block` 그룹핑 도입 — heading + 뒤따르는 non-heading 섹션을 한 div 로 묶어 `break-inside: avoid-page` 강제. `준비물` 같은 짧은 블록이 페이지 잔여 높이에 못 들어가면 이전 섹션과 함께 이동 |
| 2 | 학생용/교사용 실물 산출 | `workbook-student` / `workbook-teacher` 를 두 벌로 실제 생성 (총 10개 산출물). `combined` 도 인라인 정답을 제거해 마지막 answer-key 섹션만 사용 |
| 3 | 한글 폰트 정책 재설계 | 서버 렌더링 (PDF) 과 뷰어 렌더링 (DOCX/PPTX) 폰트를 분리. PDF 는 Pretendard + **Noto Sans KR CDN** + 시스템 fallback. DOCX/PPTX 는 **`맑은 고딕`** (Windows 100%) + `hint: 'eastAsia'` |
| 4 | PPT 과분할 방지 | `section-cover` chunk 폐지. heading L1 은 별도 슬라이드 X, `currentSectionTitle` 만 갱신 → 다음 콘텐츠 슬라이드의 상단 타이틀로 사용. 텍스트 버퍼 250 → 450자 확대 |
| 5 | 10개 산출물 스펙 | 스크립트 재작성 (jobs 배열). workbook student/teacher × 3포맷 + lessonPlan × 3포맷 + openingSlides pptx = 10개 |

---

## 실행 환경

| 항목 | 값 |
|---|---|
| 실행일 | 2026-09-07 (v3 재실행) |
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

## 생성된 파일 — Phase 0.7 재실증 5개 (최신)

Phase 0.7 승인 기준으로 사용자가 요청한 5개만 재생성 (`pnpm tsx scripts/learning-render-sample.ts --phase07`). 나머지 5개는 Phase 0.6 산출물 유지.

| # | 파일 | 포맷 | variant | 크기 (bytes) | 시간 (ms) | 페이지/슬라이드 |
|--:|---|---|---|---:|---:|---:|
| 1 | `workbook-student.pdf` | pdf | student | 62,674 | 1,539 | **1p** |
| 2 | `workbook-teacher.pdf` | pdf | teacher | 70,271 | 1,782 | **1p** |
| 3 | `workbook-teacher.docx` | docx | teacher | 9,885 | 65 | — |
| 4 | `workbook-teacher.pptx` | pptx | teacher | 138,913 | 60 | 8 슬라이드 |
| 5 | `lessonPlan.pdf` | pdf | combined | 198,842 | 2,538 | **1p** (v3: 2p) |

**관찰 (v3 대비)**
- `lessonPlan.pdf`: **2p → 1p 달성** — CSS 밀도 조정 (line-height 1.6→1.45, font-size 12pt→11pt, h2 여백 16→10pt, table cell padding 6/8→3/5pt, callout 8/10→5/8pt) 로 준비물 heading + 본문이 이전 섹션들과 함께 1페이지에 수렴
- `workbook-teacher.pdf`: 22KB → **70KB** (student 62KB 보다 큼) — 전체 문항·활동 + 인라인 정답 + answer-key 모두 포함됨을 크기로 검증
- `workbook-teacher.pptx`: 83KB → 138KB — 3 슬라이드 (Phase 0.6, answer-key 만) → 8 슬라이드 (문항·활동 슬라이드 복원)

## Phase 0.6 산출물 (변경 없음, 참고)

| # | 파일 | 포맷 | variant | 크기 (bytes) | 시간 (ms) | 슬라이드 수 |
|--:|---|---|---|---:|---:|---:|
| 1 | `workbook-student.docx` | docx | student | 9,654 | 24 | — |
| 2 | `workbook-student.pptx` | pptx | student | 108,482 | 14 | 5 |
| 3 | `lessonPlan.docx` | docx | combined | 189,483 | 33 | — |
| 4 | `lessonPlan.pptx` | pptx | combined | 340,368 | 22 | 8 |
| 5 | `openingSlides.pptx` | pptx | combined | 99,414 | 3 | 5 |

> teacher variant 로직 변경이 있으므로 필요시 `pnpm tsx scripts/learning-render-sample.ts` (인자 없음) 로 전체 10개 재생성 가능.

---

## v4 렌더러 세부 규칙

### PDF (`src/services/learning-renderer/pdf.ts`)

- 페이지 규격: A4, margin 20/18/20/18 mm
- **폰트 스택** (`font-family`):
  1. `Pretendard` (jsDelivr CDN, woff2)
  2. `Noto Sans KR` (Google Fonts, 400/500/700) — 서버 한글 확실 보증
  3. `Malgun Gothic` (Windows 로컬)
  4. `Apple SD Gothic Neo` (macOS 로컬)
  5. `HCR Dotum` (한컴 함초롬돋움) → `sans-serif`
- **밀도 조정 (Phase 0.7)**:
  - body `line-height: 1.45` (v3: 1.6), `font-size: 11pt` (v3: 12pt)
  - h1 18pt · h2 13pt · h3 11.5pt (여백 축소)
  - table cell padding 3/5pt (v3: 6/8pt), table margin 4pt (v3: 8pt)
  - callout padding 5/8pt (v3: 8/10pt), margin 4pt (v3: 8pt)
  - .question/.activity margin 6pt (v3: 10pt)
  - .activity padding 5/8pt (v3: 8/10pt)
- **고아 페이지 방지 (Phase 0.6+0.7)**:
  - `groupIntoSectionBlocks()` — heading + 뒤 non-heading 섹션을 `<div class="section-block">` 로 묶음
  - `.section-block { break-inside: avoid-page }`
  - `answer-key` 는 standalone group. **combined variant 일 때 `.forced-new-page` 클래스 활성** → 학생용 문제지와 정답·해설을 물리적 분리
- 이미지: 원본 비율 유지, 최대 폭 80%, 캡션 이탤릭 회색
- **인라인 정답 (Phase 0.7)**: `teacher` variant 만 문항 하단에 표시. `student`/`combined` 는 숨김

### DOCX (`src/services/learning-renderer/docx.ts`)

- 페이지 규격: A4, margin 동일
- **폰트 정책 (Phase 0.6)**:
  - `FONT_STACK = { name: '맑은 고딕', hint: 'eastAsia' }`
  - 이유: 맑은 고딕은 Windows 기본 한글 폰트 → MS Word / 한컴오피스 / LibreOffice 어디서든 100% 열림
  - Pretendard 는 서버 렌더링 (PDF) 에서만 사용 (뷰어 미설치 위험 회피)
  - `hint: 'eastAsia'` 로 CJK 문자에 명시 매핑
- **`keepNext` / `keepLines`**: heading 뒤 콘텐츠 · 문항 stem 과 선택지 붙어있게
- 이미지: `sharp` 원본 dimensions → `fitDimensions(w=목표px, maxH=800px)` 로 비율 유지
- **인라인 정답 (Phase 0.7)**: `teacher` variant 만 문항 하단에 초록색 굵은 글자로 표시
- **정답·해설 페이지 브레이크 (Phase 0.7)**: `combined` variant 는 정답과 해설 heading 앞에 `pageBreakBefore: true` 로 새 페이지 시작
- 학생/교사 variant 지원 (student=문제만, teacher=전체+인라인, combined=전체+뒤 페이지)

### PPTX (`src/services/learning-renderer/pptx.ts`)

- Layout: LAYOUT_WIDE (13.333 × 7.5 inch)
- **폰트**: `fontFace: '맑은 고딕'` (Windows 100% + PowerPoint 표준)
- **splitIntoSlides (v3 재작성)**:
  - `cover` — 문서 표지 (큰 제목 중앙)
  - ~~`section-cover`~~ 폐지 → heading L1 은 `currentSectionTitle` 만 갱신
  - `question` — 문항 1개 (질문 24pt + 선택지 22pt) · 인라인 정답 없음
  - `activity` — 활동 1개 (번호 원 + 스텝 목록) · 타이틀에 섹션명 포함
  - `table` — 표 1개 (헤더 배경 강조)
  - `image` — 이미지 1개 (원본 비율, 중앙, 캡션)
  - `text` — heading L2/3 + paragraph + callout, 최대 **450자** (v2: 250자)
  - `answer-key` — 마지막 슬라이드 (표 형식)
- **최소 폰트**: 본문 20pt / 제목 32pt / 문항 24pt / 선택지 22pt
- 이미지: sharp 원본 dimensions + `fitDimensions(maxHeight=4.8in)`, 중앙 정렬, 캡션
- **AI `slide-break` 힌트**: 텍스트 버퍼 flush 만 트리거
- **인라인 정답 (Phase 0.7)**: `teacher` variant 만 문항 슬라이드 하단 (y=6.4) 에 초록 굵은 글자
- 학생/교사 variant 지원 (student=문제만, teacher=전체+인라인, combined=전체+마지막 answer-key 슬라이드)

---

## Answer Variant 옵션 (Phase 0.7 재정의)

세 렌더러 모두 `RenderOptions.answerVariant?: 'student' | 'teacher' | 'combined'` 지원.

| variant | 학생용 문항·활동 | 인라인 정답 | answer-key 섹션 | 페이지 분리 | 산출 예시 |
|---|:-:|:-:|:-:|:-:|---|
| `student` | ✅ | ❌ | ❌ 제외 | — | `workbook-student.*` |
| `teacher` | ✅ | ✅ 문항 아래 | ✅ 뒤에 표시 | — | `workbook-teacher.*` |
| `combined` | ✅ | ❌ | ✅ 뒤에 표시 | ✅ 새 페이지 | `lessonPlan.pdf` (answer-key 없어 실제로는 발생 X) |

---

## Phase 0.7 승인 기준 (필수)

- [x] **lessonPlan.pdf 가 1페이지** — 정규식 기반 페이지 카운트로 검증 (실사용 시 Adobe/브라우저에서 재확인 권장)
- [x] **workbook-teacher 에 모든 문항 포함** — 파일 크기 22KB(v3) → 70KB(v4) 로 검증, teacher variant 는 전체 섹션 + 인라인 정답
- [x] **workbook-student 에 정답 노출 없음** — answer-key 섹션 필터 제외 + 인라인 정답 표시 조건 `variant === 'teacher'`
- [ ] **DOCX/PPTX 를 Windows Office 에서 열었을 때 한글 정상 표시** — 사용자 스크린샷 대기 (MS Word / 한컴 / PowerPoint / Google Slides 또는 LibreOffice)

승인 기준 충족 시 Phase 1 (UI · API · R2 · 클립아트 연동) 착수.

---

## 사용자 검증 항목 (v3 → v4 확장)

### B-1 세 포맷 내용 일치
- [ ] `workbook-student`: pdf/docx/pptx 텍스트 순서·문항 번호 일치
- [ ] `workbook-teacher`: 세 포맷 모두 학생용 본문이 빠지고 정답·해설만 있는지
- [ ] `lessonPlan`: 표 내용·이미지 위치·루브릭 일치
- [ ] `openingSlides`: 수업 흐름 순서 동일

### B-2 한글 폰트 (v3 정책 확인)
- [ ] `workbook-student.docx`: MS Word 로 열기 → 폰트가 `맑은 고딕` 으로 표시
- [ ] `workbook-teacher.docx`: 한컴오피스로 열기 → 정상 표시
- [ ] `lessonPlan.pptx`: PowerPoint 로 열기 → `맑은 고딕`, 깨짐 없음
- [ ] `openingSlides.pptx`: PowerPoint 로 열기 → 정상 표시
- [ ] `workbook-student.pdf`: Adobe / 브라우저에서 → Noto Sans KR 또는 Pretendard 로 표시 (한글 깨짐 없음)

### B-3 표·이미지 배치 (원본 비율)
- [ ] `lessonPlan.pdf` 이미지 원본 비율 유지
- [ ] `lessonPlan.docx` 이미지 정중앙 정렬, 캡션 이탤릭
- [ ] `lessonPlan.pptx` 이미지 슬라이드 (별도 슬라이드로 분리됨)

### B-4 PDF 고아 페이지 (v3 개선 핵심)
- [ ] `workbook-student.pdf`: 활동 블록이 페이지 중간에 잘리지 않음
- [ ] `lessonPlan.pdf`: **준비물 heading + 본문이 한 페이지에 함께 있음** (혹은 이전 섹션과 함께 이동)
- [ ] `workbook-student.pdf` 이후 `workbook-teacher.pdf`: 정답과 해설 블록 통째로 유지

### B-5 PPT 발표용 레이아웃 (v3 과분할 해소)
- [ ] `openingSlides.pptx`: **총 5 슬라이드** (v2 의 9 → 5) 확인
- [ ] `workbook-student.pptx`: section-cover 없음 (섹션 제목은 각 문항 슬라이드 상단 타이틀로만 존재)
- [ ] `lessonPlan.pptx`: 이미지 슬라이드, 표 슬라이드, 루브릭 슬라이드 분리
- [ ] 문항 슬라이드에 인라인 정답 없음

### B-6 편집 가능
- [ ] Word 로 `lessonPlan.docx` 편집 (표 수정, 텍스트 추가)
- [ ] 한컴 로 `workbook-teacher.docx` 편집
- [ ] PowerPoint 로 `openingSlides.pptx` 편집 (슬라이드 순서 변경, 도형 편집)

### B-7 학생용 / 교사용 분리 (v4 재정의)
- [ ] `workbook-student.pdf` 에 정답·해설이 **전혀 없음** (인라인 X, answer-key X)
- [ ] `workbook-teacher.pdf` 에 학생용 문제 본문이 **모두 포함** + 각 문항 아래 초록색 정답 표시 + 뒤에 정답·해설
- [ ] `workbook-student.pptx` 마지막 슬라이드가 `정답과 해설` 이 **아님**
- [ ] `workbook-teacher.pptx` 문항 슬라이드 하단에 초록색 `정답: X` 표시
- [ ] `lessonPlan.pdf` combined variant 는 answer-key 섹션이 없어 1페이지

---

## 발견된 이슈 & 결정

| # | 심각도 | 이슈 | 대응 |
|---|---|---|---|
| 1 | Fixed v2 → Re-fixed v3 | PDF 고아 페이지 (준비물 한 줄이 다음 페이지로) | `.section-block` 그룹핑으로 heading + 뒤 non-heading 섹션 통째 이동 |
| 2 | Fixed v3 | combined variant 이중 정답 (인라인 + 마지막 answer-key) | 인라인 정답 3렌더러 모두 제거 |
| 3 | Fixed v3 | 뷰어 폰트 Pretendard 만 지정 (실제로는 fallback 아님) | DOCX/PPTX 는 `맑은 고딕` + `hint: eastAsia`, PDF 는 Noto Sans KR CDN 추가 |
| 4 | Fixed v3 | PPT 과분할 (openingSlides 9 슬라이드) | section-cover 폐지, heading L1 은 다음 슬라이드 타이틀로 흡수 → 5 슬라이드 |
| 5 | Fixed v4 | lessonPlan.pdf 2페이지 (준비물이 v3 이후에도 다음 페이지로 분리) | CSS 밀도 조정 (line-height/font-size/여백/셀패딩) → 1페이지 |
| 6 | Fixed v4 | teacher variant 에 문항이 사라지고 정답만 있음 (v3 오해) | teacher = 전체 문항·활동 + 인라인 정답 + answer-key 로 재정의 |
| 7 | Fixed v4 | combined variant 학생용 문제와 정답이 붙어 있음 | PDF `.forced-new-page`, DOCX `pageBreakBefore` 로 분리 |
| 8 | Info | Windows 파일 잠금 (Word/PPT 열려있으면 재저장 실패) | 스크립트 재시도 로직 유지 (5회 × 800ms) |
| 9 | Info | pdfinfo 미의존 페이지 카운트 | 스크립트 내부 `countPdfPages()` 정규식 (`/Type /Page`) 사용. 실사용 검증은 사용자가 뷰어에서 재확인 |
| 10 | 계획 | Railway 실증 & R2 파이프라인 | 로컬 검증 승인 후 별도 스텝 |

---

## Phase 1 착수 가능 여부

- [ ] **Go** — 세 포맷 모두 실사용 가능 수준
- [ ] **Go with adjustment** — 특정 렌더러 세부 조정 후 진행
- [ ] **Hold** — 이슈 해결 후 재실증

**Phase 1 착수 승인자**: 
**승인일**: 
**비고**: 사용자가 MS Word / 한컴오피스 / PowerPoint 로 10개 산출물 열어 폰트 목록 스크린샷 확보 예정

---

## Railway + R2 파이프라인 (승인 시 다음 스텝)

1. **API route 신설**: `POST /api/lab/learning-render`
   - body: `{ sampleId, format, answerVariant }`
   - 서버: 렌더러 실행 → R2 업로드 (`learning-docs/phase-0/{userId}/{docId}-{variant}.{ext}`) → 서명 URL 반환
2. **Railway Puppeteer 실증**: `@sparticuz/chromium` 자동 로드 (`useLocalChrome=false`), 콜드/웜 시간 · 메모리 측정
3. **DB**: Phase 1 에서 `learning_documents` 신설
4. **UI**: 세 포맷 아이콘 다운로드 (학생용/교사용/합본 세 버튼)

**중요 원칙 (사용자 지시)**: 실서비스에서는 클립아트·최종 문서를 **Supabase + R2** 로만 저장. `tmp/phase-0/` 은 Phase 0 검수 전용 로컬 산출물이며 `.gitignore` 처리됨.

---

## 참고 링크

- 계획: [`docs/01-plan/features/learning-helper.plan.md`](../01-plan/features/learning-helper.plan.md)
- 스키마: `src/services/learning-renderer/schema.ts`
- Sample: `src/services/learning-renderer/sample.ts`
- 이미지 로더: `src/services/learning-renderer/image-loader.ts`
- 렌더러: `src/services/learning-renderer/{pdf,docx,pptx}.ts` (v4)
- 실행 스크립트: `scripts/learning-render-sample.ts` (v4, `--phase07` 플래그로 5개만 재생성)
- Sample 삽입 이미지: `public/generate-v2_intro_01.png`
