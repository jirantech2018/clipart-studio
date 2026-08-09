# Organization Token Management Planning Document

> **Summary**: Super Admin → Organization → Member 3계층 토큰 관리 SaaS 인프라. 개인 사용도 "1인 Organization (type=personal)" 으로 통일해 모든 워크스페이스를 Organization 하나의 개념으로 관리한다. Ledger 기반 감사(Source of Truth) · Pool 기반 잔액 캐시 · profiles.credits UI 캐시 3-tier 구조.
>
> **Project**: ClipArt Studio — Organization Token Management
> **Version**: 0.2.8 (Plan — M3-2 완료 확정 + Library 정책 확정 + Deferred UX TODO 섹션 추가)
> **Author**: sbtmxk20
> **Date**: 2026-08-06
> **Status**: Draft — 사용자 승인 대기
> **Related PRD (SoT)**:
> - `PRD_Organization_Token_Management_v1.0.md` (기능 요구)
> - `PRD_Token_Architecture_Addendum_v1.1.md` (아키텍처 원칙)
> - `MY_Organization_Decision_Response.md` (MY Organization UX/데이터 모델 결정)

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 개인 사용자 중심 `profiles.credits` 직접 UPDATE 파이프라인은 감사 불가·조직 단위 배분 불가·다중 pool 확장 불가. 또한 MY 라이브러리와 Organization 이분 UI 는 사용자가 "지금 어디에서 작업 중인가" 를 혼란스럽게 함. SaaS 로 성장하려면 모든 워크스페이스를 Organization 단일 개념으로 통합하고, Ledger + Pool + Cache 3-tier 로 재설계 필요 |
| **WHO** | Super Admin (플랫폼 운영자), Organization Admin (학교/조직 관리자), Member (교사·학생·일반) |
| **RISK** | 크레딧 = 디지털 자산. 마이그레이션 중 잔액 불일치, Pool/Cache drift, Ledger 무결성 붕괴는 즉각 결제·운영 이슈로 이어짐. 개인 이미지·Job·Reference Image 이관 실패 시 사용자 데이터 손실 우려 |
| **SUCCESS** | (1) 모든 크레딧 변동이 Ledger 로 감사 가능, (2) Ledger SUM = Pool.balance invariant 유지, (3) 개인·학교 모두 동일한 Organization 컨텍스트 UX, (4) Super Admin·Org Admin·Member 3계층 지급 흐름 정상, (5) OpenAI 실비용을 조직/유저 단위로 집계 가능 |
| **SCOPE** | Milestone 1 (문서 + DB 기반) → Milestone 2 (MY Organization + 데이터 이관) → Milestone 3 (Credit Service + 호출부 전환 + Write Guard) → Milestone 4 (Organization/Admin UI) |

---

## 1. 구현 목표

**PRD v1.0 §1 원문 그대로 채택.** 축소·재해석 없음.

- Super Admin → Organization → Member 구조의 토큰 관리
- 조직별 토큰 자산 관리
- 멤버별 토큰 지급 및 회수
- 사용량 및 OpenAI 비용 모니터링
- Ledger 기반 감사(Audit) 구조
- 향후 유료 결제, 구독, 교육청 단위 이양까지 확장 가능한 구조

**MY Organization Decision Response §핵심 원칙** 채택.

1. 개인도 하나의 Organization 이다
2. 모든 작업은 Organization 안에서 수행한다
3. 선택한 Organization 이 토큰과 저장 Library 를 결정한다
4. MY Organization 은 초대가 없는 1인 Organization 이다
5. MY 와 일반 Organization 은 같은 데이터 모델을 사용한다
6. 차이는 권한과 노출 메뉴로만 관리한다
7. 기존 개인 데이터는 실제 MY Organization 으로 이관한다
8. `org_id=NULL` 을 영구적인 개인 데이터 표현 방식으로 사용하지 않는다

---

## 2. 구현 범위 — Milestone 기반

**진행 원칙 (사용자 지시)**:
- 커밋 세분화는 개발 안정성 확보 위해 자유롭게 진행
- 사용자 승인 지점은 **아래 4개 마일스톤 종료 시점만**
- 각 마일스톤 종료 시 실서비스 테스트 가이드 · 정상 결과 · Rollback 방법 제공 후 stop
- 기존 기능이 깨진 상태로 마일스톤 완료 처리 금지

### 2.1 Milestone 1 — 문서 및 DB 기반

**포함 (실행 후 사용자 검증)**

- [ ] Plan v0.2.1 배포 (본 문서, 최초 커밋)
- [ ] Migration 056 — `organizations.type` enum (`personal` / `school` / `general`) + reserved slug CHECK + personal 유저당 1개 UNIQUE
- [ ] Migration 057 — `token_pools` (스키마 · Index · RLS · organization_id UNIQUE)
- [ ] Migration 058 — `token_ledger` (스키마 · Append-Only 트리거 · Index · RLS)
- [ ] Migration 059 — `generation_jobs` OpenAI 비용 컬럼 확장
- [ ] Migration 060 — Credit Service RPC 6개 (`allocate` / `use` / `refund` / `adjust` / `transfer` / `get_balance`) — **함수만 배포, 앱 코드는 아직 호출 안 함**
- [ ] Migration 061 — `profiles.credits` Write Guard 함수만 정의 (트리거 부착은 M3 에서)

**Migration `depends_on`** (각 파일 상단 주석에 명시):

- 056 → 001 (`profiles`), 033 (`organizations`, `organization_members`)
- 057 → 033, 056 (organizations.type 이 존재해야 향후 provision 함수가 참조 가능)
- 058 → 057 (token_ledger.pool_id FK), 014 (generation_jobs.id FK)
- 059 → 014 (generation_jobs)
- 060 → 057, 058, 001 (profiles) — RPC 가 pool / ledger / profiles 를 모두 사용
- 061 → 001 (profiles)

**포함하지 않음**

- 기존 크레딧 파이프라인 (`reserve_credits` / `refund_credits`) 유지 — 여전히 앱이 사용
- `profiles.credits` 직접 UPDATE 차단 트리거 미부착
- MY Organization 생성 없음
- 앱 코드 변경 없음

**M1 완료 조건**

- 모든 Migration dev + prod 배포 성공
- `pnpm tsc --noEmit` + `pnpm build` 통과 (앱 코드 변경 없으므로 사실상 무영향)
- `token_pools` / `token_ledger` INSERT 시도가 authenticated role 에서는 RLS deny, service_role 에서는 허용 확인
- **기존 로그인 · 크레딧 표시 · 이미지 생성 · 실패 환불 이 그대로 동작**
- 사용자 테스트 가이드 제공 (§10.1)

### 2.2 Milestone 2 — MY Organization 및 기존 데이터 이관 + 진입 구조 전환

**M2 의 성격**: 단순한 데이터 이관이 아니라 **기존 개인 진입 구조 → Organization 중심 구조 전환** 까지 포함한다 (사용자 지시).

**포함**

*DB · 이관*
- [ ] Migration 062 — `provision_my_organization(user_id)` RPC (idempotent)
- [ ] Migration 063 — `handle_new_user()` v2 트리거 갱신 (신규 유저 signup 시 profile + MY org + Owner membership + Pool + 초기 Ledger 를 한 트랜잭션으로 생성)
- [ ] Migration 064 — 전 유저 backfill 스크립트 (기존 유저마다 `provision_my_organization` 호출)
- [ ] Migration 065 — 기존 개인 데이터 이관 스크립트 (images / generation_jobs / reference_images 등 `owner_id` 기반 개인 데이터의 `organization_id` 를 유저의 MY org id 로 UPDATE). 대상은 개인 소유이면서 `org_id=NULL` 인 row 만; 조직 컨텍스트로 이미 생성된 row 는 유지.

*Redirect · Middleware*
- [ ] `next.config.js` redirects: `/library` → `/organization/my/library`, `/generate` → `/organization/my/generate`, `/generate-v2` → `/organization/my/generate` (기존 링크/북마크 호환용, 302)
- [ ] `/organization/my/*` middleware alias — 세션 유저 → 유저의 MY organization 조회 → route handler 에 `organization_id` 컨텍스트 주입
- [ ] 앱 내부 링크는 **기존 URL 을 사용하지 않고** 새 경로 사용:
  - MY: `/organization/my/{library,generate,history,reference-images,settings}`
  - 일반 조직: `/organization/{slug}/{library,generate,history,reference-images,members,settings}`
  - 특히 일반 Organization 내부의 `+클립아트 만들기` 버튼은 `/generate-v2` 가 아니라 반드시 `/organization/{slug}/generate` 로 이동

