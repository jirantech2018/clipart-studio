# Learning Helper — 초등 학습지·활동지 생성 AI (Feasibility & Plan v0.3)

**Status**: **Phase 0 착수 승인 (2026-09-04)**
**Author date**: 2026-09-04
**Source directive**: `docs/00-pm/learning-helper.prd.md` (원본 md: 사용자 첨부, UTF-8 저장 필요)
**Placement target**: `clipart-studio` 프로젝트 내부, `/organization/*/generate` 옆에 신규 서브 페이지로 통합

**Version history**
- v0.1 — 초안. PDF만 Phase 1, Word Phase 2, PPT Phase 3(선택).
- v0.2 — 세 포맷(PDF/Word/PPT) 모두 Phase 1에 포함. §2·§5·§8·§9 갱신.
- **v0.3** — Phase 0 착수 승인. D-1/D-4/D-13 확정. slide-break 정책 확정. Phase 0 검증 항목 상세화.

---

## 1. Executive Summary

지시서에 기술된 학년/과목/공통학습주제/자료유형 조합을 입력받아 AI가 문제·활동지·수업안 등 초등 학습 자료를 생성하고, 이를 **PDF / Word / PPT 파일**로 내려받게 하는 기능이다.

**핵심 결론 (v0.2)**
1. **세 포맷 모두 기술적으로 가능**하며 **모두 Phase 1에서 동시 지원**한다. Node 서버(Railway) 환경에서 검증된 라이브러리가 있다.
2. 공통 산출물 스키마(JSON) 하나를 SoT 로 두고 **세 개의 렌더러**(pdf/docx/pptx)가 그 스키마에서 파생하는 구조로 개발 부담을 최소화한다.
3. clipart-studio 안에 통합해 조직·크레딧·인증·이미지 파이프라인을 그대로 재사용한다.
4. 신설 도메인이라 DB 6개 테이블 + seed 데이터가 큰 편이고, **세 렌더러를 함께 만드는 MVP는 3~3.5주**.

**추천 진행 (v0.3 확정)**: Phase 1은 **국어/수학 1~6학년 × 5개 대표 자료유형** 을 기준으로 **PDF/Word/PPT 세 포맷 모두** 지원한다. UI 학년 선택은 학년군이 아닌 **1학년부터 6학년까지 각각 선택** 가능. 자료유형별 기본 포맷은 §2.4 매트릭스로 지정하되 사용자가 세 포맷 모두 선택 가능.

---

## 2. Output Format Feasibility (핵심 검토, v0.2 세 포맷 동시 지원 확정)

### 2.0 공통 산출물 스키마 (SoT)

세 렌더러가 각자 프롬프트를 만들면 유지보수 부담이 3배가 된다. 대신 **AI 출력은 하나의 JSON 스키마**로만 받고, 세 렌더러가 그 스키마를 각자 해석한다.

```ts
// LearningDocument SoT (요약)
interface LearningDocument {
  meta: {
    title: string;
    grade: number;
    subject: string;
    materialType: string;
    difficulty: 'easy' | 'normal' | 'hard';
    estimatedMinutes: number;
    teacherReviewRequired: true;
  };
  sections: Array<
    | { kind: 'heading'; level: 1 | 2 | 3; text: string }
    | { kind: 'paragraph'; text: string }
    | { kind: 'question'; qtype: 'ox' | 'mc' | 'short' | 'blank' | 'essay';
        stem: string; choices?: string[]; answer?: string; hint?: string }
    | { kind: 'activity'; steps: string[]; materials?: string[] }
    | { kind: 'table'; rows: string[][]; headers?: string[] }
    | { kind: 'callout'; tone: 'info' | 'warn' | 'tip'; text: string }
    | { kind: 'image'; source: 'clipart' | 'ai'; assetRef: string; caption?: string }
    | { kind: 'slide-break' }   // pptx 전용 marker (다른 렌더러는 무시)
  >;
  answerKey?: Array<{ ref: string; answer: string; rationale?: string }>;
  rubric?: Array<{ criterion: string; levels: string[] }>;
}
```

