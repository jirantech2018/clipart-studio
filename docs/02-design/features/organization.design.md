# Organization — Design v0.1 (Draft)

> **Summary**: SaaS 형 조직 계층 도입 설계. 계정(auth.users) 위에 organizations 를 얹고, images 는 개인 소유 원칙을 유지한 채 `image_organization_shares` 연결 테이블로 조직 라이브러리에 노출. 3단계 공개(private/organization/community) RLS 강제.
>
> **Version**: 0.1.0 (Draft)
> **Author**: sbtmxk20
> **Date**: 2026-07-16
> **Status**: Draft — 사용자 리뷰 대기
> **PRD**: [organization.prd.md](../../00-pm/organization.prd.md)

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 같은 조직 내 자산 공유·권한 통제·SaaS 전환. 3단계 공개 (private → organization → community) 로 Community 승격 심리 저항 완화 |
| **WHO** | 기존 P1~P5 + 조직 페르소나 P6(owner)/P7(admin)/P8(editor)/P9(viewer) |
| **RISK** | 소유권 모델 복잡화, RLS 성능(N+1 조인), 초대 스팸, `is_shareable` 확장 마이그레이션 |
| **SUCCESS** | 조직당 활성 멤버 ≥5, 초대 수락률 ≥60%, 조직→Community 승격율 ≥10%, 조직 이미지 재사용률 ≥50% |
| **SCOPE** | v1.0: 조직 CRUD + 4역할 + 3단계 공개 + `is_shareable` 확장. v2+: 여러 조직 공유 UI, 조직 소유 이미지, 결제 |

---

## 1. Design Goals

1. **개인 소유 원칙 보호** — 이미지는 항상 auth.users 소유. 조직 공유 = 조회 권한 부여일 뿐
2. **RLS-First 확장** — 기존 P1/P2 정책과 자연스럽게 조합. `auth.uid() = user_id OR is_public OR is_shareable OR is_org_member(org)`
3. **연결 테이블 우선** — v1.0 UI 는 단일 조직이지만 스키마는 N:N. 나중에 확장 시 마이그레이션 없음
4. **확장 인프라 재사용** — P2 selectionStore 의 scope 개념이 자연스레 `organization:{orgId}` 로 확장됨
5. **소프트 삭제 + 유예 기간** — 조직 삭제는 30일 유예. 실수 복구 가능

## 2. Design Principles

- **Feature isolation**: `features/organization/` 신설. `features/library/`, `features/community/` 는 조직을 참조하지 않고 `services/` 경유
- **Server-first for role check**: 역할 검증은 100% 서버 (RLS + API). 클라이언트는 UI 힌트 용도
- **Idempotent invites**: 같은 이메일 재초대 시 토큰만 갱신, 중복 초대 row 없음
- **Least privilege**: viewer 는 열람·다운로드만. editor 는 자기 이미지만 조직에 공유. admin+ 이 승격/강등
- **Non-Negotiable Rule 4 확장**: Community 노출은 여전히 명시 액션만. 조직 승격은 별개 명시 액션

---

## 3. Data Model

### 3.1 `organizations`

```sql
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,  -- URL 노출용, /organization/{slug}
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  homepage_url TEXT,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  -- link 공유 상한 정책 (결정 13, Option C)
  max_link_share_scope TEXT NOT NULL DEFAULT 'authenticated'
    CHECK (max_link_share_scope IN ('off', 'organization', 'authenticated', 'public')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,  -- soft delete
  CONSTRAINT organizations_slug_format
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,63}$'),  -- 소문자·숫자·하이픈, 3~64자
  CONSTRAINT organizations_name_length
    CHECK (char_length(name) BETWEEN 1 AND 100)
);

CREATE INDEX idx_organizations_owner ON public.organizations(owner_id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_organizations_slug ON public.organizations(slug)
  WHERE deleted_at IS NULL;
```

**설계 노트**:
- `owner_id ON DELETE RESTRICT` — owner 계정 삭제 전 소유권 이전 강제
- `slug` unique 강제, 소문자/하이픈만 (URL 안전)
- `max_link_share_scope` 로 조직 policy 노출

### 3.2 `organization_members`