*라우트 재구성*
- [ ] `/organization/[slug]/library` 신규 (기존 `/library` UI 컴포넌트 재사용, organization_id 컨텍스트 주입)
- [ ] `/organization/[slug]/generate` 신규 (기존 `/generate-v2` UI 컴포넌트 재사용)
- [ ] 기존 `/library`, `/generate`, `/generate-v2` 페이지 파일은 삭제 (redirect 가 대체). 컴포넌트 (LibraryClient, GenerateV2Client 등) 는 shared 로 유지.

*상단 네비 · Organization 리스트*
- [ ] `AppHeader.NAV_ITEMS` 조정 — `+클립아트 만들기` · `MY` 제거, `우리학교` (`/organizations`) 만 유지 (관리자 `관리` 는 그대로)
- [ ] `/organizations` 페이지에 MY 카드 (`내 작업실`) 표시. 3-그룹 구성 (최근 사용 · 내 작업실 · 참여 중 조직) 은 M4 에서 완성, M2 는 최소한 MY 카드 + 기존 조직 카드 병렬 표시

*Organization 내부 메뉴 · MY 조직 UI 제한*
- [ ] 각 Organization 상세 페이지에 다음 메뉴 노출: `+클립아트 만들기`, `라이브러리`, `생성 이력`, `참조 이미지`, `토큰`, `설정`
- [ ] 일반 Organization 만 추가로 `멤버`, `초대` 메뉴 노출
- [ ] MY Organization 에는 `멤버`, `초대`, `조직 탈퇴/해체` 메뉴 노출 금지
- [ ] MY Organization 대상 members / invites / role change / dissolve API 호출 시 403 반환

**포함하지 않음**

- Credit Service 앱 코드 전환 (M3)
- `profiles.credits` Write Guard 활성화 (M3)
- Organization Token 설정 UI 상세 (M4 에서 Summary · Members · Allocate · History 완성)
- Admin Dashboard (M4)
- 3-그룹 랜딩 (최근 사용 등) 세부 UX (M4)

**M2 완료 조건** (사용자 지시 §M2 완료 기준 7가지 그대로 채택)

1. 상단 메뉴에는 `우리학교` 만 표시 (`+클립아트 만들기` · `MY` 사라짐)
2. `/organizations` 에 `내 작업실` 카드 표시
3. 내 작업실 카드에서 `+클립아트 만들기` 와 라이브러리 진입 가능 (각각 `/organization/my/generate`, `/organization/my/library`)
4. 일반 조직 카드에서도 해당 조직의 생성 · 라이브러리 진입 가능 (각각 `/organization/{slug}/generate`, `/organization/{slug}/library`)
5. `/library`, `/generate`, `/generate-v2` 기존 URL 은 정상 Redirect
6. MY Organization 에는 멤버 · 초대 메뉴가 보이지 않음
7. 일반 Organization 에는 멤버 관리 메뉴가 유지됨

**추가 완료 조건** (기존 v0.2.1 에서 유지)

- `SELECT COUNT(*) FROM organizations WHERE type='personal'` = `SELECT COUNT(*) FROM auth.users`
- `SELECT COUNT(*) FROM token_pools` = `SELECT COUNT(*) FROM organizations`
- `provision_my_organization` 재실행 (idempotent) → 중복 MY Organization 생성되지 않음
- **기존 개인 이미지 수 · Reference Image 수 · 생성 이력 유지** (`organization_id` 로 재라벨되어 있으나 사용자 조회 결과는 동일)
- 사용자 테스트 가이드 제공 (§10.2)

### 2.3 Milestone 3 — Workspace 독립성 완성 (사용자 UX 관점 4개 단위)

**목표 (사용자 지시)**: Workspace (내 작업실 및 일반 Organization) 가 서로 완전히 독립적으로 동작한다. 각 Workspace 는 **자기만의 Job · Credit · Conversation · Library · Generate** 를 갖는다.

**진행 원칙** (사용자 지시 v0.2.6-v0.2.7):
- **기술 범위 감축 없음.** v0.2.4/v0.2.5 의 모든 항목 그대로 진행.
- **사용자 검증 단위** 는 4개. 사용자가 실제로 화면에서 기능을 사용하고 피드백할 수 있는 관점으로 분할:
  - **M3-1 Workspace 생성** — 사용자 관점: "각 조직에서 생성이 되는가"
  - **M3-2 Workspace 데이터** — 사용자 관점: "각 조직 데이터가 섞이지 않는가"
  - **M3-3 Workspace Credit** — 사용자 관점: "각 조직 크레딧이 따로 소진되는가"
  - **M3-C 운영** — 전체 회귀 · Rollback · Reconciliation
- 각 단위 종료 시 `pnpm tsc --noEmit` + `pnpm build` + 자동 검증 + 사용자 테스트 URL/정상 결과 제공 후 stop.
- 내부 커밋은 자유롭게 세분화. 함수/Migration 하나 단위로 승인받지 않음.

**완료 보고 형식** (사용자 지시 v0.2.7):

각 하위 마일스톤 종료 시 다음 5개 섹션으로 보고. 순서 준수 필수.

1. **이번에 사용자가 사용할 수 있게 된 기능** — 실제로 달라진 사용자 경험을 가장 먼저. 이 항목만 읽어도 이해 가능.
2. **사용자 테스트 (약 5분)** — 화면에서 실행 가능한 시나리오. SQL 보다 우선.
3. **개발 검증 (SQL)** — 사용자 테스트 이후 데이터 검증용.
4. **현재 제한사항** — 아직 구현되지 않은 기능을 명확히.
5. **다음 단계** — 다음 마일스톤 예고.

**M3 최종 완료 기준 (모든 하위 마일스톤 종료 후 성립해야 함)**

| # | 기준 | 검증 방법 |
|---|-----|---------|
| ① | **Workspace 별 Job 저장** | 신규 job 의 `org_id` NULL 0 |
| ② | **Workspace 별 Conversation** | 조직 페이지 sidebar 는 그 조직 대화만 표시 |
| ③ | **Workspace 별 Credit 표시** | 조직 홈 · Generate sidebar 에 그 pool.balance |
| ④ | **Workspace 별 Token 차감** | Ledger USE row 의 pool_id = 현재 workspace pool |
| ⑤ | **Workspace 별 Library** | 이미지 조회에 organization_id 필터 |
| ⑥ | **Workspace 별 Generate** | 요청에 organizationId 포함, 서버 membership 검증 |

**추가 완료 조건 (전 M3 공통)**
- `pnpm tsc --noEmit` PASS, `pnpm build` PASS
- Package Job / Upscale 회귀 정상
- `profiles.credits` 직접 UPDATE 시도 → 트리거 예외 (M3-3 이후)
- Reconciliation 배치: drift 0

---

#### 2.3.1 M3-1 — Workspace 생성 (Generate 흐름)

**사용자 관점**: "각 조직에서 클립아트 생성이 정상적으로 되는가?" — 사용자가 생성 흐름만 테스트한다. 데이터 표시 (Library, Sidebar) · 크레딧 표시는 다음 단계.

**포함**
- [ ] Organization 선택 (`/organizations` 카드 → 조직 홈 → `+ 클립아트 만들기` CTA) 는 M2 에서 이미 완료
- [ ] `POST /api/jobs` 요청 body 로 `organizationId` (또는 orgSlug) 필수 수신
- [ ] Server: 요청자가 해당 조직 active member 가 아니면 403 (비멤버 조직 접근 거부)
- [ ] `GenerateV2Client` 가 페이지 props 로 orgSlug/orgId 를 받아 job submit 시 포함
- [ ] `/organization/[slug]/generate` · `/organization/my/generate` 서버 컴포넌트가 orgSlug/orgId 를 client 로 전달
- [ ] Job 저장 시 `org_id = 전달받은 organization id` (Migration 046 컬럼 활용)
- [ ] 신규 이미지 저장 시 `images.organization_id = job.org_id` (Migration 065 컬럼 활용)

**포함하지 않음**
- Library 필터 (M3-2)
- Conversation 격리 (M3-2)
- Credit Service (M3-3)
- 크레딧 표시 UI (M3-3)

**M3-1 완료 조건**
- `pnpm tsc --noEmit` PASS, `pnpm build` PASS
- 회귀: 기존 크레딧 파이프라인 정상 (legacy `reserveCredits` 그대로)

**사용자 테스트 지점 (생성 흐름만)**
1. `/organizations` → 내 작업실 카드 → `+ 클립아트 만들기` → 이미지 1장 생성 → 성공
2. `/organizations` → 학교 조직 카드 → `+ 클립아트 만들기` → 이미지 1장 생성 → 성공
3. SQL 검증: 두 job 의 `org_id` 가 각각 MY / 학교 organization id 로 저장 · 두 image 도 동일한 organization_id
4. 비멤버 조직 slug 로 API 직접 호출 (curl) → 403