**렌더러 매핑**
- **pdf**: HTML/CSS 로 변환 → Puppeteer 캡처
- **docx**: `docx` 라이브러리의 `Paragraph`/`Table`/`ImageRun` 로 직접 매핑
- **pptx**: `slide-break` 로 나눠 pptxgenjs 슬라이드 생성. `slide-break` 없으면 heading 단위로 자동 분할

### 2.1 PDF — **★ Phase 1 필수**

**용도**: 학습지·활동지·평가지 인쇄. 사용자 90% 이상의 니즈.

**옵션**
| 옵션 | 장점 | 단점 | 판단 |
|---|---|---|---|
| **Puppeteer + @sparticuz/chromium** | HTML/CSS 자유 레이아웃, 인쇄 품질 최고, 한글 폰트 완벽 | Chromium 실행 리소스 (Railway 512MB 기본 여유롭지 않음), 콜드 스타트 2~4초 | **첫 후보** |
| **@react-pdf/renderer** | React 컴포넌트로 PDF 작성, 리소스 가벼움 | CSS 표현력 제한 (Flexbox 부분 지원), 표·수식 렌더링 손이 감 | **후보** |
| **pdfkit** | 저수준 컨트롤 | 수동 좌표 지정, 유지보수 부담 | 비추천 |

**한글 처리**: Puppeteer는 Chromium 내장이라 문제 없음. react-pdf는 Pretendard woff2 preload 필요.

**Railway 실증 필요**: `@sparticuz/chromium` + `puppeteer-core` 조합이 Railway Hobby ($5) 에서 안정 동작하는지 콜드 스타트/메모리/타임아웃 벤치 필수. 실증 결과에 따라 react-pdf로 fallback 준비.

**결론**: **Puppeteer 시도 → 리소스 문제 시 react-pdf 로 전환**. 두 접근 모두 산출물이 HTML 스키마로 통일되면 렌더러 교체가 쉬움.

### 2.2 Word — **★ Phase 1 필수**

**용도**: 교사가 학교 상황에 맞춰 후편집. "우리 반은 어려우니 문제 2개 빼고 그림 추가" 같은 시나리오.

**옵션**: `docx` (npm) — 안정적, Word 표준 준수, 표/헤더/스타일/이미지 삽입 모두 지원. LearningDocument JSON 스키마 → docx 노드 직접 매핑.

**한글 폰트**: docx 는 기본 폰트만 지정, 열람 환경(MS Word/한글) 폰트 사용. 폰트 embed 는 생략(파일 크기 이유).

### 2.3 PPT — **★ Phase 1 필수** (자료유형별 적합도는 매트릭스로 관리)

**용도**: 수업 슬라이드형 자료(수업 도입, 교사 발문, 수업안, 개념 정리 등). 사용자 요청에 따라 문제·활동지 등 다른 자료유형도 pptx 다운로드를 열어둔다.

**옵션**: `pptxgenjs` — Node에서 pptx 생성. 표·차트·이미지·마스터 슬라이드 지원.

**슬라이드 분할 규칙**
- LearningDocument 스키마의 `slide-break` 마커로 명시 분할 (AI가 pptx 요청 시 자동 삽입)
- 마커가 없으면 `heading level 1/2` 기준 자동 분할, 한 슬라이드 세로 초과 방지
- 답안·해설은 마지막 슬라이드에 몰거나 별도 pptx 로 옵션 분리

**한글 폰트**: pptxgenjs 는 폰트 이름만 지정 → 열람 환경 폰트 사용 (Pretendard 없으면 fallback). 프리뷰 PDF 를 함께 제공해 안전망.

### 2.4 포맷 결정 매트릭스 (v0.3 — 사용자 확정)