```sql
CREATE TYPE organization_role AS ENUM ('owner', 'admin', 'editor', 'viewer');

CREATE TABLE public.organization_members (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role organization_role NOT NULL DEFAULT 'viewer',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX idx_organization_members_user
  ON public.organization_members(user_id, status)
  WHERE status = 'active';
```

**설계 노트**:
- Composite PK 로 중복 방지
- `status='suspended'` 로 정지된 멤버는 접근 차단 but 감사 로그 유지
- Auth 사용자 삭제 시 CASCADE — 멤버십도 사라짐

### 3.3 `organization_invites`

```sql
CREATE TABLE public.organization_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role organization_role NOT NULL,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  token TEXT NOT NULL UNIQUE,  -- 초대 링크에 담길 랜덤 토큰
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_invites_email_lowercase
    CHECK (email = lower(email)),
  CONSTRAINT organization_invites_ttl
    CHECK (expires_at > created_at)
);

-- 같은 (조직, 이메일) 에 대해 pending 인 초대는 1개만 (재발송 = 기존 토큰 갱신)
CREATE UNIQUE INDEX idx_organization_invites_unique_pending
  ON public.organization_invites(organization_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
```

**설계 노트**:
- `expires_at` 기본 7일 (API 에서 세팅)
- Unique partial index 로 pending 초대 중복 방지 — 재발송 시 UPDATE
- `revoked_at` 로 admin 이 초대 취소

### 3.4 `image_organization_shares` (연결 테이블)

```sql
CREATE TABLE public.image_organization_shares (
  image_id UUID NOT NULL REFERENCES public.images(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shared_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  shared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (image_id, organization_id)
);

CREATE INDEX idx_ios_organization ON public.image_organization_shares(organization_id, shared_at DESC);
CREATE INDEX idx_ios_image ON public.image_organization_shares(image_id);
```

**설계 노트**:
- N:N 관계 (결정 6/10/11)
- v1.0 API 는 이미지당 조직 1개만 허용 (Zod 검증), 스키마는 열림
- 이미지 삭제 시 CASCADE

### 3.5 `images` 확장 (링크 공유 정책 v2)

기존 `is_shareable BOOLEAN` 을 `link_share_scope` enum 으로 마이그레이션 (결정 13 Option C):

```sql
CREATE TYPE link_share_scope AS ENUM ('off', 'organization', 'authenticated', 'public');

ALTER TABLE public.images
  ADD COLUMN link_share_scope link_share_scope NOT NULL DEFAULT 'off';

-- 기존 is_shareable=TRUE 를 'authenticated' 로 마이그레이션
UPDATE public.images SET link_share_scope = 'authenticated' WHERE is_shareable = TRUE;

-- is_shareable 컬럼은 나중에 (v1.1) drop 예정
```

`link_share_scope` 의미:
- `off`: 링크 공유 비활성
- `organization`: 이미지의 조직 공유 대상 조직 멤버만 접근
- `authenticated`: 로그인한 모든 회원 접근 (기존 `is_shareable=TRUE` 상당)
- `public`: 비회원도 접근 (URL 만 있으면 로그인 없이 볼 수 있음, v2)

**조직 상한 검증**: 이미지의 link_share_scope 는 그 이미지가 공유된 조직의 `max_link_share_scope` 를 초과할 수 없음. API+DB trigger 로 이중 검증.

### 3.6 Migration Strategy

- 신규 테이블 3개 추가만, 기존 테이블에 파괴적 변경 없음
- `images.link_share_scope` 는 추가 (기존 컬럼 유지, v1.1 에서 `is_shareable` drop)
- 기존 이미지는 모두 개인 소유 유지 — 어떤 이미지도 자동으로 조직에 소속되지 않음
- Backfill 없음 — 사용자가 명시적으로 조직 생성 + 이미지 공유

---

## 4. Access Control

### 4.1 Helper: 조직 멤버십 함수

