# Organization Token Management Planning Document

> **Summary**: Super Admin → Organization → Member 3계층 토큰 관리 SaaS 인프라. 개인 사용도 "1인 Organization (type=personal)" 으로 통일해 모든 워크스페이스를 Organization 하나의 개념으로 관리한다. Ledger 기반 감사(Source of Truth) · Pool 기반 잔액 캐시 · profiles.credits UI 캐시 3-tier 구조.
>
> **Project**: ClipArt Studio — Organization Token Management
> **Version**: 0.2.1 (Plan — 사용자 M1 착수 전 4개 조정 반영)
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

### 2.2 Milestone 2 — MY Organization 및 기존 데이터 이관

**포함**

- [ ] Migration 062 — `provision_my_organization(user_id)` RPC (idempotent)
- [ ] Migration 063 — `handle_new_user()` v2 트리거 갱신 (신규 유저 signup 시 profile + MY org + Owner membership + Pool + 초기 Ledger 를 한 트랜잭션으로 생성)
- [ ] Migration 064 — 전 유저 backfill 스크립트 (기존 유저마다 `provision_my_organization` 호출)
- [ ] Migration 065 — 기존 개인 데이터 이관 스크립트 (images / generation_jobs / reference_images / knowledge 등 `owner_id` 기반 개인 데이터의 `organization_id` 를 유저의 MY org id 로 UPDATE)
- [ ] Next.js redirect 추가 (`next.config.js`): `/library` → `/organization/my/library`, `/generate` → `/organization/my/generate`, `/generate-v2` → `/organization/my/generate`
- [ ] `/organization/my/*` middleware — 세션 유저 → 유저의 MY organization 조회 → route handler 에 `organization_id` 컨텍스트 주입 (route 파일은 M4 에서 실제 UI 로 채움; 이 마일스톤은 middleware / route resolver 만 배포)
- [ ] `/organizations` 페이지에 MY 카드 표시 (기존 조직 카드와 나란히)

**포함하지 않음**

- Credit Service 앱 코드 전환 (M3)
- `profiles.credits` Write Guard 활성화 (M3)
- Organization Token 설정 UI (M4)
- Admin Dashboard (M4)

**M2 완료 조건**

- `SELECT COUNT(*) FROM organizations WHERE type='personal'` = `SELECT COUNT(*) FROM auth.users`
- `SELECT COUNT(*) FROM token_pools` = `SELECT COUNT(*) FROM organizations`
- `provision_my_organization` 재실행 (idempotent) → 중복 MY Organization 생성되지 않음
- `/library` 접속 → `/organization/my/library` 로 redirect
- `/organizations` 랜딩 → MY 카드 (`내 워크스페이스`) + 기존 조직 카드 함께 표시
- **기존 개인 이미지 수 · Reference Image 수 · 생성 이력 유지** (`organization_id` 로 재라벨되어 있으나 사용자 조회 결과는 동일)
- MY 카드에는 `members` / `invitations` 메뉴 미노출
- 사용자 테스트 가이드 제공 (§10.2)

### 2.3 Milestone 3 — Credit Service · 호출부 전환 · Write Guard 활성

**포함**

- [ ] `src/services/credit/` 재작성 (신규 6개 함수 + `pool-router.ts` + `errors.ts` + `types.ts`)
- [ ] `POST /api/jobs` 신규 `use()` 로 전환 (organization_id 없으면 세션 유저 MY org id 로 라우팅)
- [ ] `GET /api/jobs/[id]/stream` 실패 환불을 `refund()` 로 전환
- [ ] `services/image-gen/package-pipeline.markSlotFailedAndRefund` 를 `refund()` 로 전환
- [ ] `POST /api/images/[id]/upscale` 을 `use()` / `refund()` 로 전환 (기존 Lanczos 0 크레딧 정책 유지)
- [ ] 기존 `reserveCredits` / `refundCredits` 는 신규 서비스로 위임하는 deprecated wrapper 로 유지 (30일)
- [ ] Migration 066 — `profiles.credits` Write Guard 트리거 부착 (M1 에서 함수만 정의됨) + 세션 변수 `app.credit_service_active` 기반 판별
- [ ] Idempotency: `refund()` 는 `job_id + type=REFUND` row 존재 시 skip
- [ ] `/api/me/tokens` + `/api/me/tokens/history` API 신설 (Member 본인 조회)

