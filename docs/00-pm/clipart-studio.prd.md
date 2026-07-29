# 우리학교 클립아트스튜디오 — PRD v2.0

- **Status**: Live (operations)
- **Author**: sbtmxk20
- **Date**: 2026-07-29
- **Version**: 2.0 (조직 흡수 + 큐레이션·업스케일·취소·브랜드 반영)
- **Supersedes**: v1.1 (2026-07-09, `clipart-studio.prd.md`) + Organization PRD v0.3 (2026-07-16, `organization.prd.md`)

## Changelog

- **v2.0 (2026-07-29)** — 조직 워크스페이스 정착 이후 첫 통합본. Home 큐레이션 배너, 이미지 업스케일, 생성 취소 흐름, 브랜드 (우리학교 클립아트스튜디오 / Pretendard / 반투명 헤더) 반영. v1.1 의 "팀·조직 개념 없음" 명제는 폐기, organization 은 first-class 계층으로 승격.
- **v1.1 (2026-07-09)** — 계정 = 사람. School Profile Optional. 팀·조직 없음.
- **v0.3 organization (2026-07-16)** — visibility enum + is_on_community 분리.

---

## 1. Overview

| 항목 | 내용 |
|-----|------|
| Product Name | 우리학교 클립아트스튜디오 (ClipArt Studio) |
| Category | 학교 컨텍스트에 최적화된 AI 클립아트 생성·자산 관리·공유 SaaS |
| **North Star** | **"찾고, 없으면 만들고, 만들면 계정의 자산이 된다. 조직과 학교끼리 나누고, 공유 라이브러리에서 함께 발전시킨다."** |
| 핵심 차별점 | AI 이미지 생성기가 아닌 **학교 단위 반복 재사용 디자인 자산 축적 서비스**. School Profile · 조직 워크스페이스 · 공유 라이브러리 3계층으로 개인 → 조직 → 공동체 흐름을 자연스럽게 잇는다. 경쟁력은 AI 품질이 아니라 "우리 학교 라이브러리가 계속 쌓이고, 공유되고, 재활용된다"는 점 |
| 브랜드 정체성 | 브랜드명 "우리학교 클립아트스튜디오", 로고 흰/파랑 대비, Pretendard 전역 폰트, 홈 히어로가 관리자 큐레이션 대표 작품 전시관 |

## 2. Problem & Solution

### Problem

1. 학교·교사·학생·학원이 클립아트를 지속적으로 필요로 하는데 원하는 이미지가 없거나 유료·저작권 불명확
2. 같은 학교 선생님끼리 자료 공유 방법이 계정 공유 또는 개별 링크뿐 (P5 조직 필요성)
3. 매번 같은 캐릭터·자산을 재생성해야 함 (i2i 필요성)
4. 생성한 이미지가 세션 소비형으로 사라지고 계정 자산이 되지 않음
5. Community 완전 공개는 심리적 부담이 커 조직 내부 공유 중간 단계 부재
6. 인쇄용 고해상도가 필요할 때 재생성 부담 (업스케일 필요성)

### Solution

`검색 → (없으면) 생성 → 자동 저장 → 조직 공유 → 공유 라이브러리 큐레이션 → 재사용` 원플로우.

- **3계층 저장소**: MY 라이브러리 → 조직(우리학교) 라이브러리 → 공유 라이브러리
- **School Profile (개인 Optional) + Organization (선택 팀)** — 두 축이 병존
- **배치 생성** (1~50장) + **SSE 스트리밍** — 완성되는 대로 즉시 확인 + 명시적 취소
- **이미지 체이닝** (i2i) — 스타일·캐릭터를 세계관으로 확장
- **업스케일** (2x / 4x) — Real-ESRGAN 으로 인쇄 표준까지
- **홈 큐레이션 배너** — 관리자가 공유 라이브러리 대표 작품을 대문 콘텐츠로 승격

## 3. Users & Personas

### 계정 모델

```
계정 = 사람 1명 (Supabase auth.users)
  ├─ profile (필수) — email, credits, account_type
  ├─ school_profile (Optional 1:0..1) — 학교 스타일 자동 주입용
  └─ organization_members (N:N) — 여러 조직에 동시 소속 가능
```

- 계정은 여전히 사람 1명. School Profile 은 개인 프로필 필드로 남음
- Organization 은 **여러 계정을 묶는 컨테이너** (P5 에서 도입, v2.0 정착)
- 계정 하나가 학교·학원·개인 프로젝트 여러 조직에 동시 소속 가능