```sql
-- 특정 유저가 조직에 active 멤버인지
CREATE OR REPLACE FUNCTION public.is_org_member(org_id UUID, uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.organization_members
    WHERE organization_id = org_id
      AND user_id = uid
      AND status = 'active'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 특정 유저의 조직 내 역할
CREATE OR REPLACE FUNCTION public.org_role(org_id UUID, uid UUID)
RETURNS organization_role AS $$
  SELECT role FROM public.organization_members
  WHERE organization_id = org_id
    AND user_id = uid
    AND status = 'active';
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 이미지가 사용자에게 조직 공유로 접근 가능한지
CREATE OR REPLACE FUNCTION public.image_visible_via_org(img_id UUID, uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.image_organization_shares ios
    JOIN public.organization_members om
      ON om.organization_id = ios.organization_id
    WHERE ios.image_id = img_id
      AND om.user_id = uid
      AND om.status = 'active'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

### 4.2 `images` SELECT RLS 확장

```sql
DROP POLICY IF EXISTS images_select_own_public_or_shareable ON public.images;

CREATE POLICY images_select_v3 ON public.images
  FOR SELECT USING (
    auth.uid() = user_id                          -- 소유자
    OR is_public = TRUE                            -- Community 공개
    OR link_share_scope IN ('authenticated', 'public')  -- 링크 공유 (외부)
    OR (
      link_share_scope = 'organization'
      AND image_visible_via_org(id, auth.uid())    -- 조직 링크 공유
    )
    OR image_visible_via_org(id, auth.uid())      -- 조직 라이브러리 공유
  );
```

**성능 주의**: `image_visible_via_org` 는 두 번 사용됨. Postgres 는 STABLE 함수를 캐싱하지만, 매 이미지마다 서브쿼리 실행. 이미지 목록 API 는 N+1 위험 → JOIN 으로 우회 필요 (§5.2 참조).

### 4.3 `organizations` RLS

```sql
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- 소속 멤버 or 소유자만 조직 정보 조회
CREATE POLICY orgs_select ON public.organizations
  FOR SELECT USING (
    deleted_at IS NULL
    AND (
      auth.uid() = owner_id
      OR is_org_member(id, auth.uid())
    )
  );

-- 조직 생성은 로그인 회원 누구나 (owner 는 본인)
CREATE POLICY orgs_insert ON public.organizations
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

-- owner 만 수정
CREATE POLICY orgs_update ON public.organizations
  FOR UPDATE USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- owner 만 soft delete (DELETE 는 실제로 UPDATE deleted_at 로 처리, hard delete 는 배치가)
CREATE POLICY orgs_delete ON public.organizations
  FOR DELETE USING (auth.uid() = owner_id);
```

### 4.4 `organization_members` RLS

```sql
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- 조직 내부 사람만 멤버 목록 조회
CREATE POLICY members_select ON public.organization_members
  FOR SELECT USING (
    is_org_member(organization_id, auth.uid())
  );

-- 초대 수락 시에만 INSERT (본인만) — 실제로는 서비스 로직에서 처리, RLS 는 보조
CREATE POLICY members_insert_self ON public.organization_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- admin+ 만 UPDATE (역할 변경, status 변경)
CREATE POLICY members_update_admin ON public.organization_members
  FOR UPDATE USING (
    org_role(organization_id, auth.uid()) IN ('owner', 'admin')
  );

-- admin+ 또는 본인 (탈퇴) 만 DELETE
CREATE POLICY members_delete ON public.organization_members
  FOR DELETE USING (
    org_role(organization_id, auth.uid()) IN ('owner', 'admin')
    OR auth.uid() = user_id
  );
```

### 4.5 `image_organization_shares` RLS

```sql
ALTER TABLE public.image_organization_shares ENABLE ROW LEVEL SECURITY;

-- 조직 멤버만 조직 라이브러리 목록 SELECT (이미지 자체는 images RLS 로도 커버)
CREATE POLICY ios_select ON public.image_organization_shares
  FOR SELECT USING (
    is_org_member(organization_id, auth.uid())
  );

-- editor+ 만 자기 이미지를 조직에 공유 (INSERT)
CREATE POLICY ios_insert ON public.image_organization_shares
  FOR INSERT WITH CHECK (
    org_role(organization_id, auth.uid()) IN ('owner', 'admin', 'editor')
    AND shared_by_user_id = auth.uid()
    AND EXISTS(
      SELECT 1 FROM public.images
      WHERE id = image_id AND user_id = auth.uid()
    )
  );

-- 강등 (조직 공유 취소): 이미지 소유자 or admin+
CREATE POLICY ios_delete ON public.image_organization_shares
  FOR DELETE USING (
    EXISTS(SELECT 1 FROM public.images WHERE id = image_id AND user_id = auth.uid())
    OR org_role(organization_id, auth.uid()) IN ('owner', 'admin')
  );
