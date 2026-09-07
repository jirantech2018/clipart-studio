# Learning Helper — Phase 0 실증 결과

> Phase 0 목표: 동일한 하나의 LearningDocument sample 로 세 포맷(pdf/docx/pptx)을 생성해 실사용 가능성 검증.

---

## 실행 환경

| 항목 | 값 |
|---|---|
| 실행일 | 2026-09-07 (13:22 KST) |
| 실행자 | Claude Code (개발자 환경, 사용자 로컬 머신 위임) |
| OS | Windows 11 |
| Node | v20.x (`pnpm tsx` 로 실행) |
| Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe` (시스템 크롬, `puppeteer-core` 로 원격 제어) |
| Railway 티어 | (별도 단계 예정 — Phase 0 로컬 검증 후) |

---

## 라이브러리

| 패키지 | 버전 | 용도 |
|---|---|---|
| `puppeteer-core` | 최신 | PDF 렌더 (Chromium 원격 제어) |
| `@sparticuz/chromium` | 최신 | Railway/서버리스 Linux 용 Chromium (로컬은 시스템 크롬 사용) |
| `docx` | 최신 | Word 파일 생성 |
| `pptxgenjs` | 최신 | PPT 파일 생성 |
| `tsx` (dev) | 4.23.13 | 스크립트 실행 |

---

## Sample 문서 3종

| 이름 | 자료유형 | 학년/과목 | 특이사항 |
|---|---|---|---|
| workbook | 객관식 문제집 (문항 3개 + 활동 1개 + 정답·해설) | 3학년 국어 | 문제·정답 구성 검증 |
| lessonPlan | 수업안 (표 + 루브릭 + **이미지 1장**) | 5학년 수학 | 표/이미지 배치 검증 |
| openingSlides | 수업 도입 슬라이드 (`slide-break` 3개) | 2학년 통합교과 | 자동 슬라이드 분할 검증 |

**삽입한 클립아트**: `public/generate-v2_intro_01.png` (프로젝트 내 실제 이미지, `width=50%`) → 세 포맷 모두 실제 이미지 삽입 확인 (파일 크기로 즉시 확인 가능).

---

## A. 세 포맷 산출물 지표 (로컬 실측)

| Sample | 포맷 | 크기 (bytes) | 로컬 생성 시간 (ms) |
|---|---|---:|---:|
| workbook | pdf | 67,516 | 1,505 |
| workbook | docx | 9,631 | 34 |
| workbook | pptx | 56,289 | 25 |
| lessonPlan | **pdf** (이미지 포함) | **196,894** | 1,131 |
| lessonPlan | **docx** (이미지 포함) | **189,280** | 71 |
| lessonPlan | **pptx** (이미지 포함) | **266,627** | 24 |
| openingSlides | pdf | 124,771 | 1,167 |
| openingSlides | docx | 9,510 | 11 |
| openingSlides | pptx | 84,248 | 14 |

**관찰**
- **PDF** 는 크롬 실행 오버헤드로 1~1.5초 (첫 호출도 포함). Puppeteer 브라우저 launch/close 를 스크립트 실행마다 반복 (재사용 안 함).
- **DOCX / PPTX** 는 순수 Node → **수 ms ~ 수십 ms**. 매우 가벼움. Railway 부담 거의 없을 것으로 예상.
- 이미지 포함 3파일 (lessonPlan) 모두 크기가 확연히 커짐 → **이미지가 실제로 인라인됨을 파일 크기로 확인**.
- pptx openingSlides: `splitIntoSlides()` 가 미리보기 로그로 **4 slides** 출력 → `slide-break` 마커 3개 + 문서 시작 1개 정상.

---

## B. 사용자 검증 항목 (사용자가 각 파일 열어 채워주세요)

### B-1 세 포맷의 내용 일치
- [ ] workbook: pdf/docx/pptx 텍스트 순서·문항 번호 일치
- [ ] lessonPlan: 표 내용·이미지·루브릭 순서 일치
- [ ] openingSlides: 슬라이드 순서·발문 텍스트 일치

### B-2 한글 폰트와 줄바꿈
- [ ] pdf: Pretendard 정상 렌더 (Puppeteer 가 CDN woff2 를 로드)
- [ ] docx: Word 열람 시 Pretendard 지정 확인 (**폰트 embed 없음** → Pretendard 미설치 환경은 fallback)
- [ ] pptx: PowerPoint 열람 시 Pretendard 지정 확인 (동일)

### B-3 표·이미지 배치
- [ ] lessonPlan.pdf 표(수업 흐름) 셀 경계·정렬
- [ ] lessonPlan.docx 표 편집 가능, 이미지 중앙 정렬
- [ ] lessonPlan.pptx 표 자동 배치, 이미지 중앙 배치
- [ ] 이미지 (public/generate-v2_intro_01.png) 세 포맷에 모두 삽입됨 (파일 크기 189KB / 267KB / 197KB로 확인)

### B-4 페이지·슬라이드 자동 분할
- [ ] workbook.pdf 페이지 자동 분할 · 문항 잘림 없음 (`page-break-inside: avoid`)
- [ ] openingSlides.pptx **4개 슬라이드 자동 분할** (표지 → 발문 → 표 → 활동)
- [ ] `splitIntoSlides()` 기본 임계값 튜닝 필요 여부:
  - `maxQuestionsPerSlide=3`
  - `maxCharsPerSlide=400`
  - `maxRowsPerSlideTable=8`
  - `maxImagesPerSlide=2`

### B-5 실제 편집 가능 여부
- [ ] Word (Microsoft 365) 로 docx 열기 → 텍스트 수정 → 저장 → 재열람 정상
- [ ] 한컴오피스 로 docx 열기
- [ ] PowerPoint (Microsoft 365) 로 pptx 열기 → 슬라이드 순서 변경 · 도형 편집
- [ ] Keynote 로 pptx 열기 (Mac 시)
- [ ] Google Slides 로 pptx 열기

### B-6 Railway 리소스 (별도 단계)
- [ ] Railway 배포 후 콜드 스타트: `___초`
- [ ] Railway 웜 응답: `___초`
- [ ] RSS 메모리 피크 (Puppeteer 실행 중): `___MB`
- [ ] Railway Hobby RAM 상한 (512MB) 내 안정 동작 여부: [ ] 안정 / [ ] 불안정

**Railway 실증은 R2 저장/다운로드 파이프라인과 함께 별도 스텝으로 진행 예정.**

---

## C. 발견된 이슈 & 결정 사항

| # | 심각도 | 이슈 | 대응 |
|---|---|---|---|
| 1 | Low | Puppeteer 브라우저 launch/close 마다 1s+ 소요 | Phase 1 에서 warm browser pool 도입 검토 (동시성 낮으면 매번 launch 도 OK) |
| 2 | Info | docx/pptx 는 초경량 (수 ms ~ 수십 ms) → Railway 부담 없음 | PDF 만 Railway 리소스 초점 |
| 3 | Info | Pretendard 는 문서 내 폰트 이름만 지정, embed 없음 | pptx/docx 는 사용자 컴퓨터에 폰트 없으면 fallback 표시. UI에 안내 문구 필수 (계획서 §2.4 확정) |
| 4 | Info | 이미지 세 포맷 모두 정상 삽입 (파일 크기로 확인) | `image-loader` 로 base64/Buffer 통합 처리 성공 |

---

## D. 슬라이드 분할 기준값 (Phase 0 초안)

`src/services/learning-renderer/pptx.ts` 의 `SPLIT` 상수. Phase 0 sample 로는 아래 기본값이 안정 동작:

```ts
const SPLIT = {
  maxQuestionsPerSlide: 3,
  maxCharsPerSlide: 400,
  maxRowsPerSlideTable: 8,
  maxImagesPerSlide: 2,
};
```

**openingSlides 결과**: `slide-break` 마커 3개 → 총 4 슬라이드 자동 분할 확인.
**튜닝 필요 여부**: 사용자가 pptx 파일을 실제로 열어 검토 후 최종 확정. 임계값을 낮추면 슬라이드가 더 많아지고, 높이면 슬라이드당 내용이 많아짐.

---

## E. Phase 1 착수 가능 여부 (사용자 결정)

- [ ] **Go** — 세 포맷 모두 실사용 가능 수준 · Railway 실증도 함께 진행
- [ ] **Go with fallback** — PDF 는 react-pdf 로 대체 결정 · 나머지 유지
- [ ] **Hold** — 이슈 해결 후 재실증
- [ ] **Escalate** — Railway 티어 상향 or 다른 인프라 검토 필요

**Phase 1 착수 승인자**: 
**승인일**: 
**비고**: 

---

## F. Railway + R2 파이프라인 (Phase 0 후반부 / Phase 1 초반)

로컬 검증이 만족스러우면 다음 순서로 확장:

1. **API route 신설**: `POST /api/lab/learning-render`
   - body: `{ sampleId: 'workbook' | 'lessonPlan' | 'openingSlides', format: 'pdf' | 'docx' | 'pptx' }`
   - 서버: 렌더러 실행 → R2 업로드 (`learning-docs/phase-0/{userId}/{docId}.{ext}`) → 서명 URL 반환 or 즉시 다운로드 stream
   - 관리자만 접근 (지금은 사용자 본인만 실증)
2. **R2 저장 경로 규약**
   - `learning-docs/{orgId}/{docId}.{pdf|docx|pptx}` (Phase 1 정식)
   - Phase 0 실증은 `learning-docs/phase-0/*` prefix
3. **DB 저장 (Phase 1)**
   - `learning_documents` 테이블: docId, orgId, userId, meta(jsonb), r2Keys(jsonb: {pdf, docx, pptx})
   - 생성 시 사용자가 선택한 포맷만 즉시 렌더 → R2 업로드
4. **UI**: 사용자가 렌더 완료 후 세 포맷 아이콘 노출, 클릭 시 R2 서명 URL 다운로드

**중요 (사용자 지시)**: 실서비스에서는 클립아트·최종 문서를 **로컬(tmp/)에 영구 저장하지 않고 Supabase + R2** 사용. `tmp/phase-0/` 은 Phase 0 검수 목적 로컬 산출물 전용이며 `.gitignore` 처리됨.

---

## G. 참고 링크

- 계획: [`docs/01-plan/features/learning-helper.plan.md`](../01-plan/features/learning-helper.plan.md)
- 지시서 원본: 사용자 별도 전달 예정 → `docs/00-pm/learning-helper.prd.md`
- 스키마: `src/services/learning-renderer/schema.ts`
- Sample: `src/services/learning-renderer/sample.ts`
- 이미지 로더: `src/services/learning-renderer/image-loader.ts`
- 렌더러: `src/services/learning-renderer/{pdf,docx,pptx}.ts`
- 실행 스크립트: `scripts/learning-render-sample.ts`
- Sample 삽입 이미지: `public/generate-v2_intro_01.png`