### account_type (Profile 필드)

`'teacher' | 'student' | 'school' | 'school_staff' | 'general'` — 배지·통계용, 기능 차별화 없음.

### Personas

- **P1 선생님 (teacher)** — 수업 자료·통신문·학급 자료
- **P2 학생 (student)** — 발표·수행평가
- **P3 학교 (school)** — 행정 명의 공식 자산
- **P4 학교 관계자 (school_staff)** — 학부모회·교육청
- **P5 일반 (general)** — 학교 컨텍스트 없는 사용자
- **P6 조직 소유자 (Org Owner)** — 학교 정보부장·학원 원장. 조직 생성/삭제/설정
- **P7 조직 관리자 (Org Admin)** — 멤버 초대·역할·활동 로그
- **P8 조직 편집자 (Org Editor)** — 조직 라이브러리 열람 + 자기 이미지 공유
- **P9 조직 뷰어 (Org Viewer)** — 열람·다운로드만
- **P10 서비스 관리자 (Admin)** — Knowledge CMS, 홈 히어로 큐레이션 (env `ADMIN_EMAIL` 화이트리스트)

## 4. Success Metrics (KPI)

| 지표 | 정의 | 목표 |
|-----|-----|-----|
| **재사용률** | 다운로드 이벤트 ÷ 생성 이벤트 | ≥ 30% |
| **체이닝 재사용률** | parent_image_id NOT NULL ÷ 전체 생성 | ≥ 20% |
| **배치 선택률** | 다운로드/공개된 이미지 ÷ 배치 총 생성 수 | ≥ 30% |
| **4주 재방문율** | 가입 후 4주 내 2회 이상 접속 | ≥ 40% |
| **조직 활성화율** | 조직 생성 후 7일 내 owner 외 1명 이상 확보 | ≥ 70% |
| **초대 수락률** | 발송된 초대 중 7일 내 수락 | ≥ 60% |
| **조직 이미지 공유율** | 소속 멤버의 개인 이미지 중 조직 공유 비율 | ≥ 40% |
| **공유 라이브러리 승격율** | 조직 라이브러리 → 공유 라이브러리 승격 비율 | 15~20% |
| **홈 히어로 CTR** | 히어로 배너 클릭률 (신규 지표) | ≥ 5% |

## 5. Feature Scope

### 5.1 MVP (v1.x 완료)

- 이메일/소셜 로그인 (Supabase Auth)
- 계정 프로필 + School Profile (Optional)
- 이미지 검색 (내 라이브러리 + 공유 라이브러리 + 공식 컬렉션, PostgreSQL FTS + 태그)
- AI 배치 생성 (1~50장, gpt-image-1 주 + FLUX 대체)
- 참조 이미지 첨부 (개인 슬롯 · 조직 슬롯)
- 이미지 체이닝 (i2i)
- 자동 태그·카테고리 (gpt-4o-mini)
- 크레딧 시스템 (신규 50, 월 30 리셋, 계정 유형 무관)
- Cloudflare R2 저장 + 다운로드
- Community (공유 라이브러리) 명시 공개 토글

### 5.2 확장 완료 (v2.0)

- **조직 워크스페이스 (P5)** — 생성·초대·역할·활동 로그·위험 영역·조직 참조 이미지 슬롯·기본 프롬프트
- **3계층 공개 모델** — `visibility` (private / organization / authenticated / public) + `is_on_community` 독립 flag
- **image_organization_shares** — 이미지 N:N 조직 공유 (v1.0 UI 는 1:1)
- **생성 취소 흐름** — 3-phase Dialog (confirm / pending / result). CAS status + finally refund 로 double refund 방지
- **업스케일** — Real-ESRGAN 2x (1 크레딧) / 4x (2 크레딧). 결과가 라이브러리에 새 이미지로 저장
- **홈 큐레이션 배너** — 관리자가 공유 라이브러리 이미지를 대표 작품으로 승격. 클릭 → 이미지 상세, 우측 하단 자동 태그 chip
- **홈 4-Step 카드** — 검색 → AI 생성 → MY 라이브러리 → 스타일 이어 만들기 흐름 가이드
- **태그 캐러셀** — 공유 라이브러리 이미지의 실제 태그를 좌측 화살표로 페이지 순환
- **브랜드** — "우리학교 클립아트스튜디오" 워드마크, 로고 화이트/블루 2종, Pretendard 전역, 홈 반투명 헤더 (스크롤 감지)
- **전역 프로그레스 바** — 다운로드·업스케일·SSE 감지, 브랜드 색 #373d8e
- **Knowledge CMS** — 관리자가 학교 특화 지식 등록, 생성 파이프라인이 프롬프트 매칭 시 자동 주입