**포함하지 않음**

- Organization Token 설정 UI (M4)
- Super Admin Dashboard (M4)
- 기존 `reserve_credits` / `refund_credits` RPC 삭제 — 관찰 기간 후 별도 Migration

**M3 완료 조건**

- `pnpm tsc --noEmit` PASS
- `pnpm build` PASS
- 회귀: Single Job · Package Job · Upscale 이 정상 동작
- MY 워크스페이스 생성 → MY Pool 소진 + Ledger USE row 확인
- 학교 조직 컨텍스트 생성 → 학교 Pool 소진, MY Pool 무변화
- 생성 실패 → Ledger REFUND row + Pool balance 복구
- 중복 환불 방지 확인
- `profiles.credits` 직접 UPDATE 시도 (Credit Service 밖) → 트리거 예외
- Reconciliation 배치 결과: drift = 0
- 사용자 테스트 가이드 제공 (§10.3)

### 2.4 Milestone 4 — Organization · Admin UI

**포함**

- [ ] `/organizations` 페이지 완성 (최근 사용 공간 · 내 워크스페이스 · 참여 중 조직 3-그룹 표시)
- [ ] `/organization/{slug}/library` (기존 `/library` 이관 · MY / 학교 공용)
- [ ] `/organization/{slug}/generate` (기존 `/generate-v2` 이관)
- [ ] `/organization/{slug}/history` (생성 이력)
- [ ] `/organization/{slug}/reference-images`
- [ ] `/organization/{slug}/settings/token` (Org Admin only — Summary · Pool · Members · Allocate · History · Usage)
- [ ] `POST /api/organizations/{slug}/members/{userId}/allocate` (Org Admin → Member 지급)
- [ ] `GET /api/organizations/{slug}/tokens` · `/history` · `/members/tokens`
- [ ] `/admin/token-dashboard` (전체 조직 · 사용자 · 총 지급 · 총 사용 · OpenAI 비용)
- [ ] `/admin/organizations` (Super Admin → Org 지급 CTA)
- [ ] `/admin/usage` (월별 · 조직별 · 유저별 통계)
- [ ] `/admin/billing` (OpenAI 실비용 집계)
- [ ] `POST /api/admin/organizations/{id}/allocate` (Super Admin → Org 지급)
- [ ] `POST /api/admin/migrate/tokens` (M2 backfill 재실행 트리거 · idempotent)
- [ ] `GET /api/admin/token-dashboard`
- [ ] Reconciliation cron 등록 (Supabase pg_cron)
- [ ] MY 조직에 대해 members / invite / role change / dissolve API 호출 → 403 반환

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

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1.0 | 2026-08-06 | 초안 — PRD v1.0 + Addendum v1.1 을 SoT 로 착수 Plan 작성. 12개 Decision 항목 및 5개 Proposal 포함. | sbtmxk20 |
| 0.2.0 | 2026-08-06 | MY Organization Decision Response 반영. Personal Pool 개념 폐기 → 모든 워크스페이스가 organization 으로 통일. `organizations.type` 도입. `/organization/my` URL alias 확정. 4개 사용자 검증 마일스톤으로 재구성. D-3/D-5 폐기, D-open-2/3/4/5 확정, Proposal P-1~P-5 모두 확정 반영. | sbtmxk20 |
| 0.2.1 | 2026-08-06 | 사용자 M1 착수 전 4개 조정 반영: (1) Migration 순서 재정렬 — `organizations.type` (056) 을 `token_pools` 보다 먼저 배치, 각 Migration `depends_on` 명시. (2) `pool-router.ts` Proposal 수정 — `organization-pool-resolver.ts` 로 이름·책임 축소 (개인/조직 분기 없음). (3) `monthly_credit_reset` D-6 표현 수정 — "personal pool 대상" → "organizations.type='personal' 인 MY Organization Pool 대상", 부족 수량만 ISSUE, 월별 idempotency key 필수. (4) D-open-2 확정 세부 반영 — 사용자당 personal Organization 1개 UNIQUE partial index (Migration 056), 실제 권한 기준은 `owner_id + type='personal'`. | sbtmxk20 |
