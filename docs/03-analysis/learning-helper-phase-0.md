# Learning Helper — Phase 0 실증 결과 (v3, 2026-09-07)

> Phase 0.6 개선: 사용자 검토 후 5가지 구조·정책 문제 수정. 학생용/교사용 실물 분리
> 산출 + PPT 과분할 해소 + 뷰어 기본 폰트 재설계.

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

## 생성된 10개 파일 (v3, 최신)

| # | 파일 | 포맷 | variant | 크기 (bytes) | 시간 (ms) | 슬라이드 수 |
|--:|---|---|---|---:|---:|---:|
| 1 | `workbook-student.pdf` | pdf | student | 62,322 | 1,492 | — |
| 2 | `workbook-student.docx` | docx | student | 9,654 | 24 | — |
| 3 | `workbook-student.pptx` | pptx | student | 108,482 | 14 | 5 |
| 4 | `workbook-teacher.pdf` | pdf | teacher | 22,112 | 1,248 | — |
| 5 | `workbook-teacher.docx` | docx | teacher | 9,349 | 7 | — |
| 6 | `workbook-teacher.pptx` | pptx | teacher | 83,462 | 5 | 3 |
| 7 | `lessonPlan.pdf` | pdf | combined | 199,184 | 1,590 | — |
| 8 | `lessonPlan.docx` | docx | combined | 189,483 | 33 | — |
| 9 | `lessonPlan.pptx` | pptx | combined | 340,368 | 22 | 8 |
| 10 | `openingSlides.pptx` | pptx | combined | 99,414 | 3 | **5** |

**관찰 (v2 대비)**
- `openingSlides.pptx`: **9 → 5 슬라이드** (section-cover 4개 제거 효과 확인)
- `workbook.pptx`: 9 → 5 (표지 + 문항 3 + 활동 1 + text 없음, section-cover 폐지)
- `workbook-student.pdf` 62KB / `workbook-teacher.pdf` 22KB → 학생용은 학습지 전체 / 교사용은 answer-key + heading 만 (사이즈 격차가 정상적으로 분리 확인)
- 문항이 학생용에서 인라인 정답 없이 순수 문제만 표시됨

---

## v3 렌더러 세부 규칙

### PDF (`src/services/learning-renderer/pdf.ts`)

- 페이지 규격: A4, margin 20/18/20/18 mm
- **폰트 스택** (`font-family`):
  1. `Pretendard` (jsDelivr CDN, woff2)
  2. `Noto Sans KR` (Google Fonts, 400/500/700) — 서버 한글 확실 보증
  3. `Malgun Gothic` (Windows 로컬)
  4. `Apple SD Gothic Neo` (macOS 로컬)
  5. `HCR Dotum` (한컴 함초롬돋움) → `sans-serif`
- **고아 페이지 방지 (Phase 0.6)**:
  - `groupIntoSectionBlocks()` — heading + 뒤 non-heading 섹션을 하나의 `<div class="section-block">` 로 묶음
  - `.section-block { break-inside: avoid-page }` → 짧은 블록이 페이지 잔여 높이에 못 들어가면 이전 섹션과 함께 이동
  - `answer-key` 는 자체 처리 (standalone group)
  - 추가로 heading `break-after: avoid-page`, question/activity `break-inside: avoid-page`, `orphans/widows: 3`
- 이미지: 원본 비율 유지, 최대 폭 80%, 캡션 이탤릭 회색
- **인라인 정답 제거**: variant 무관하게 문항 내부에는 정답 표시 X. `answer-key` 섹션만 사용

### DOCX (`src/services/learning-renderer/docx.ts`)

- 페이지 규격: A4, margin 동일
- **폰트 정책 (Phase 0.6)**:
  - `FONT_STACK = { name: '맑은 고딕', hint: 'eastAsia' }`
  - 이유: 맑은 고딕은 Windows 기본 한글 폰트 → MS Word / 한컴오피스 / LibreOffice 어디서든 100% 열림
  - Pretendard 는 서버 렌더링 (PDF) 에서만 사용 (뷰어 미설치 위험 회피)
  - `hint: 'eastAsia'` 로 CJK 문자에 명시 매핑
- **`keepNext` / `keepLines`**: heading 뒤 콘텐츠 · 문항 stem 과 선택지 붙어있게
- 이미지: `sharp` 원본 dimensions → `fitDimensions(w=목표px, maxH=800px)` 로 비율 유지
- **인라인 정답 제거**: `combined` 도 마지막 `정답과 해설` heading + 목록만 사용
- 학생/교사 variant 지원

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
- **인라인 정답 제거**: variant 무관
- 학생/교사 variant 지원

---

## Answer Variant 옵션 (실행 확인)

세 렌더러 모두 `RenderOptions.answerVariant?: 'student' | 'teacher' | 'combined'` 지원.

| variant | 학생용 문제 | 인라인 정답 | answer-key 섹션 | 산출 예시 |
|---|:-:|:-:|:-:|---|
| `combined` (기본) | ✅ | ❌ (v3 제거) | ✅ 문서 뒤 | `lessonPlan.*`, `openingSlides.pptx` |
| `student` | ✅ | ❌ 제거 | ❌ 제외 | `workbook-student.*` |
| `teacher` | ❌ heading + callout 만 | (해당 없음) | ✅ 별도 문서 | `workbook-teacher.*` |

---

## 사용자 검증 항목 (v3 재검토)

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

### B-7 학생용 / 교사용 분리 (v3 신규)
- [ ] `workbook-student.pdf` 에 정답·해설이 **전혀 없음**
- [ ] `workbook-teacher.pdf` 에 학생용 문제 본문이 **전혀 없음** (정답·해설만)
- [ ] `workbook-student.pptx` 마지막 슬라이드가 `정답과 해설` 이 **아님** (활동 or text 로 끝)

---

## 발견된 이슈 & 결정

| # | 심각도 | 이슈 | 대응 |
|---|---|---|---|
| 1 | Fixed v2 → Re-fixed v3 | PDF 고아 페이지 (준비물 한 줄이 다음 페이지로) | `.section-block` 그룹핑으로 heading + 뒤 non-heading 섹션 통째 이동 |
| 2 | Fixed v3 | combined variant 이중 정답 (인라인 + 마지막 answer-key) | 인라인 정답 3렌더러 모두 제거 |
| 3 | Fixed v3 | 뷰어 폰트 Pretendard 만 지정 (실제로는 fallback 아님) | DOCX/PPTX 는 `맑은 고딕` + `hint: eastAsia`, PDF 는 Noto Sans KR CDN 추가 |
| 4 | Fixed v3 | PPT 과분할 (openingSlides 9 슬라이드) | section-cover 폐지, heading L1 은 다음 슬라이드 타이틀로 흡수 → 5 슬라이드 |
| 5 | Info | Windows 파일 잠금 (Word/PPT 열려있으면 재저장 실패) | 스크립트 재시도 로직 유지 (5회 × 800ms) |
| 6 | 계획 | Railway 실증 & R2 파이프라인 | 로컬 검증 승인 후 별도 스텝 |

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
- 렌더러: `src/services/learning-renderer/{pdf,docx,pptx}.ts` (v3)
- 실행 스크립트: `scripts/learning-render-sample.ts` (v3, 10개 jobs)
- Sample 삽입 이미지: `public/generate-v2_intro_01.png`