### 5.3 Phase 2 (계획)

- 홈 배너 운영 도구 — 노출 순서·기간·배지 (에디터 픽)·추천 문구
- 조직 결제·크레딧 풀 (v3 결제 시)
- 알림 시스템 (인앱)
- 관리자 대시보드 (사용 통계·문제 이미지 리포트)
- 검색 의미 확장 (pgvector)
- 여러 조직 동시 공유 UI (스키마는 이미 준비)

### 5.4 Out of Scope

- 결제/환불/좋아요 (Phase 3+)
- 조직 소유 이미지 (결정 5, 개인 소유만 유지)
- SSO/SAML
- 조직 내 서브그룹
- 이미지 편집기 / 버전 관리 / Fine-tuning UI

## 6. Core User Journeys

### 6.1 검색 우선
```
홈 → 태그 캐러셀 or 검색바 → 결과 카드 → 다운로드 (재사용 KPI +1)
```

### 6.2 없으면 생성
```
검색 실패 → +클립아트 만들기 → 프롬프트 + 배치 크기 + 비율
  → SSE 로 결과 슬롯 채워짐 (첫 이미지 완성 시 토스트)
  → 카드 클릭 → 이미지 상세 → 다운로드
  → (선택) 생성 취소 → 3-phase Dialog
```

### 6.3 스타일 이어 만들기 (킬러)
```
이미지 상세 → "이 이미지로 다시 만들기"
  → /generate?parent=<id> 로 이동, 원 프롬프트 채워짐
  → i2i 배치 → 캐릭터 세계관 확장 (parent_image_id 기록)
```

### 6.4 조직 협업
```
조직 생성 (owner) → 멤버 초대 (이메일)
  → 조직 라이브러리에 자기 이미지 공유 (editor+)
  → 조직 참조 이미지 슬롯 등록 → 조직 컨텍스트 생성 (`/generate?org=<slug>`)
  → admin 이 조직 라이브러리 → 공유 라이브러리 승격
```

### 6.5 홈 큐레이션 (관리자)
```
Admin 이 /admin/knowledge → "공유 라이브러리에서 선택" → 이미지 피커
  → home_hero_images 에 등록 (source_image_id FK)
  → 사용자가 홈 방문 시 랜덤 노출 → 클릭 시 이미지 상세
  → 우측 하단 태그 chip → /search?q=<tag>
```

### 6.6 인쇄용 업스케일
```
이미지 상세 → "고화질 다운로드" → 2x (1 크레딧) or 4x (2 크레딧)
  → Real-ESRGAN 처리 → 결과가 라이브러리에 새 이미지로 저장
  → 자동 다운로드 시작
```

## 7. Information Architecture

### Navigation (상단 헤더)

- **로고** (홈 = 공유 라이브러리 진입점)
- **+클립아트 만들기** (`/generate`)
- **MY** (`/library`)
- **우리학교** (`/organizations`)
- **관리** (`/admin`) — Admin 전용
- **계정 메뉴** (User 아이콘) — 개인 설정 · 로그아웃

### Access Control 요약

| 리소스 | 조회 | 편집 |
|---|---|---|
| MY 라이브러리 | 소유자 + visibility 승격 대상 | 소유자만 |
| 조직 라이브러리 | 조직 active 멤버 + 소유자 | shared_by 본인 (editor+) |
| 공유 라이브러리 | 로그인 회원 전체 (is_on_community=TRUE) | admin+ 승격/취소 |
| Knowledge CMS | Admin 전용 | Admin 전용 |
| 홈 히어로 큐레이션 | 모든 방문자 (SSR) | Admin 전용 |

### Page Hierarchy