---

#### 2.3.2 M3-2 — Workspace 데이터 (Library · Conversation · Sidebar · Persist Migration) — ✅ 완료 (커밋 eb4bdcd + 6f5117f)

**사용자 관점**: "각 조직 데이터가 섞이지 않는가?" — 사용자가 Library 와 Conversation Sidebar 격리만 테스트한다. 크레딧은 다음 단계.

**포함 (완료)**

*Library 조직 필터*
- [x] `LibraryGrid` 를 organization_id 컨텍스트로 필터
- [x] `/api/images` 목록 API 가 `organization_id` 필터 지원
- [x] (사용자 확정 C 방향) 조직 라이브러리 3-tab (전체 / 이 조직에서 만든 이미지 / 공유받은 이미지) 복원 — 기존 `image_organization_shares` 인프라 재사용, 신규 스키마 0건

*Conversation 격리 · Persist migration*
- [x] `conversationStore` 의 `Conversation` 타입에 `organizationSlug: string` 필드 추가
- [x] Persist migration v2 + rehydrate 시점 fallback backfill
- [x] `createConversation` 이 현재 페이지의 organizationSlug 를 seed
- [x] `ConversationSidebar` 가 현재 organization 의 대화만 리스트

**포함하지 않음**
- Credit Service (M3-3)
- 크레딧 표시 (M3-3)
- Reconciliation / Member API (M3-C)

**M3-2 완료 조건 — 통과**
- `pnpm tsc --noEmit` PASS, `pnpm build` PASS
- 기존 저장된 대화가 rehydrate 후 사라지지 않음 (MY 조직으로 이관됨)

**사용자 확정 정책 (v0.2.8 명문화)**
- `images.organization_id` = 이미지가 생성된 Workspace (소유·과금 근거, 공유해도 불변)
- `image_organization_shares` = 명시적 조직 공유 (소유권 이전 X, 이미지 복제 X)
- 비공유 이미지는 워크스페이스 간 노출 금지
- 명시적으로 공유된 이미지만 대상 Organization 에서 조회
- MY workspace 는 3-tab 미노출 (외부 → MY 공유 케이스 없음)

---

#### 2.3.3 M3-3 — Workspace Credit (Credit Service · Pool · Ledger · Allocate · Refund · Write Guard)

**사용자 관점**: "각 조직 크레딧이 따로 소진되는가?" — 사용자가 크레딧 흐름만 테스트한다. 조직별 크레딧이 표시되고 각각 소진·환불된다.

**포함**

*Credit Service · 호출부 전환*
- [ ] `src/services/credit/` 재작성 (신규 6개 함수 + `organization-pool-resolver.ts` + `errors.ts` + `types.ts`)
- [ ] `POST /api/jobs`, `GET /jobs/[id]/stream`, `package-pipeline`, `upscale` 을 신규 `use()` / `refund()` 로 전환. 대상 pool 은 `resolveOrganizationPool(job.org_id)` 결과
- [ ] 기존 `reserveCredits` / `refundCredits` 는 신규 서비스로 위임하는 deprecated wrapper 로 유지 (M3-C 관찰 후 제거)
- [ ] Idempotency: `refund()` 는 `pool + job (+ slot_id metadata)` 중복 방지
- [ ] 잔액 부족 처리: `INSUFFICIENT_BALANCE` 에러 → 클라이언트에 명확한 안내

*Write Guard 활성 (호출부 전환 완료 검증 후)*
- [ ] Migration 066 — `profiles.credits` Write Guard 트리거 부착 (M1 에서 함수만 정의됨)

*Admin Allocate API (B-2)*
- [ ] `POST /api/admin/organizations/[id]/allocate` — Super Admin 조직 pool 지급. **API 만, UI 는 M4**

*크레딧 표시 UI (현재 Workspace 기준)*
- [ ] Organization 홈 헤더에 "이 워크스페이스 크레딧: N" 표시 (`useOrganization` 응답 확장 또는 별도 tokens API)
- [ ] `GenerateV2Client` sidebar credit badge 가 현재 컨텍스트 pool.balance 기준

**포함하지 않음**
- Member 본인 조회 API (M3-C)
- Reconciliation cron 등록 (M3-C)

**M3-3 완료 조건**
- `pnpm tsc --noEmit` PASS, `pnpm build` PASS
- 신규 코드에 legacy `reserveCredits/refundCredits` 직접 호출 없음 (deprecated wrapper 만 유지)

**사용자 테스트 지점 (크레딧만)**
1. **잔액 표시** — MY 홈 · 학교 홈 헤더에 각각 다른 pool.balance 표시. Generate sidebar 도 현재 조직 기준
2. **MY 생성 → MY pool 만 차감** — MY 에서 1장 생성 → MY pool -1, 학교 pool 무변화. Ledger USE row 의 pool_id = MY pool
3. **학교 생성 → 학교 pool 만 차감** — `curl POST /api/admin/organizations/{학교id}/allocate` 로 학교 pool 에 50 지급 → 학교 조직에서 1장 생성 → 학교 pool -1, MY pool 무변화
4. **실패·취소 시 원래 pool 환불** — 생성 실패 유도 → Ledger REFUND row + 해당 pool 원복. 같은 job 에 refund 두 번 시 `already_refunded=true`
5. **잔액 부족 시 생성 차단** — 학교 pool=0 에서 학교 조직 생성 시도 → `INSUFFICIENT_BALANCE` 에러
6. **다른 Workspace 무영향** — invariant: MY pool.balance = MY ledger_sum, 학교 pool.balance = 학교 ledger_sum. `UPDATE profiles SET credits=... WHERE ...` 직접 시도 → Write Guard 예외

---

#### 2.3.4 M3-C — 운영 (History · Statistics · Reconciliation · Admin · Rollback)

**사용자 관점**: 전체 회귀. 조회 API 정상 · 배치 검증 정기 · Legacy 잔존 없음 · Rollback 준비. M3 6가지 최종 기준 통과.

**포함**

*History · Statistics API*
- [ ] `/api/me/tokens` — 본인의 MY pool 요약
- [ ] `/api/me/tokens/history` — 본인 ledger 이력
- [ ] 조직별 · 유저별 기본 사용 통계 (M4 Dashboard 는 별도 · 여기는 최소 API 만)

*Reconciliation*
- [ ] Reconciliation view (SQL) — pool.balance vs ledger_sum drift
- [ ] Supabase pg_cron 등록 — 매일 실행 · drift 시 alert

*Admin · Legacy 정리 · Rollback*
- [ ] Admin: `POST /api/admin/organizations/[id]/allocate` (M3-3 배포됨) API 동작 재확인 · curl 테스트 스크립트 문서화
- [ ] Legacy `reserveCredits/refundCredits` 잔존 호출 grep → 0 (deprecated wrapper 만 유지)
- [ ] Rollback: dev 환경에서 Migration 066 (Write Guard) DROP → 배포 전 상태 복구 가능 확인
- [ ] 신규 job `org_id NULL` 검사 → 0
- [ ] Package Job 부분 실패 환불 · Upscale 회귀 · 동시성 · 중복 요청 검증

**M3-C 완료 조건**
- `pnpm tsc --noEmit` PASS, `pnpm build` PASS

**사용자 테스트 지점 (전체 회귀)**
1. `/api/me/tokens` · `/history` 응답 정상
2. Reconciliation cron 실행 (다음날 로그) — drift 0
3. Package Job / Upscale 회귀 정상
4. M3 최종 6가지 완료 기준 (① Job 저장 · ② Conversation · ③ Credit 표시 · ④ Token 차감 · ⑤ Library · ⑥ Generate) 모두 통과
5. Rollback 문서 확인

### 2.4 Milestone 4 — Organization · Admin UI

**포함**