**원칙 (v0.3)**
- **문제·평가, 학생 활동지 (학생 배포용) → PDF 기본**
- **교사가 후편집하는 수업안·평가 기준표 → Word 기본**
- **수업 도입, 교사 발문, 화면 제시 자료 → PPT 기본**
- **창의·표현 활동은 학생 배포용이면 PDF 기본** (Word 고정 안 함)
- 세 포맷 모두 항상 선택 가능, 부적합한 조합은 UI 안내 문구로만 완화

| 자료유형 | 사용자 성격 | PDF | Word | PPT | 기본 |
|---|---|:-:|:-:|:-:|---|
| OX 퀴즈, 객관식, 단답형, 빈칸 채우기, 서술형 | 학생 배포 | ★ | ○ | △ | **PDF** |
| 형성평가, 단원평가, 혼합 문제집 | 학생 배포 | ★ | ○ | △ | **PDF** |
| 개별 활동지, 모둠 활동지, 토의·토론, 탐구·관찰 | 학생 배포 | ★ | ○ | △ | **PDF** |
| 개념 정리, 읽기 자료, 복습 활동지 | 학생 배포 | ★ | ○ | ○ | **PDF** |
| 창의·표현 활동 | 학생 배포 | ★ | ○ | ○ | **PDF** |
| 수업안, 평가 기준표 (루브릭) | 교사 편집 | ○ | ★ | ○ | **Word** |
| 수행평가 과제, 모범답안·해설 | 교사 편집 | ○ | ★ | ○ | **Word** |
| 수업 도입 질문, 교사 발문 | 화면 제시 | ○ | ○ | ★ | **PPT** |
| 감정 연계 활동 (수업 진행 자료 성격) | 화면 제시 | ○ | ○ | ★ | **PPT** |

- ★ = 기본값 (UI 우선 표시)
- ○ = 정상 지원 (사용자 선택 가능)
- △ = 지원하되 "이 포맷은 문항 배치가 어려울 수 있어요" 안내

**pptx 슬라이드 분할 정책 (v0.3 확정 — D-12 갱신)**
- AI 응답의 `slide-break` 마커는 **보조 힌트**로만 사용
- **최종 슬라이드 분할은 PPT 렌더러가 결정** — 기준:
  1. 슬라이드당 문항 상한 (예: 객관식 3문항, 서술형 1문항)
  2. 텍스트 글자 수 상한 (예: 400자)
  3. 표 행 수 상한 (예: 8행)
  4. 이미지 개수 상한 (예: 2개)
  5. heading level 1은 무조건 새 슬라이드 시작
- Phase 0 에서 위 기준값의 적정성을 sample로 검증
- 렌더러는 순수 함수 (`LearningDocument → PptxSlide[]`), 테스트 가능

**포맷 안내 문구 UI (Phase 1 필수)**
- 자료유형 × 포맷 조합이 △ 인 경우:
  - "이 자료는 슬라이드 1장에 문항이 많이 담기지 않아 PDF 사용을 추천해요."
- pptx 다운로드 시 항상 노출:
  - "한글 폰트가 없는 컴퓨터에서는 다른 폰트로 표시될 수 있어요. 발표 전 미리 열어 확인해주세요."
- docx 다운로드 시:
  - "Word 앱에서 열어 자유롭게 수정하세요."

---

## 3. 기존 clipart-studio 통합 vs 별도 프로젝트

### 3.1 통합 (A안, 강력 추천)

- 위치: `clipart-studio` 리포 안, 새 라우트 `/organization/[slug]/learning`
- **재사용 가능**: 조직 모델, 크레딧 시스템 (`use_tokens`/`refund_tokens`), 인증, R2 스토리지, 사용자 라이브러리 UI, 마케팅 임베드, **기존 클립아트 이미지 삽입** (강력한 시너지)
- **신설 필요**: 새 라우트, AI 프롬프트, 문서 렌더러, 학습지 DB 테이블

### 3.2 별도 프로젝트 (B안)

- 리포 분리, 도메인 예: `learn.schoolp.co.kr`
- **재사용 어려움**: 인증·조직·크레딧을 전부 새로 짜거나 clipart-studio API 를 외부 소비
- **장점 없음**: MVP 단계에서 도메인·인프라 관리 부담만 커짐