```
/                          공유 라이브러리 (홈, 히어로 큐레이션 + 4-Step + 태그 캐러셀 + 그리드)
/generate                  이미지 생성 (좌 폼 / 우 참조·학교 설정 / 하단 배치 진행)
/library                   MY 라이브러리
/image/[id]                이미지 상세 (다운로드·업스케일·다시 만들기·공유·조직 공유)
/organizations             내 조직(우리학교 워크스페이스) 목록
/organization/[slug]       조직 홈 (라이브러리 embed + 관리 배너)
/organization/[slug]/members     멤버·초대 관리
/organization/[slug]/settings    조직 설정 (owner) · 참조 이미지 · 활동 로그 · 위험 영역
/organization/[slug]/library     조직 라이브러리 (홈 embed 와 동일 콘텐츠)
/search                    통합 검색
/profile                   개인계정 설정 (개인 참조 이미지 슬롯 포함)
/admin                     관리자 홈
/admin/knowledge           Knowledge CMS + 홈 배너 배경 관리
```

## 8. Data Model (High-Level)

핵심 테이블만. 상세는 `docs/02-design/features/clipart-studio.design.md`.

- **profiles** — 계정 (email, account_type, credits, credits_reset_at)
- **school_profiles** — 학교 컨텍스트 1:0..1
- **organizations** — 조직 컨테이너 (slug, name, owner_id, base_prompt, max_visibility, deleted_at)
- **organization_members** — N:N (role: owner/admin/editor/viewer, status)
- **organization_invites** — 초대 (email, token, role, expires_at)
- **organization_reference_images** — 조직 참조 이미지 슬롯
- **organization_activity_logs** — 조직 감사 로그
- **images** — 통합 이미지 (visibility enum + is_on_community + parent_image_id + upscaled_from_id + batch_id + generation_mode)
- **image_tags** / **image_categories** — 자동 태그 (FTS 대상)
- **image_organization_shares** — 이미지-조직 N:N
- **generation_jobs** — 배치 잡 (status enum 확장: queued/running/partial/done/failed/**canceled**)
- **download_events** — 재사용 KPI
- **home_hero_images** — 홈 배너 카탈로그 (source_image_id FK → images)
- **knowledge** / **knowledge_images** — 학교 특화 지식 CMS

## 9. Non-Functional Requirements

- **성능**: 배치 SSE 스트리밍 (첫 이미지 5~7초, 10장 총 25~28초). 홈 SSR force-dynamic
- **보안**: 모든 접근 제어 RLS 로 강제. service_role 은 관리자 API·SSR 배너만. 위험 액션은 slug 입력 confirm
- **저장**: R2 (egress 무료). 원본 삭제 방지 — DELETE 라우트에서 큐레이션·업로드 구분 후 R2 파일 안전 처리
- **접근성**: 한국어 콘텐츠. 반응형 (mobile-first hero + 반응형 그리드)
- **폰트**: Pretendard 100~900 weight, jsdelivr CDN, font-display swap. text-sm 이 앱 최소 크기
- **인프라**: Next.js 14 App Router (Vercel + Railway 병행), Supabase (DB · Auth · Storage), Cloudflare R2, Replicate (FLUX fallback + Real-ESRGAN 업스케일), OpenAI (gpt-image-1 · gpt-4o-mini)

## 10. Credit & Business Model

| 액션 | 크레딧 | 정책 |
|---|---|---|
| 신규 가입 | +50 지급 | 즉시 |
| 월 리셋 | +30 | 매월 1일 배치 |
| 이미지 생성 (1장) | -1 (사전 예약) | 배치 요청 시 `reserveCredits(batchSize)` |
| 개별 슬롯 실패 | +1 환불 | SSE chunk_failed 시 자동 |
| 배치 취소 | 미착수 슬롯 자동 환불 | stream finally 담당 (double refund 방지) |
| 업스케일 2x | -1 | 성공 시 라이브러리 저장 + 자동 다운로드 |
| 업스케일 4x | -2 | 인쇄 표준 (4096px). 실패 시 자동 환불 |
| Job insert 실패 | 전체 환불 | POST /api/jobs |

- 계정 유형별 차등 없음
- 조직 크레딧 풀은 Phase 3 (결제와 함께)

## 11. Behavior Rules (Non-Negotiable)

1. **크레딧 계산 금지**: `reserveCredits` / `refundCredits` RPC 만 사용. 수동 UPDATE 금지 (race condition)
2. **AI 키 서버 전용**: `OPENAI_API_KEY` · `REPLICATE_API_TOKEN` 은 `NEXT_PUBLIC_` 금지
3. **AI 라벨 필수**: 이미지 상세에 `<AIGeneratedBadge />` 노출
4. **Community = 명시적 공개만**: `is_on_community=TRUE` 는 별도 승격 액션. RLS 강제
5. **School Profile 은 Optional**: 미보유자에게 "🏫 학교 스타일 적용" 토글 자체 렌더 X
6. **원본 이미지 안전**: 홈 배너 해제는 row 만 삭제. R2 파일은 소스 이미지가 계속 참조 중이므로 절대 삭제 X
7. **취소 흐름**: 이미 시작된 슬롯은 완료까지 진행. Cancel API 는 status 만 변경, refund 는 stream finally 단일 소스
8. **위험 액션**: 조직 삭제 등은 slug 입력 confirm

## 12. Roadmap

| Phase | 목표 | 상태 |
|-------|-----|-----|
| **P1 Foundation** | Auth + Profile + School Profile 온보딩 | ✅ 완료 |
| **P2 Generation Core** | 배치 생성 + 크레딧 + Job Queue + SSE | ✅ 완료 |
| **P3 Library & Search** | 라이브러리 + FTS + 자동 태그 + 공식 컬렉션 | ✅ 완료 |
| **P4 Image Chaining** | i2i + 프리셋 + 계보 | ✅ 완료 |
| **P5 Organization** | 조직 워크스페이스 (D-A ~ D-C) | ✅ 완료 |
| **P6 Polish v2.0** | 업스케일 · 취소 흐름 · 홈 큐레이션 · 브랜드 · 프로그레스 바 | ✅ 완료 |
| **P7 Operations** | 홈 배너 운영 도구 · 알림 · 통계 대시보드 | 🟡 Phase 2 예정 |
| **P8 Monetization** | 조직 크레딧 풀 · 결제 · 시트 기반 | ⚪ 계획 |

## 13. Risks & Mitigation

| # | 리스크 | 완화 |
|---|-------|------|
| R1 | 콜드 스타트 (초기 공유 라이브러리 비어있음) | Knowledge CMS + 관리자 큐레이션 배너 + 파일럿 시드 |
| R2 | AI 비용 폭주 | 크레딧 상한 + 청크 사전 차감/환불 + 활성 Job 1개 제한 |
| R3 | 원본 이미지 유실 (배너 삭제 사고) | DELETE 라우트에서 R2 삭제 금지 + "삭제" 개념 자체 제거 |
| R4 | Reference Image 저작권 | AI 생성 라벨 + 조직 참조 슬롯은 조직 owner 관리 |
| R5 | 취소 중 double refund | Cancel API 는 status 만, refund 는 stream finally 단일 소스 |
| R6 | 검색 품질 | Phase 2 pgvector 확장 예정 |
| R7 | 홈 배너 파일 삭제 실수 | 배너 화면에서 "삭제" 삭제, "해제" 만 존재 |
| R8 | 조직 이탈 시 자산 손실 | 개인 소유 유지, 조직 공유만 자동 취소 |

## 14. Appendix

### 14.1 Design Documents

- `docs/01-plan/features/clipart-studio.plan.md`
- `docs/02-design/features/clipart-studio.design.md` (아키텍처 SSoT)
- `docs/02-design/features/organization.design.md` (조직 상세)

### 14.2 Migration History (주요)

- 033 organizations_expand — 조직 도메인 도입
- 037 images_select_via_org_share — 조직 공유 RLS
- 041 community_source + org_activity_type 확장
- 043 organization_settings_and_references — 조직 참조 이미지
- 044 merge_school_settings_into_organizations
- 046 generation_jobs.org_id — 조직 컨텍스트 스냅샷
- 047 grant service_role profiles — 활동 로그 이메일 조회
- 048 home_hero_images — 홈 배너 카탈로그
- 049 generation_jobs canceled status
- 050 home_hero source_image — 큐레이션 FK

### 14.3 Glossary

- **큐레이션 (Curation)** — 관리자가 공유 라이브러리 이미지를 홈 배너로 승격하는 행위
- **체이닝 (Chaining)** — 이미지 상세에서 그 이미지를 참조로 새 배치 생성 (i2i)
- **승격 (Promotion)** — private → organization → authenticated → is_on_community 순으로 공개 범위 확장
- **강등 (Demotion)** — 반대 방향
- **활성 Job** — status ∈ (queued, running). 사용자당 1개만 허용
- **Slot** — 배치 안의 개별 이미지 순번 (order 0-based)
- **CHUNK_SIZE** — SSE 처리 병렬 단위 (현재 5)

---

**End of PRD v2.0**

*이 문서는 실제 실장된 시스템 상태를 반영합니다. Phase 2 는 실제 운영 피드백에 따라 우선순위를 조정합니다.*