- [ ] `/organizations` 페이지 완성 (최근 사용 공간 · 내 워크스페이스 · 참여 중 조직 3-그룹 표시)
- [ ] `/organization/{slug}/library` — M2 에서 최소 진입 완료. M4 는 부가 UI 정리 (필터 · 정렬 등)
- [ ] `/organization/{slug}/generate` — M2 에서 최소 진입 완료. M4 는 부가 UI 정리
- [ ] `/organization/{slug}/history` (생성 이력)
- [ ] `/organization/{slug}/reference-images`
- [ ] `/organization/{slug}/settings/token` (Org Admin only — Summary · Pool · Members · Allocate · History · Usage)
- [ ] `POST /api/organizations/{slug}/members/{userId}/allocate` (Org Admin → Member 지급)
- [ ] `GET /api/organizations/{slug}/tokens` · `/history` · `/members/tokens`
- [ ] `/admin/token-dashboard` (전체 조직 · 사용자 · 총 지급 · 총 사용 · OpenAI 비용) — Admin allocate API 는 M3 에서 배포됨
- [ ] `/admin/organizations` (Super Admin → Org 지급 CTA — M3 배포된 API 사용)
- [ ] `/admin/usage` (월별 · 조직별 · 유저별 통계)
- [ ] `/admin/billing` (OpenAI 실비용 집계)
- [ ] `POST /api/admin/migrate/tokens` (M2 backfill 재실행 트리거 · idempotent)
- [ ] `GET /api/admin/token-dashboard`
- [ ] Reconciliation cron 등록 (Supabase pg_cron)
- [ ] MY 조직에 대해 members / invite / role change / dissolve API 호출 → 403 반환 (M2 에서 이미 반영)

**M4 완료 조건**

- 모든 UI 라우트 정상 렌더
- Super Admin · Org Admin · Member 3계층 지급/사용/조회 흐름 정상
- OpenAI 비용이 조직별로 집계됨
- Reconciliation 배치 정기 실행 + drift 알림 파이프라인 확인
- 사용자 테스트 가이드 제공 (§10.4)

### 2.5 Out of Scope (본 계획 기준)

- 유료 결제 · 구독 · Stripe 연동 (v1.0 §16, v1.1 향후 확장)
- 다중 관리자 RBAC (Addendum §Super Admin — 향후 Phase)
- 교육청 · 기업 · 라이선스 · 쿠폰 · 프로모션 (v1.0 §16)
- CSV export · 자동 월간 리포트 (v1.0 §15 Phase 5, 별도 마일스톤)

---

## 3. 현재 코드베이스 분석

### 3.1 크레딧 파이프라인 (현행)

| 계층 | 위치 | 역할 | 대체 방향 |
|-----|------|------|----------|
| DB 컬럼 | `profiles.credits INT` (Migration 001) | 유저별 잔액 저장 | **UI Cache 로 격하** — M3 에서 직접 UPDATE 차단 트리거 활성 |
| RPC | `reserve_credits`, `refund_credits`, `monthly_credit_reset` (Migration 008, 022) | 원자적 차감/환불 | **M3 에서 deprecated wrapper 로 위임** → 관찰 기간 후 별도 Migration 으로 제거 |
| TS layer | `src/services/credit/index.ts` — `reserveCredits`, `refundCredits`, `InsufficientCreditsError` | 앱 코드 진입점 | **M3 에서 재작성** — 6개 함수 (allocate/use/refund/adjust/transfer/getBalance) |
| 초기 지급 | `handle_new_user()` 트리거 (Migration 001) — 기본 50 크레딧 | 신규 유저 signup | **M2 에서 v2 로 갱신** — MY Organization + Owner Membership + Pool + 초기 Ledger 함께 생성 |
| Cron | `monthly_credit_reset` (Migration 022) | 매월 크레딧 초기화 | **D-6 확정** — M3 이후 신규 구조 대상 재발행 (`ISSUE` + `memo='monthly reset'`) |

### 3.2 Organization (현행)

| 항목 | 위치 | 상태 |
|-----|------|------|
| `organizations` 테이블 | Migration 033 | 존재 (slug · name · owner_id · max_visibility · deleted_at) |
| `organization_members` | Migration 033 | 존재 (role: `owner` / `admin` / `editor` / `viewer`, status: `active` / `suspended`) |
| Organization Token Pool | — | **없음** — M1 에서 `token_pools` 신설 |
| `organizations.type` (personal/school/general) | — | **없음** — M1 에서 컬럼 추가 |
| 예약 slug (`my`, `me`, `admin`, `api`, `organizations`) | — | **없음** — M1 에서 CHECK 추가 |
| 조직 컨텍스트 Job | `generation_jobs.org_id` (Migration 046) | 존재 — M2 이후 개인 데이터도 이 컬럼으로 통일 |
| 조직 페이지 라우트 | `/organization/[slug]/{library,members,settings}` | 부분 존재 — M4 에서 확장 |
| 조직 활동 로그 | `organization_activity_logs` (Migration 043 계열) | 존재 — 크레딧 지급 이벤트도 이 로그에 함께 기록 |

### 3.3 Admin (현행)

| 항목 | 위치 | 상태 |
|-----|------|------|
| Admin 라우트 | `/admin` → `/admin/knowledge` 리다이렉트 | 존재 — Knowledge CMS · Prompts · Home Hero Images 만 있음 |
| Super Admin 판별 | `src/lib/admin.ts` — `isAdmin(email)` | 존재 — `ADMIN_EMAIL` env 단일 email 화이트리스트, 그대로 유지 |
| Admin Dashboard (토큰/조직/비용) | — | **없음** — M4 신규 |

### 3.4 Job / OpenAI 비용 추적 (현행)

| 항목 | 위치 | 상태 |
|-----|------|------|
| `generation_jobs` | Migration 014 | 존재 — `batch_size` · `reserved_credits` · `refunded_credits` · `status` · `org_id` |
| Slot 단위 (Package) | `generation_job_slots` (Migration 053) | 존재 — `final_prompt` · `category_order` · slot 별 상태 |
| Slot 실패 환불 | `services/image-gen/package-pipeline.markSlotFailedAndRefund` | 존재 — M3 에서 신규 `refund()` 로 전환 |
| OpenAI usage / cost 컬럼 | — | **없음** — M1 에서 컬럼 추가 (실 저장은 M3) |

### 3.5 Migration 번호

- 최신: `055_generation_job_slots_final_prompt_category_order.sql`
- 본 Plan 신규 마이그레이션 (파일명 · depends_on):
  - M1:
    - `056_organizations_type_and_reserved_slugs.sql` — depends_on: 001, 033
    - `057_token_pools.sql` — depends_on: 033, 056
    - `058_token_ledger.sql` — depends_on: 014, 057
    - `059_generation_jobs_openai_cost.sql` — depends_on: 014
    - `060_credit_service_rpcs.sql` — depends_on: 001, 057, 058
    - `061_profiles_credits_write_guard_function.sql` — depends_on: 001
  - M2:
    - `062_provision_my_organization.sql` — depends_on: 001, 056, 057, 058, 060
    - `063_handle_new_user_v2.sql` — depends_on: 062
    - `064_backfill_my_organizations.sql` — depends_on: 062
    - `065_migrate_personal_data_to_my_org.sql` — depends_on: 064
  - M3:
    - `066_profiles_credits_write_guard_trigger.sql` — depends_on: 061 (앱 코드 전환 완료 후 부착)
  - M4: 별도 Migration 없음 (대부분 앱 코드)

---

## 4. 재사용 가능한 구성요소

**그대로 재사용 (변경 없음)**

- `organizations` / `organization_members` 스키마 및 role 체계 (owner/admin/editor/viewer) → Organization Admin 판별에 직접 사용
- `organization_activity_logs` → 크레딧 지급/조정 이벤트도 이 로그에 append (별도 log 테이블 신설 불필요)
- `/organization/[slug]/*` 라우트 트리 → `token` 탭 추가 + hidden 메뉴 처리
- `/admin/*` 라우트 트리 → `token-dashboard`, `organizations`, `usage`, `billing` 하위 추가
- `services/supabase/server.ts` — `createSupabaseServiceClient()` (service_role 접근점)
- `apiError` / `apiOk` (`src/lib/api-error.ts`) — 에러 응답 규격. `INSUFFICIENT_POOL_BALANCE`, `POOL_NOT_FOUND`, `FORBIDDEN_ALLOCATION` 등 신규 코드 추가
- SSE / Job 파이프라인 (route → pipeline → adapter) — 크레딧 호출 지점만 신규 `use()` / `refund()` 로 교체
- `isAdmin(email)` 함수 — Super Admin 판별 (Addendum §Super Admin 에 따라 그대로 유지)

**부분 재사용 (수정)**

- `services/credit/index.ts` — 6개 함수로 재작성 (M3)
- `profiles.credits` 컬럼 — 컬럼 유지, 직접 UPDATE 만 M3 에서 차단
- `handle_new_user()` 트리거 — MY Organization + Pool 생성 로직 추가 (M2)
- 기존 Job 파이프라인 — 크레딧 호출 지점을 신규 서비스로 교체 (M3)

---

## 5. 신규 구현 항목