**결론**: **A안 통합** 이 유일하게 합리적. B안은 향후 트래픽이 clipart-studio를 압도할 때 재검토.

---

## 4. 기술 스택 결정

| 계층 | 스택 | 근거 |
|---|---|---|
| Framework | Next.js 14 App Router (재사용) | 기존 유지 |
| Runtime | Node.js on Railway (재사용) | Puppeteer 실행 위해 Node 필수 |
| AI 텍스트 | **OpenAI GPT-4o** (1순위) / **Claude Sonnet 4.6** (2순위) | 한국어 초등 어휘 정확도 검증 후 확정 |
| AI 이미지 | 기존 gpt-image-1 파이프라인 (재사용) | 학습지 삽화 필요 시 |
| PDF | **Puppeteer + @sparticuz/chromium** → 실증 실패 시 `@react-pdf/renderer` | 인쇄 품질 최우선 |
| Word | `docx` npm | 표준 |
| PPT | `pptxgenjs` | 유일 실용 옵션 (Phase 1 포함) |
| 저장 | Cloudflare R2 (재사용) | 기존 스토리지 |
| DB | Supabase PostgreSQL (재사용) | 기존 |
| Queue | 기존 SSE job pipeline 확장 | 문서 생성도 async |

---

## 5. 데이터 모델 매핑

### 5.1 신설 테이블 (Migration 078~082 예상)

| 테이블 | 역할 | 예상 규모 |
|---|---|---|
| `subjects` | 국어/수학/사회/… 12개 | 12행 seed |
| `common_topics` | 공통 학습 주제 (지시서 §3) | **약 660행 seed** (6학년 × ~11과목 × ~10주제) |
| `textbook_unit_mappings` | 출판사 교과서 단원 ↔ 공통 주제 다대다 매핑 | Phase 2+ |
| `material_types` | 자료 유형 20종 (지시서 §5.2) | 20행 seed |
| `learning_documents` | 생성된 문서 record | 사용량에 따라 |
| `learning_document_generations` | 생성 이력 (재생성 추적) | 사용량 |

### 5.2 기존 재사용

- `organizations` / `organization_members` — 워크스페이스 스코핑
- `token_pools` / `token_ledger` — 크레딧 소진
- `use_tokens` / `refund_tokens` RPC — 트랜잭션 안전
- `images` — 학습지에 삽입할 클립아트 참조 (학년 필터, 태그 매칭)
- `generation_jobs` — job queue 확장 (`kind: 'learning_doc'` 추가) or 신설 `learning_jobs`

### 5.3 Seed 데이터 부담

**660여 행의 공통 주제 seed** 가 실제로 가장 큰 리스크. 지시서 §3 목록은 상세하지만 실무 검증(현직 교사) 없이 배포하면 오류 리스크. Phase 1에서 **1~2학년 국어/수학만** 우선 seed 하고 사용자 피드백으로 확장.

---

## 6. UI/UX 흐름 (지시서 §5·§7 기반)

### 6.1 진입점

- `/organization/my/learning` 또는 `/organization/[slug]/learning`
- 기존 `/generate` 옆 사이드바 nav에 "학습지 만들기" 항목 추가

### 6.2 입력 순서 (지시서 §5.1)

```
[학년] → [과목] → [자료 유형] → [단원·주제 (텍스트 or AI 추천 3개)]
       → [분량] → [난이도] → [추가 요청] → [AI 생성]
```

### 6.3 AI 주제 추천

- 학년+과목+자료유형 확정 후 "AI 추천받기" 버튼 활성
- 3개 카드: 교육과정 기본형 / 실생활 연결형 / 탐구·확장형
- 지시서 §5.6 규격 그대로

### 6.4 생성·다운로드 흐름