```

### 4.6 `images` UPDATE 추가 규칙

기존: `auth.uid() = user_id` — 소유자만.

**Community 승격 확장**: 이미지가 조직에 공유되어 있다면 조직 admin+ 도 `is_public` 을 TRUE 로 바꿀 수 있어야 함 (결정 7, Option B).

```sql
DROP POLICY IF EXISTS images_update_own ON public.images;

CREATE POLICY images_update ON public.images
  FOR UPDATE USING (
    auth.uid() = user_id
    OR EXISTS(
      SELECT 1 FROM public.image_organization_shares ios
      JOIN public.organization_members om
        ON om.organization_id = ios.organization_id
      WHERE ios.image_id = images.id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );
```

**주의**: WITH CHECK 는 policy 상 유지되지만, 어떤 필드가 수정 가능한지는 API 에서 좁혀야 함. Admin 이 소유자 필드나 프롬프트 등을 변경할 수 없게.

---

## 5. API Surface (v1.0)

### 5.1 Organization CRUD

| Method | Path | Role Required | 설명 |
|---|---|---|---|
| GET | `/api/organizations` | authenticated | 내가 속한 조직 목록 |
| POST | `/api/organizations` | authenticated | 조직 생성 (요청자가 owner) |
| GET | `/api/organizations/[slug]` | member+ | 조직 정보 |
| PATCH | `/api/organizations/[slug]` | admin+ | 조직 정보 수정 |
| DELETE | `/api/organizations/[slug]` | owner | soft delete (`deleted_at` 세팅) |

### 5.2 Organization Library (이미지 목록)

| Method | Path | Role Required | 설명 |
|---|---|---|---|
| GET | `/api/organizations/[slug]/images` | member+ | 조직 라이브러리 (JOIN with image_organization_shares) |
| POST | `/api/organizations/[slug]/images` | editor+ | 자기 이미지를 조직에 공유 (body: `{imageId}`) |
| DELETE | `/api/organizations/[slug]/images/[imageId]` | editor+ (본인 것) / admin+ (전체) | 조직 공유 취소 |

**쿼리 예 (조직 라이브러리)**:
```sql
SELECT i.* FROM images i
JOIN image_organization_shares ios ON ios.image_id = i.id
WHERE ios.organization_id = $1
ORDER BY ios.shared_at DESC
LIMIT $2 OFFSET $3;
```
JOIN 방식이므로 §4.2 의 N+1 문제 없음.

### 5.3 Members & Invites

| Method | Path | Role Required | 설명 |
|---|---|---|---|
| GET | `/api/organizations/[slug]/members` | member+ | 멤버 목록 |
| PATCH | `/api/organizations/[slug]/members/[userId]` | admin+ | 역할·status 변경 |
| DELETE | `/api/organizations/[slug]/members/[userId]` | admin+ / self | 강퇴/탈퇴 |
| GET | `/api/organizations/[slug]/invites` | admin+ | pending 초대 목록 |
| POST | `/api/organizations/[slug]/invites` | admin+ | 초대 발송 (body: `{email, role}`) |
| DELETE | `/api/organizations/[slug]/invites/[id]` | admin+ | 초대 취소 |
| POST | `/api/invites/[token]/accept` | authenticated | 초대 수락 (인증된 email 이 초대 email 과 일치해야) |

### 5.4 기존 API 확장

- `PATCH /api/images/[id]` — `linkShareScope` 필드 추가 (결정 13). 기존 `isShareable` 은 하위 호환용 별칭으로 v1.1 까지 유지
- `POST /api/images/download-zip` — `scope` 에 `organization:{orgId}` 추가 (Zod). 서버는 `image_organization_shares` JOIN 으로 검증

---

## 6. Frontend (v1.0)

### 6.1 새 페이지
- `/organizations` — 내가 속한 조직 목록 + 신규 조직 생성 버튼
- `/organizations/new` — 조직 생성 폼
- `/organization/[slug]` — 조직 홈 (개요 + 멤버 수 + 최근 이미지)
- `/organization/[slug]/library` — 조직 라이브러리 (P2 다중 선택 + ZIP 재사용, scope=`organization:{orgId}`)
- `/organization/[slug]/members` — 멤버 관리 (admin+)
- `/organization/[slug]/settings` — 조직 정보·정책 (owner)
- `/invites/[token]` — 초대 수락 페이지

### 6.2 기존 페이지 확장
- `AppSidebar` — "조직" 섹션 추가 (내 조직 목록)
- `ImageDetailView` — "조직에 공유" 액션 (소유자만, editor+ 역할 필요), 조직 공유 뱃지 표시
- `LibraryCard` — 조직 공유 상태 배지 (예: "🏫 우리학교 공유")
- `MultiSelectActionBar` — 조직 페이지에서는 "조직에서 제거" 액션 추가

### 6.3 P2 인프라 재사용
- `selectionStore` 는 이미 `organization:{orgId}` scope 지원
- `MultiSelectActionBar` 는 이미 액션 주입형 → 각 페이지가 필요한 액션만 전달

---

## 7. Non-Goals (v1.0)

- 조직 소유 이미지 (개인 소유 유지)
- 여러 조직 동시 UI (스키마는 지원, UI 는 v2)
- 조직별 결제·크레딧 풀
- SSO / SAML
- 조직 간 이미지 공유
- 조직 내 서브그룹
- 감사 로그 UI

## 8. Deferred (설계 리뷰에서 확답 필요)

1. `link_share_scope` migration 시점 — 기존 `is_shareable` 유지 vs 즉시 drop
2. 조직 slug 예약어 (`admin`, `new`, `settings` 등) 목록
3. 초대 만료 기본값 — 7일 vs 14일
4. 조직 삭제 유예 기간 — 30일 vs 60일
5. viewer 역할이 이미지 다운로드까지 허용해야 하나? (§4 매트릭스 재검토)
6. 이미지 소유자 vs 조직 admin 사이 정책 충돌 시 우선순위 명문화

## 9. Migration Order (SQL 단계)

1. `types` — organization_role, link_share_scope enum 신설
2. `organizations` 테이블 + 인덱스
3. `organization_members` 테이블 + 인덱스
4. `organization_invites` 테이블 + partial unique index
5. `image_organization_shares` 테이블 + 인덱스
6. Helper functions (`is_org_member`, `org_role`, `image_visible_via_org`)
7. `images.link_share_scope` 컬럼 추가 + 기존 `is_shareable=TRUE` 마이그레이션
8. `images` SELECT RLS 재작성
9. `images` UPDATE RLS 재작성 (조직 admin 승격 지원)
10. `organizations`, `organization_members`, `image_organization_shares` RLS 정책

**단일 migration 파일**: `supabase/migrations/033_organizations.sql`.

## 10. Testing Strategy

- **RLS 테스트 (Vitest + Supabase local)**: 각 역할별 SELECT/INSERT/UPDATE/DELETE 시나리오
- **E2E (Playwright)**: 조직 생성 → 초대 → 수락 → 이미지 조직 공유 → 다른 멤버가 조회 → 조직 admin 이 Community 승격
- **부하 테스트**: RLS 함수의 N+1 성능 (특히 이미지 목록 API), 100 조직 × 1000 이미지 × 10 멤버 데이터셋

---

## Appendix A. 결정 요약 (PRD 결정 항목 → Design 반영)

| PRD 결정 | Design 반영 |
|---|---|
| 1. organizations 필드 | §3.1 (B) 중간 채택 |
| 2. members 스키마 | §3.2 (C) status 포함 |
| 3. invites 방식 | §3.3 (A) 이메일 기반 |
| 4. 역할 매트릭스 | §5 API 각 role 컬럼 |
| 5. 개인 소유 원칙 | §3.4 (연결 테이블만, 소유 이전 없음) |
| 6. 공유 방식 | §3.4 image_organization_shares |
| 7. Community 승격 권한 | §4.6 (owner + org admin) |
| 8. 탈퇴 시 처리 | CASCADE (image_organization_shares) |
| 9. 조직 삭제 | §3.1 deleted_at soft delete |
| 10. 여러 조직 동시 | 스키마 지원, v1.0 UI 는 단일 |
| 11. 컬럼 vs 테이블 | 연결 테이블 |
| 12. RLS 정책 | §4 상세 |
| 13. is_shareable 확장 | §3.5 link_share_scope enum |