- **DB**: `token_pools`, `token_ledger`, `generation_jobs` 확장, `organizations.type` + reserved slug, `profiles.credits` write guard
- **RPC**: `allocate` / `use` / `refund` / `adjust` / `transfer` / `get_balance` / `provision_my_organization` / (Reconciliation view)
- **Credit Service (TS)**: `services/credit` 재작성 — 6개 함수 + 도메인 에러
- **Organization Pool Resolver**: `organization_id → 단일 Token Pool` 조회. 개인/조직 분기 정책이 없으므로 "라우팅" 이라기보다는 단순 조회. 파일명은 `organization-pool-resolver.ts` (기존 `pool-router.ts` 대안 명칭 폐기)
- **Migration**: legacy `profiles.credits` → MY Pool 이관 · 개인 데이터 → MY org 이관
- **Middleware**: `/organization/my/*` alias resolver
- **Reconciliation**: `token_reconciliation` view + daily cron
- **UI**: `/organizations`, `/organization/{slug}/*` 확장, `/admin/token-dashboard`, `/admin/organizations`, `/admin/usage`, `/admin/billing`
- **API**: 아래 §9 참조

---

## 6. DB 변경사항

### 6.1 Migration 056 — `organizations.type` + reserved slug + personal unique

```sql
-- Depends on: 001 (profiles), 033 (organizations, organization_members)
--
-- 개인 워크스페이스도 organization row 로 존재. type 으로 구분.
-- personal 은 유저당 정확히 1개 (UNIQUE partial index 로 강제).
-- 사용자 URL /organization/my 는 middleware alias 이며,
-- 실제 DB slug 는 hidden (예: personal-{user_id}).
-- 예약 slug (`my`, `me`, `admin`, `api`, `organizations`, `organization`) 은
-- 일반 조직 slug 로 사용 금지.

CREATE TYPE organization_type_enum AS ENUM (
  'personal',
  'school',
  'general'
);

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS type organization_type_enum NOT NULL DEFAULT 'general';

-- 예약 slug CHECK. 기존 조직은 이 slug 를 사용하지 않는 것으로 확인됨.
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_slug_not_reserved
  CHECK (
    slug NOT IN ('my', 'me', 'admin', 'api', 'organizations', 'organization')
  );

-- 유저당 personal Organization 은 정확히 1개.
-- D-open-2 사용자 지시 확정: DB Unique Constraint 로 보장.
CREATE UNIQUE INDEX idx_organizations_personal_owner
  ON public.organizations(owner_id)
  WHERE type = 'personal' AND deleted_at IS NULL;
```

### 6.2 Migration 057 — `token_pools`

```sql
-- Depends on: 033 (organizations), 056 (organizations.type)
--
-- 모든 Pool 은 organization 소속. Personal Pool 개념은 폐기됨
-- (개인 워크스페이스도 organizations.type='personal' 인 row).
-- organization_id UNIQUE 로 조직당 정확히 1개의 Pool.

CREATE TABLE public.token_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  balance INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (balance >= 0)
);

CREATE INDEX idx_token_pools_organization ON public.token_pools(organization_id);

ALTER TABLE public.token_pools ENABLE ROW LEVEL SECURITY;

CREATE POLICY token_pools_select_member ON public.token_pools
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = token_pools.organization_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.token_pools FROM authenticated, anon;
GRANT SELECT ON public.token_pools TO authenticated;
GRANT ALL ON public.token_pools TO service_role;
```

### 6.3 Migration 058 — `token_ledger` (Append Only)

```sql
-- Depends on: 014 (generation_jobs), 057 (token_pools)

CREATE TYPE token_ledger_type_enum AS ENUM (
  'ISSUE',      -- Super Admin 신규 발행 (from=NULL)
  'TRANSFER',   -- Pool 간 이동 (from/to 두 row, 같은 transaction_id)
  'USE',        -- 이미지 생성 소진
  'REFUND',     -- 실패/취소 환불
  'ADJUST',     -- 관리자 수동 조정
  'MIGRATION'   -- 레거시 profiles.credits → MY Pool 이관 흔적
);

CREATE TABLE public.token_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL,
  pool_id UUID NOT NULL REFERENCES public.token_pools(id) ON DELETE RESTRICT,
  from_pool_id UUID REFERENCES public.token_pools(id) ON DELETE RESTRICT,
  to_pool_id UUID REFERENCES public.token_pools(id) ON DELETE RESTRICT,
  type token_ledger_type_enum NOT NULL,
  amount INT NOT NULL,           -- pool 관점: +/-
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  job_id UUID REFERENCES public.generation_jobs(id) ON DELETE SET NULL,
  memo TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ledger_pool_created ON public.token_ledger(pool_id, created_at DESC);
CREATE INDEX idx_ledger_transaction ON public.token_ledger(transaction_id);
CREATE INDEX idx_ledger_type_created ON public.token_ledger(type, created_at DESC);
CREATE INDEX idx_ledger_job ON public.token_ledger(job_id) WHERE job_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_token_ledger_append_only()
  RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'token_ledger is append-only (%)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_no_update BEFORE UPDATE ON public.token_ledger
  FOR EACH ROW EXECUTE FUNCTION public.tg_token_ledger_append_only();

CREATE TRIGGER trg_ledger_no_delete BEFORE DELETE ON public.token_ledger
  FOR EACH ROW EXECUTE FUNCTION public.tg_token_ledger_append_only();

ALTER TABLE public.token_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY token_ledger_select_member ON public.token_ledger
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.token_pools p
      JOIN public.organization_members m ON m.organization_id = p.organization_id
      WHERE p.id = token_ledger.pool_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
  );

REVOKE INSERT ON public.token_ledger FROM authenticated, anon;
GRANT SELECT ON public.token_ledger TO authenticated;
GRANT ALL ON public.token_ledger TO service_role;
```

### 6.4 Migration 059 — `generation_jobs` OpenAI cost 확장

```sql
-- Depends on: 014 (generation_jobs)

ALTER TABLE public.generation_jobs
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS usage_input_tokens INT,
  ADD COLUMN IF NOT EXISTS usage_output_tokens INT,
  ADD COLUMN IF NOT EXISTS image_count INT,
  ADD COLUMN IF NOT EXISTS provider_cost_usd NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS provider_cost_krw NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS usage_raw JSONB;

CREATE INDEX IF NOT EXISTS idx_jobs_provider_completed
  ON public.generation_jobs(provider, completed_at DESC)
  WHERE completed_at IS NOT NULL;
```

### 6.5 Migration 060 — Credit Service RPC 6개

**Depends on**: 001 (profiles), 057 (token_pools), 058 (token_ledger)

각 함수는 `SECURITY DEFINER + SET search_path + service_role GRANT` 로 제한. 하나의 트랜잭션에서 Ledger insert → Pool update → profiles.credits update 순서 실행, 실패 시 전체 rollback.

세션 변수 `app.credit_service_active='true'` 를 RPC 시작 시 SET → M3 에서 트리거 활성 후 Guard 통과.

**정의만 배포 (M1). 앱은 아직 호출하지 않음.** 자세한 signature 는 §7 참조.

### 6.6 Migration 061 — `profiles.credits` Write Guard 함수만 정의

```sql
-- Depends on: 001 (profiles)
-- 함수만 정의. 트리거 부착은 M3 (Migration 066).

CREATE OR REPLACE FUNCTION public.tg_profiles_credits_write_guard()
  RETURNS TRIGGER AS $$
BEGIN
  IF NEW.credits IS DISTINCT FROM OLD.credits THEN
    IF current_setting('app.credit_service_active', TRUE) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'profiles.credits must be updated via Credit Service RPC only';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 6.7 Migration 062 — `provision_my_organization(user_id)` (M2)

**Depends on**: 001, 056, 057, 058, 060 — organizations.type · pool · ledger · allocate_tokens RPC 필요

```sql
-- Idempotent: 같은 유저에 두 번 호출해도 새 MY organization 생성 안 함
-- (organizations 의 personal UNIQUE partial index 로도 강제됨).