1. 사용자 "생성" 클릭 → 크레딧 예약
2. GPT-4o 호출 → JSON 구조화 응답
3. 서버가 HTML 스키마로 변환 → SSE 로 미리보기 스트림
4. 완료 시 사용자가 포맷 선택 (PDF / Word / PPT)
5. 서버가 해당 렌더러로 파일 생성 → R2 업로드 → 서명 URL 반환
6. 다운로드
7. 실패 시 크레딧 환불 (기존 refund_tokens 재사용)

### 6.5 후편집 (Phase 2)

- 생성 결과의 각 문항을 인라인 편집 (텍스트 수정, 삭제, 순서 변경)
- 편집 후 재다운로드 (AI 재호출 없음)

---

## 7. AI 호출 전략

### 7.1 프롬프트 아키텍처

- **System prompt**: "너는 2022 개정 교육과정 기준 초등 {학년} {과목} 교사다. 어휘·문장 난이도를 학년 수준에 맞춘다."
- **User prompt**: 자료 유형별 템플릿 + 사용자 입력 + JSON 스키마 강제 (structured outputs)
- **Structured output**: OpenAI `response_format: { type: 'json_schema', schema: {...} }` 로 렌더러가 파싱 안정

### 7.2 문항 검증 파이프라인

지시서 §8.1 요구:
- 학년 수준 어휘 검증 (사전/블랙리스트)
- 정답이 하나가 아닌 경우 예상 답안에 명시
- 인물·역사·과학 사실 검증 → Phase 2 (별도 검증 호출)

### 7.3 크레딧 소진 정책 (초안)

| 자료 유형 | 크레딧 |
|---|---|
| OX 퀴즈, 개념 정리, 개별 활동지 | **2** |
| 객관식 10문항, 단답형, 빈칸 채우기 | **3** |
| 서술형, 형성평가, 토의·토론 활동 | **5** |
| 단원평가, 수업안 (40분) | **8** |
| 혼합 문제집 20문항 | **10** |

이미지 삽입(기존 클립아트 재사용) 은 별도 소진 없음. **재생성은 원본 크레딧의 50%**.

---

## 8. Phase 로드맵 (v0.2 — 세 렌더러 동시 지원)

### Phase 0 — Feasibility (v0.3, 사용자 검증 조건 반영, 0.5~1주)

**목표**: **동일한 하나의 LearningDocument sample** 로 세 포맷(pdf/docx/pptx) 을 생성해 아래 항목을 사용자와 함께 확인한다.

**A. 산출물 sample 준비**
- [ ] `src/services/learning-renderer/schema.ts` — LearningDocument TypeScript 타입
- [ ] `src/services/learning-renderer/sample.ts` — 대표 sample 3개 (문제집·수업안·수업 도입 슬라이드 각 1개)
- [ ] `src/services/learning-renderer/pdf.ts` — Puppeteer HTML→PDF
- [ ] `src/services/learning-renderer/docx.ts` — docx 라이브러리 매핑
- [ ] `src/services/learning-renderer/pptx.ts` — pptxgenjs 매핑 + 자동 슬라이드 분할 함수
- [ ] `scripts/learning-render-sample.ts` — 로컬 노드 실행 스크립트 (세 포맷 파일 저장)

**B. 검증 항목 (사용자 요청)**
- [ ] **세 포맷의 내용 일치** — 같은 sample 이 pdf/docx/pptx 로 각각 저장되었을 때 텍스트·순서 동일
- [ ] **한글 폰트와 줄바꿈** — Pretendard 지정, 폰트 없는 환경에서 fallback 확인
- [ ] **표·이미지 배치** — 표 셀 경계 유지, 이미지 크기·중앙 정렬
- [ ] **페이지·슬라이드 자동 분할** — pptx 는 §2.4 슬라이드 분할 정책 기준값 검증
- [ ] **실제 Word·PowerPoint 편집 가능 여부** — MS Word / 한컴오피스 / MS PowerPoint / Keynote 로 열어 편집 시도
- [ ] **Railway 메모리·생성 시간** — Puppeteer 콜드 스타트 시간, 세 렌더러 각각 P50/P95 응답 시간, RSS 메모리 피크

**C. 실증 실행 방식**
- 로컬 sample 실행: `pnpm tsx scripts/learning-render-sample.ts`
  → `./tmp/learning-sample-{pdf,docx,pptx}` 세 파일 저장
- Railway 실증: 사내 관리자만 접근 가능한 `/api/lab/learning-render` 임시 라우트로 서버 사이드 실행. 실측 로그 기록.
- 결과 정리: `docs/03-analysis/learning-helper-phase-0.md` (Phase 0 종료 시 작성)

**Gate**: 사용자 검토 후 Phase 1 착수 승인. Puppeteer 리소스 문제 확인 시 react-pdf fallback 결정.

### Phase 1 — MVP (v0.3, 3~4주)
- [ ] Migration 078~081: subjects, common_topics, material_types, learning_documents
- [ ] Seed (**v0.3 확장**): **1~6학년 국어/수학** common_topics (약 120~140개), material_types **5종** (OX 퀴즈 / 객관식 / 개별 활동지 / 개념 정리 / 읽기 자료)
- [ ] `/organization/[slug]/learning` 페이지 UI
  - 학년 선택: **1학년~6학년 각각** 선택 가능 (학년군 X)
  - 과목: 국어/수학만 (Phase 1)
  - 자료유형: 5종
  - 주제: AI 추천 3개 + 직접 입력
- [ ] `POST /api/learning/recommendations` — AI 주제 3개 추천
- [ ] `POST /api/learning/jobs` — 문서 생성 job 시작 (크레딧 예약)
- [ ] `GET /api/learning/jobs/[id]/stream` — SSE 미리보기 (LearningDocument JSON 스트림)
- [ ] **PDF 렌더러** (`services/learning-renderer/pdf.ts`) + `POST /api/learning/documents/[id]/render?format=pdf`
- [ ] **Word 렌더러** (`services/learning-renderer/docx.ts`) + `?format=docx`
- [ ] **PPT 렌더러** (`services/learning-renderer/pptx.ts`) + `?format=pptx`
- [ ] 자료유형별 기본 포맷 지정 매트릭스 UI 반영 (§2.4)
- [ ] 사용자 라이브러리에 "내가 만든 학습지" 탭 추가 (세 포맷 아이콘 노출)
- [ ] 포맷별 안내 문구 UI (한글 폰트 fallback, 슬라이드 분할 제한 등)
- **완료 조건**: 교사 1인이 1주간 실사용 후 세 포맷 모두 인쇄·편집·발표 활용 확인

### Phase 2 — 확장 (2주)
- [ ] 나머지 학년/과목 seed (~620개 common_topics)
- [ ] 나머지 자료 유형 (15종)
- [ ] 후편집 UI (인라인 문항 수정) → 편집 후 세 포맷 모두 재다운로드
- [ ] 크레딧 정산 확정
- [ ] 어휘 검증 (학년별 사전 매칭)
- [ ] 정답·해설 생성 옵션 (별 파일 or 같은 파일 뒷장)
- [ ] pptx 슬라이드 마스터 (학교 로고·머릿말 옵션)

### Phase 3 — 심화 (선택, 별도 스프린트)
- [ ] 이미지 자동 삽입 (기존 클립아트 라이브러리에서 태그 매칭)
- [ ] 학교 특화 주제 관리 (school_specific)
- [ ] 성취기준 코드 연결
- [ ] 출판사 교과서 단원 매핑 (textbook_unit_mappings)
- [ ] 다중 포맷 일괄 다운로드 (ZIP)

**총 MVP 배포 목표**: **Phase 0+1 = 3~4주** (세 포맷 동시 지원 반영)

---

## 9. Open Decisions (v0.3 확정)