CREATE OR REPLACE FUNCTION public.provision_my_organization(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_pool_id UUID;
  v_credits INT;
  v_status TEXT;
BEGIN
  -- Idempotent: 이미 personal org 존재 확인
  SELECT id INTO v_org_id
    FROM public.organizations
   WHERE owner_id = p_user_id AND type = 'personal'
   LIMIT 1;

  IF v_org_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_provisioned', 'organization_id', v_org_id);
  END IF;

  -- 1. MY Organization 생성 (slug 는 hidden — 실제 사용자 URL 은 /organization/my)
  INSERT INTO public.organizations (name, slug, owner_id, type, max_visibility)
  VALUES (
    '내 워크스페이스',
    'personal-' || p_user_id::TEXT,  -- hidden, never shown in URL
    p_user_id,
    'personal',
    'private'
  )
  RETURNING id INTO v_org_id;

  -- 2. Owner Membership
  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  VALUES (v_org_id, p_user_id, 'owner', 'active');

  -- 3. Token Pool
  INSERT INTO public.token_pools (organization_id, balance)
  VALUES (v_org_id, 0)
  RETURNING id INTO v_pool_id;

  -- 4. 기존 profiles.credits 값 이관 (Credit Service allocate 호출)
  SELECT credits INTO v_credits FROM public.profiles WHERE id = p_user_id;
  IF v_credits IS NOT NULL AND v_credits > 0 THEN
    -- allocate(NULL, my_pool, v_credits, 'legacy migration', system)
    -- 내부 구현은 credit service RPC 호출
    PERFORM public.allocate_tokens(
      NULL, v_pool_id, v_credits, 'legacy migration', p_user_id
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'provisioned',
    'organization_id', v_org_id,
    'pool_id', v_pool_id,
    'migrated_credits', COALESCE(v_credits, 0)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION provision_my_organization(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provision_my_organization(UUID) TO service_role;
```

### 6.8 Migration 063 — `handle_new_user()` v2 (M2)

**Depends on**: 062

기존 트리거를 갱신 → 신규 유저 signup 시 profile + MY org + pool + 초기 credit 을 한 트랜잭션으로 생성. 내부적으로 `provision_my_organization` 호출.

### 6.9 Migration 064 — 전 유저 backfill (M2)

**Depends on**: 062

```sql
DO $$
DECLARE
  u RECORD;
BEGIN
  FOR u IN SELECT id FROM auth.users LOOP
    PERFORM public.provision_my_organization(u.id);
  END LOOP;
END $$;
```

### 6.10 Migration 065 — 기존 개인 데이터 이관 (M2)

**Depends on**: 064 (MY organization 이 이미 존재해야 함)

각 유저의 `owner_id` 기반 개인 데이터의 `organization_id` 를 유저의 MY org id 로 UPDATE. 대상: `images`, `generation_jobs`, `reference_images`, (personal knowledge 존재 시).

### 6.11 Migration 066 — Write Guard 트리거 활성 (M3)

**Depends on**: 061 (함수 정의). M3 시점 (앱 호출부 전환 완료 후) 에 트리거 부착.

```sql
CREATE TRIGGER trg_profiles_credits_write_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_profiles_credits_write_guard();
```

---

## 7. RPC 설계

### 7.1 `allocate_tokens(from, to, amount, memo, actor)`

지급. `from=NULL` → ISSUE (Super Admin 신규 발행). `from` 존재 → TRANSFER (같은 transaction_id 로 2 row).

### 7.2 `use_tokens(pool, amount, job, actor)`

이미지 생성 소진. Ledger USE row + Pool 감소. 부족 시 `INSUFFICIENT_BALANCE` 예외.

### 7.3 `refund_tokens(pool, amount, job, reason)`

실패/취소 환불. 중복 방지: 같은 `job_id + type=REFUND` row 존재 시 skip (metadata 로 slot 구분 옵션).

### 7.4 `adjust_tokens(pool, delta, memo, actor)`

관리자 수동 조정 (음수/양수 모두 가능). 결과 음수면 예외.

### 7.5 `transfer_tokens(from, to, amount, memo, actor)`

`allocate_tokens(from!=NULL)` 별칭.

### 7.6 `get_balance(pool)`

`RETURNS TABLE(pool_id UUID, balance INT, ledger_sum INT)` — invariant 검증 편의.

---

## 8. Credit Service 설계 (TypeScript)

### 8.1 파일 구조

```
src/services/credit/
  ├─ index.ts                        # 6개 함수 + 도메인 에러 export
  ├─ organization-pool-resolver.ts   # organization_id → 단일 token_pool 조회
  ├─ errors.ts                       # BalanceInsufficientError, PoolNotFoundError, ...
  └─ types.ts                        # Pool, Ledger, TransactionResult
```

**Resolver 책임 (제한적)**: `organization_id` 를 받아 대응하는 단일 `token_pools` row 를 반환. 개인/조직 분기 · fallback · priority 정책 없음 (모든 워크스페이스가 organization 이므로 분기 대상 자체 없음). Pool 이 없으면 `PoolNotFoundError` 예외 — 신규 유저는 Migration 062 로 자동 provision 되므로 실제로 발생하지 않아야 함.

### 8.2 공개 API

`allocate` / `use` / `refund` / `adjust` / `transfer` / `getBalance` — 각 함수 signature 는 v0.1.0 §8.2 그대로. Pool 라우팅은 `job.organization_id` 만 보면 되어 매우 단순.

### 8.3 도메인 에러

`BalanceInsufficientError` · `PoolNotFoundError` · `ForbiddenTransferError` · `AlreadyRefundedError`.

### 8.4 기존 코드 치환 매핑

| 기존 호출부 | 대체 |
|-----|------|
| `reserveCredits(userId, amount)` in job 생성 | `use({ poolId: <job.org pool>, amount, jobId, actorId: userId })` |
| `refundCredits(userId, amount)` in 실패 처리 | `refund({ poolId, amount, jobId, reason })` |
| `package-pipeline.markSlotFailedAndRefund` | 내부에서 `refund()` 호출로 전환 |
| upscale route (Lanczos 0 크레딧) | 그대로 (`cost=0` 이면 use/refund skip 이미 구현됨) |

---

## 9. API 설계

### 9.1 Super Admin

| Method | Path | 설명 | 권한 |
|-----|------|------|------|
| `POST` | `/api/admin/organizations/[id]/allocate` | Super Admin → Organization Pool 지급 (ISSUE) | `isAdmin(user.email)` |
| `GET` | `/api/admin/token-dashboard` | 전체 통계 | Admin |
| `GET` | `/api/admin/organizations` | 조직 목록 + 요약 | Admin |
| `GET` | `/api/admin/usage` | 월별/조직별/유저별 사용 통계 | Admin |
| `GET` | `/api/admin/billing` | OpenAI 실비용 집계 | Admin |
| `POST` | `/api/admin/migrate/tokens` | Backfill 재실행 (idempotent) | Admin |

### 9.2 Organization

| Method | Path | 설명 | 권한 |
|-----|------|------|------|
| `GET` | `/api/organizations/[slug]/tokens` | 조직 pool 요약 | Active member |
| `GET` | `/api/organizations/[slug]/members/tokens` | 조직 멤버 목록 | Org Admin |
| `POST` | `/api/organizations/[slug]/members/[userId]/allocate` | Org Admin → Member 지급 | Org Admin |
| `GET` | `/api/organizations/[slug]/tokens/history` | 조직 ledger 이력 | Active member |
| `GET` | `/api/organizations/[slug]/members/[userId]/history` | 특정 멤버 ledger | Org Admin or 본인 |

### 9.3 Member

| Method | Path | 설명 | 권한 |
|-----|------|------|------|
| `GET` | `/api/me/tokens` | 본인 MY pool + 최근 요약 | authenticated |
| `GET` | `/api/me/tokens/history` | 본인 ledger | authenticated |

---

## 10. 사용자 검증 가이드 (마일스톤 별)

### 10.1 M1 완료 후 검증

**목적**: 신규 스키마·RPC 배포가 기존 서비스에 영향 주지 않음 확인

**테스트 순서**:
1. 로그인 → 기존과 동일하게 접속 성공
2. `/library` 접속 → 기존 이미지 목록 정상 표시
3. `/generate-v2` 접속 → 새 이미지 생성 시도
4. 생성 성공 확인 + `profiles.credits` 정상 차감
5. 생성 실패 유도 (예: 잘못된 프롬프트) → 크레딧 환불 확인
6. Upscale (Lanczos) → 크레딧 변화 없음 확인
7. Admin (`/admin/knowledge`) 접속 → 정상

**정상 결과**: 모든 기존 UX 무변화. DB 에는 신규 테이블 (`token_pools`, `token_ledger`) 이 존재하되 비어 있음.

**Rollback**: `DROP TABLE token_ledger, token_pools; ALTER TABLE organizations DROP COLUMN type; DROP FUNCTION allocate_tokens, use_tokens, refund_tokens, adjust_tokens, transfer_tokens, get_balance, tg_profiles_credits_write_guard;`

### 10.2 M2 완료 후 검증

**테스트 순서**:
1. 로그인 → `/organizations` 랜딩 (또는 조직 하나뿐이면 `/organization/my`)
2. `/organizations` 에서 "내 워크스페이스" 카드 확인
3. `/library` 접속 → `/organization/my/library` 로 redirect
4. `/generate` 접속 → `/organization/my/generate` 로 redirect
5. 기존 이미지 수 · Reference Image 수 유지 확인
6. MY 카드 상세 접속 → members / invite 메뉴 미노출 확인
7. `provision_my_organization` 재실행 (Admin) → 새 조직 생성 안 됨 (idempotent 확인)
8. 신규 유저 signup → MY Organization + Pool 자동 생성 확인
9. 기존 크레딧 파이프라인 여전히 동작 (신규 use/refund 는 M3)

**정상 결과**: 사용자 관점에서 UI 진입점만 바뀜. 크레딧 차감 흐름은 M1 그대로.

**Rollback**: 개인 데이터의 `organization_id` 를 NULL 로 복구 → MY organizations DELETE → handle_new_user v1 복원.

### 10.3 M3 완료 후 검증

**테스트 순서**:
1. `/organization/my/generate` → Single 이미지 생성
   - MY Pool 크레딧 감소 확인
   - Ledger USE row 생성 확인
   - Job 성공 후 완료 시각 · usage · cost 저장 확인
2. `/organization/my/generate` → Package 생성 → 일부 slot 실패
   - 성공 slot 만큼 USE, 실패 slot 은 REFUND row 생성
   - 중복 환불 없음
3. 학교 조직 컨텍스트로 이동 → 학교 조직 pool 소진 (MY pool 무변화)
4. Upscale (Lanczos) → 크레딧 무변화 (cost=0 skip)
5. `profiles.credits` 직접 UPDATE 시도 (SQL 콘솔) → 예외 발생
6. Reconciliation view 확인: 모든 pool 에 대해 `SUM(ledger) = balance`

**정상 결과**: 앱 UX 는 기존과 동일하되 내부는 신규 파이프라인 사용. Ledger 로 모든 변동 감사 가능.

**Rollback**: services/credit 롤백 (deprecated wrapper 가 여전히 작동), Migration 066 (Write Guard 트리거 부착) DROP TRIGGER.

### 10.4 M4 완료 후 검증

**테스트 순서**:
1. Super Admin `/admin/token-dashboard` 접속 → 전체 통계 확인
2. `/admin/organizations` 에서 학교 조직 선택 → +100/+300/+500 지급 → Ledger ISSUE 확인
3. Org Admin 계정으로 `/organization/{학교}/settings/token` 접속 → Pool 상태 확인
4. 멤버 목록에서 특정 멤버에게 지급 → Ledger TRANSFER 2 row 확인
5. 지급 이력 · 사용 이력 · 생성 내역 정상 표시
6. Member 로그인 → `/organization/my` + `/organization/{학교}` 양쪽 접근
7. Reconciliation 배치 alert 파이프라인 확인

**정상 결과**: 3계층 지급/사용/조회가 UI 로 완결됨.

**Rollback**: 신규 API/UI 롤백 (DB 는 유지).

---

## 11. Rollback 전략

각 마일스톤별 §10 참조. 공통 원칙:
- 모든 Migration 은 idempotent
- 각 Migration 옆에 `_rollback.sql` 준비
- Ledger 는 append-only 라 rollback 후에도 audit 기록 유지
- M2 이관 데이터는 백업 후 실행

---

## 12. 테스트 전략

- **RPC unit**: allocate ISSUE/TRANSFER · use · refund 중복 · adjust 음수 · transfer 원자성
- **Migration**: `provision_my_organization` idempotent · backfill 후 invariant · fallback 정확성
- **Race condition**: 동일 pool concurrent use × N → SUM 정확
- **Reconciliation**: 인위적 drift 감지
- **App-level 회귀**: Single Job / Package Job / Upscale / rehydrate

---

## 13. Definition of Done

각 마일스톤 §2 의 "완료 조건" 그대로 채택. 하나라도 미충족이면 다음 마일스톤 진입 금지.

---

## 14. Decisions (확정)

v0.1.0 초안의 Open Decisions 상태:

| ID | 항목 | v0.2.0 확정 |
|----|------|-------------|
| D-1 | Ledger type set | **확정** — 6개 (`ISSUE` / `TRANSFER` / `USE` / `REFUND` / `ADJUST` / `MIGRATION`) |
| D-2 | `transaction_id` 도입 | **확정** — 도입 (transfer 2-row 묶음) |
| D-3 | department/future pool type | **폐기** — Personal Pool 개념 자체가 organization 으로 흡수됨. `organizations.type` 이 그 자리 |
| D-4 | Ledger `metadata` JSONB | **확정** — 도입 (자유 shape, 예시 스키마 문서화) |
| D-5 | Pool 라우팅 정책 | **폐기** — `job.organization_id` → pool 이 자동 결정, 개인/조직 분기 없음 |
| D-6 | `monthly_credit_reset` | **확정** — 유지. 다만 Personal Pool 개념이 폐기되었으므로 표현을 다음으로 정확화한다: (1) 대상은 `organizations.type='personal'` 인 MY Organization 의 Token Pool 만. school/general Organization Pool 은 미적용. (2) 기준 잔액 (예: 30) 보다 부족한 수량만큼만 `ISSUE`. 초과·동일 잔액이면 아무것도 하지 않음. (3) `memo='monthly reset'`, `metadata={"cycle": "YYYY-MM"}` 필수. (4) 월별 idempotency key: 같은 `cycle` 값의 Ledger row 가 이미 있으면 skip (`unique (pool_id, type, (metadata->>'cycle')) WHERE type='ISSUE' AND memo='monthly reset'` 부분 인덱스 또는 함수 내부 사전 조회). |
| D-7 | 조직 초기 크레딧 | **확정** — 0 (Super Admin 명시적 지급 필요) |
| D-8 | OpenAI cost 저장 시점 | **확정** — Job `completed_at` 시점 upsert (배치 근사 X) |
| D-9 | Reconciliation 실행 환경 | **확정** — Supabase pg_cron |
| D-10 | Migration 실행 트리거 | **확정** — `POST /api/admin/migrate/tokens` 신설 + `provision_my_organization` 은 signup 트리거로도 병행 |
| D-11 | 이관 후 `profiles.credits` 유지 | **확정** — 유지 (UI Cache), M3 에서 Write Guard 활성 |
| D-12 | Admin allocate 상한 | **확정** — 상한 없음, `metadata.reason` 필수 |
| D-open-1 | `/library` `/generate` redirect 유지 기간 | **미확정** — 사용자 결정 대기 (제안: 3개월) |
| D-open-2 | MY organization slug 저장 형식 | **확정** — (a) 사용자 URL: `/organization/my`. (b) DB 내부 slug: `personal-{user_id}` 사용 가능 (hidden). (c) 사용자 화면에 내부 slug 미노출 (middleware 가 항상 `/organization/my` 로 rewrite 유지). (d) 실제 권한·조회 기준은 `owner_id + type='personal'` (slug 문자열이 아니라). (e) 사용자당 personal Organization 1개를 DB Unique Constraint 로 보장 (Migration 056 의 `idx_organizations_personal_owner` partial unique index). (f) 예약어 `my` `me` `admin` `api` `organizations` `organization` 은 일반 조직 slug 로 CHECK 금지 |
| D-open-3 | 다중 조직 소속자 로그인 후 랜딩 | **확정** — `/organizations` (사용자 명시적 선택 원칙) |
| D-open-4 | 단일 MY 유저 랜딩 | **확정** — `/organization/my` 자동 진입 |
| D-open-5 | Migration 실행 방식 | **확정** — Admin API 로 batch 트리거 + signup 트리거 병행 |
| D-open-6 | 이관 fallback 종료 시점 | **미확정** — M2 완료 후 관찰 기간 확정 |
| D-open-7 | Phase 1 배포 시점 | **미확정** — 사용자 결정 |

---

## 15. Proposal → 확정 반영

v0.1.0 의 P-1 ~ P-5 는 모두 확정 채택 (§6, §7, §8 에 반영):

- P-1 (Ledger metadata JSONB) → 채택 (Migration 057)
- P-2 (transaction_id) → 채택 (Migration 057)
- P-3 (~~pool-router.ts~~) → **수정 채택**. Personal Pool 개념이 폐기되어 "라우팅" 의미가 없어짐. 대신 `organization-pool-resolver.ts` 로 이름·책임 축소: `organization_id → 단일 token_pool` 조회만 담당 (§8.1)
- P-4 (`POST /api/admin/migrate/tokens`) → 채택 (§9.1)
- P-5 (`token_reconciliation` VIEW) → 채택 (M2 이후 Reconciliation 배치)

---

## 16. Related Documents

- **PRD (SoT)**:
  - `PRD_Organization_Token_Management_v1.0.md` (기능 요구)
  - `PRD_Token_Architecture_Addendum_v1.1.md` (아키텍처 원칙)
  - `MY_Organization_Decision_Response.md` (UX/데이터 모델 결정)
- **기존 프로젝트 Plan**: `docs/01-plan/features/clipart-studio.plan.md` (수정 없음)
- **기존 프로젝트 Design**: `docs/02-design/features/clipart-studio.design.md`
- **Design 문서 (다음 단계)**: `docs/02-design/features/organization-token-management.design.md` (M1 착수 시 별도 작성)

---

## 17. Deferred UX TODO (Non-Blocker)

사용자 확정 정책은 만족하지만 UX 가 더 명확해질 수 있는 항목들. 다음 iteration 후보이며 현재 스코프의 blocker 는 아님.

| ID | 항목 | 원 스코프 | 기록 사유 | 제안 방향 |
|----|-----|----------|-----------|----------|
| UX-TODO-01 | 조직 라이브러리 "공유받은 이미지" 탭에서의 다중선택 액션 | M3-2 | 현재 [ZIP 다운로드] · [조직에 공유] 액션이 노출되며 서버 소유자 검증으로 자동 skip 됨. UX 상 "0개 다운로드" 같은 혼란 여지 존재 | 탭별로 액션 세트를 다르게 노출 — `shared` 탭은 액션바 자체를 숨기거나, "원 소유자만 가능" 안내와 함께 disabled 처리. `created` 탭은 [공유 해제] 액션 추가 검토 |

*추후 항목은 이 표에 계속 append.*

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1.0 | 2026-08-06 | 초안 — PRD v1.0 + Addendum v1.1 을 SoT 로 착수 Plan 작성. 12개 Decision 항목 및 5개 Proposal 포함. | sbtmxk20 |
| 0.2.0 | 2026-08-06 | MY Organization Decision Response 반영. Personal Pool 개념 폐기 → 모든 워크스페이스가 organization 으로 통일. `organizations.type` 도입. `/organization/my` URL alias 확정. 4개 사용자 검증 마일스톤으로 재구성. D-3/D-5 폐기, D-open-2/3/4/5 확정, Proposal P-1~P-5 모두 확정 반영. | sbtmxk20 |
| 0.2.1 | 2026-08-06 | 사용자 M1 착수 전 4개 조정 반영: (1) Migration 순서 재정렬 — `organizations.type` (056) 을 `token_pools` 보다 먼저 배치, 각 Migration `depends_on` 명시. (2) `pool-router.ts` Proposal 수정 — `organization-pool-resolver.ts` 로 이름·책임 축소 (개인/조직 분기 없음). (3) `monthly_credit_reset` D-6 표현 수정 — "personal pool 대상" → "organizations.type='personal' 인 MY Organization Pool 대상", 부족 수량만 ISSUE, 월별 idempotency key 필수. (4) D-open-2 확정 세부 반영 — 사용자당 personal Organization 1개 UNIQUE partial index (Migration 056), 실제 권한 기준은 `owner_id + type='personal'`. | sbtmxk20 |
| 0.2.2 | 2026-08-06 | M1 승인 · M2 재개 시점. M2 범위를 "데이터 이관 중심" 에서 "**진입 구조 전환 포함**" 으로 확장. 상단 네비 조정 (`+클립아트 만들기` · `MY` 제거, `우리학교` 만 유지), 라우트 재구성 (`/organization/[slug]/{library,generate}` 신규 · 기존 페이지 삭제 후 next.config redirect), MY Organization 의 멤버/초대/해체 UI 및 API 거부를 M2 에 포함. 사용자 지시 M2 완료 기준 7가지 그대로 채택. Redirect 는 오직 기존 링크/북마크 호환용이며 앱 내부 링크는 새 경로만 사용. | sbtmxk20 |
| 0.2.3 | 2026-08-06 | M2 완료 · M3 착수 준비. M3 의 관점을 "기술 계층 전환" 에서 "**Workspace 독립성 완성**" 으로 재프레임 (사용자 지시). 완료 기준을 Workspace 단위 6가지 (Job/Conversation/Credit 표시/Token 차감/Library/Generate) 로 재정리. Credit Service · Conversation store 조직별 격리 · Library 조직 필터 · Job 조직 라우팅 · 조직 크레딧 표시 UI 를 하나의 M3 스코프로 통합. Admin Allocate API (`POST /api/admin/organizations/[id]/allocate`) 는 M3 에 포함 (B-2), 대응 UI 는 M4 유지. | sbtmxk20 |
| 0.2.4 | 2026-08-06 | M3 를 4개 하위 마일스톤으로 분할 (사용자 지시): M3-1 (Workspace Generate — Job/Library 조직 라우팅) → M3-2 (Workspace Conversation 격리 + persist migration) → M3-3 (Credit Service · Pool Resolver · Admin Allocate API · Write Guard 부착) → M3-4 (Header/Sidebar Credit 표시 · Member API · Reconciliation 등록). 각 하위 마일스톤 종료 시 tsc/build 확인 후 사용자 직접 테스트, 승인 시 다음 진행. 내부 커밋은 자유롭게 세분화하되 사용자 검증 지점은 4개. | sbtmxk20 |
| 0.2.5 | 2026-08-06 | 사용자 검증 지점을 4개 → 3개로 재조정. 기술 범위는 v0.2.4 (M3-1~M3-4) 그대로 유지하되 다음 3개 단위로 묶음: **M3-A** (구 M3-1 + M3-2 — Workspace 작업 분리: Generate 조직 라우팅 · Library 필터 · Conversation 격리 · Persist migration · 비멤버 접근 거부) → **M3-B** (구 M3-3 + M3-4 크레딧 UI — Workspace Credit: Credit Service · Pool Resolver · 호출부 전환 · Admin Allocate API · 크레딧 표시 UI · 잔액 부족 처리 · 호출부 전환 검증 후 Write Guard 활성) → **M3-C** (구 M3-4 나머지 — 안정화 및 전체 검증: Member Token API · History API · Reconciliation · Legacy 정리 · 동시성 · 회귀 · M3 6개 완료 기준 최종 확인). 함수·Migration 단위로는 승인받지 않고, 검증 단위로만 승인받는다. | sbtmxk20 |
| 0.2.6 | 2026-08-06 | 사용자 UX 관점 4개 단위로 재배치 (사용자 지시). 기술 범위 감축 없이 다음 순서: **M3-1 Workspace 생성** ("각 조직에서 생성이 되는가" — Generate 조직 라우팅 · Membership 검증 · Job/Image org_id 저장) → **M3-2 Workspace 데이터** ("각 조직 데이터가 섞이지 않는가" — Library 필터 · Conversation 격리 · Sidebar · Persist migration) → **M3-3 Workspace Credit** ("각 조직 크레딧이 따로 소진되는가" — Credit Service · Pool · Ledger · Allocate/Refund · Write Guard · 조직 크레딧 표시 UI · Admin Allocate API) → **M3-4 운영** (전체 회귀 · History · Statistics · Reconciliation · Rollback · Legacy 정리). 사용자 승인 지점 4개, 내부 커밋은 자유롭게 세분화. | sbtmxk20 |
| 0.2.7 | 2026-08-06 | M3-1 완료 · M3-2 착수 준비. M3-4 → **M3-C** rename (사용자 지시 표기 일치). 완료 보고 형식 문서화 (§2.3 상단) — 5개 섹션 순서 명시: 이번에 사용자가 사용할 수 있게 된 기능 → 사용자 테스트 (5분) → 개발 검증 (SQL) → 현재 제한사항 → 다음 단계. 기술 범위 변경 없음. | sbtmxk20 |
| 0.2.8 | 2026-08-10 | M3-2 완료 확정 (커밋 eb4bdcd + 6f5117f). 사용자 확정 Library 정책 명문화: `images.organization_id` = 생성 워크스페이스 · `image_organization_shares` = 명시적 공유 · 비공유 이미지 워크스페이스 간 노출 금지 · 공유는 소유권/복제 아님. 조직 라이브러리 3-tab (전체/이 조직에서 만든 이미지/공유받은 이미지) 복원 — 기존 인프라 재사용, 신규 스키마 0건. Deferred UX TODO 섹션 신설 (§17) — "공유받은 이미지 탭의 ZIP/재공유 액션 UX 정리" 를 M3-2 비 blocker 로 기록. M3-3 착수 승인. | sbtmxk20 |