| # | 결정 사항 | 상태 |
|---|---|---|
| D-1 | 통합 vs 별도 프로젝트 | ✅ **A(통합)** — clipart-studio 내부 |
| D-2 | PDF 렌더러 | Phase 0 실증 후 결정 (Puppeteer 우선 시도) |
| D-3 | AI 텍스트 모델 | Phase 0 sample 비교 후 결정 (GPT-4o 우선) |
| D-4 | Phase 1 seed 범위 | ✅ **1~6학년 국어/수학** (학년별 선택), 자료유형 5종 |
| D-5 | 크레딧 정책 | §7.3 초안대로 시작 |
| D-6 | 후편집 UI | ✅ **Phase 2 미룸** |
| D-7 | 학습지 저장 위치 | ✅ **신설 `learning_documents`** |
| D-8 | 인쇄 크기 | ✅ **A4만** |
| D-9 | 로고·머릿말 | ✅ **Phase 1 미포함** |
| D-10 | 지시서 원본 저장 | Phase 0 착수와 함께 저장 (사용자 원본 md 필요) |
| D-11 | 산출물 포맷 | ✅ **PDF+Word+PPT 세 포맷** |
| D-12 | pptx 슬라이드 분할 정책 | ✅ **AI `slide-break` 는 보조**, 최종 분할은 PPT 렌더러가 글자 수·문항 수·레이아웃 기준 결정 |
| D-13 | 자료유형별 기본 포맷 매트릭스 | ✅ **§2.4 v0.3 매트릭스 채택** (학생 배포용은 모두 PDF, 교사 편집은 Word, 화면 제시는 PPT) |

---

## 10. Non-Goals (명시적 제외)

- 중학교/고등학교 대상 확장
- 국문 외 언어 (영어 학습지 자체는 포함, UI 다국어는 제외)
- 학생용 문제 풀이 앱 (교사용 생성만)
- 성적 관리 / 학부모 리포트
- 실시간 협업 편집
- 오프라인 앱 / 데스크톱 앱

---

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Puppeteer Railway 리소스 부족 | 배포 불가 | Phase 0 실증 → react-pdf fallback 준비 |
| OpenAI 초등 어휘 오류 | 교사 신뢰 하락 | 학년별 어휘 검증 파이프라인 (Phase 2) + "AI 초안이니 검토 필요" 명시 |
| 660개 seed 데이터 오류 | 카테고리 잘못됨 | Phase 1은 좁게(1~2학년 국·수) 시작, 실사용 피드백으로 확장 |
| 저작권 (교과서 원문 복제) | 법적 리스크 | 지시서 §8.2 원칙 — 출판사 단원명 표시 금지, 공통 주제만 사용 |
| 인쇄 품질 (프린터별 차이) | 사용자 불만 | A4 CSS 규격 준수 + PDF 미리보기 필수 |
| 크레딧 소진 정책 실패 | 서비스 손실 | Phase 1 초기엔 사용량 로그만 쌓고 정산은 관찰 후 확정 |
| **세 렌더러 산출물 불일치 (같은 문서인데 포맷별 내용 다름)** | 신뢰 하락 | LearningDocument JSON 을 유일한 SoT 로 강제, 렌더러는 순수 변환 함수. QA에서 세 포맷 동시 비교 필수 |
| **pptx 한글 폰트 fallback 이슈 (환경별 다르게 보임)** | 발표 시 깨짐 | Pretendard 지정 + 안내 문구 + PDF 병행 제공. 필요 시 폰트 embed 라이브러리 (`pptxgenjs` limitation 검토) |
| **세 렌더러 동시 생성으로 서버 부담 증가** | 응답 지연 | 사용자가 선택한 포맷만 render (SSE 완료 후 on-demand). 세 포맷 미리 만들지 않음 |

---

## 12. 다음 단계 (승인 후)

1. **D-1 ~ D-10 결정** (특히 D-4 MVP 범위)
2. **지시서 원본을 `docs/00-pm/learning-helper.prd.md` 로 저장**
3. **Phase 0 착수** — Puppeteer 실증 branch + GPT-4o sample 50건 검증
4. Phase 0 결과 리뷰 → Phase 1 착수 승인
