# Organization — Design v0.2

> **Summary**: SaaS 형 조직 계층 도입. 계정(auth.users) 위에 organizations 를 얹고, images 는 개인 소유 원칙을 유지한 채 `image_organization_shares` 연결 테이블로 조직 라이브러리에 노출. 기존 `is_public` + `is_shareable` 두 boolean 을 단일 `visibility` enum (`private/organization/authenticated/public`) 으로 통합. 모든 접근 제어는 RLS 강제. 조직 활동 로그 v1.0 포함.
>
> **Version**: 0.2.0
> **Author**: sbtmxk20
> **Date**: 2026-07-16
> **Status**: Reviewed — PRD v0.2 결정사항 반영
> **PRD**: [organization.prd.md v0.2](../../00-pm/organization.prd.md)

## Changelog

- **v0.2** — PRD v0.2 리뷰 반영: (1) visibility enum 도입 & is_public/is_shareable 완전 제거, (2) organization_activity_logs 테이블 신설, (3) SELECT/UPDATE RLS 재작성, (4) migration 순서 갱신
- **v0.1** — 최초 draft. 개별 옵션 제시

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

### 3.5 `images.visibility` — 통합 공개 범위 (v0.2 재확정)

**PRD v0.2 결정 13** 에 따라 기존 `is_public` + `is_shareable` 두 boolean 을 **단일 `visibility` enum 으로 완전 통합**. 두 컬럼은 마이그레이션 후 같은 SQL 파일에서 DROP 한다 (v1.1 유예 없음).

```sql
CREATE TYPE image_visibility AS ENUM (
  'private',        -- 소유자만 접근
  'organization',   -- 소유자 + image_organization_shares 로 공유받은 조직의 active 멤버
  'authenticated',  -- 로그인한 모든 회원 접근 (링크만 알면)
  'public'          -- 로그인한 모든 회원 접근 + /community 에 노출됨
);

ALTER TABLE public.images
  ADD COLUMN visibility image_visibility NOT NULL DEFAULT 'private';

-- 마이그레이션: is_public 이 우선순위 높음
UPDATE public.images SET visibility = 'public'         WHERE is_public = TRUE;
UPDATE public.images SET visibility = 'authenticated'  WHERE is_public = FALSE AND is_shareable = TRUE;
-- 나머지는 DEFAULT 'private' 유지

-- 기존 컬럼 및 관련 정책 완전 제거
DROP POLICY IF EXISTS images_select_v3 ON public.images;
ALTER TABLE public.images DROP COLUMN is_public;
ALTER TABLE public.images DROP COLUMN is_shareable;

-- 조회 성능용 부분 인덱스 (Community 필터가 가장 잦음)
CREATE INDEX idx_images_visibility_public
  ON public.images(created_at DESC)
  WHERE visibility = 'public';
```

**enum 값 의미표**

| 값 | 접근 가능 | Community 페이지 노출 | 대체된 기존 상태 |
|---|---|:-:|---|
| `private` | 소유자만 | ✗ | `is_public=F, is_shareable=F` |
| `organization` | 소유자 + 이 이미지가 공유된 조직의 active 멤버 | ✗ | (신설) |
| `authenticated` | 로그인 회원 누구나 (링크만 알면) | ✗ | `is_shareable=T` |
| `public` | 로그인 회원 누구나 + Community 노출 | ✓ | `is_public=T` |

**정책적 의미**
- 승격 흐름 `private → organization → authenticated → public` 이 자연스러운 부분 순서
- Community 페이지 필터가 `WHERE visibility = 'public'` 로 단순화됨 (기존 `is_public=TRUE` 대체)
- 링크 공유는 `visibility >= 'authenticated'` — DB 에서 enum 은 순서가 있으므로 `visibility IN ('authenticated','public')` 로 필터
- 비회원 접근은 v1.0 out. v2 에서 별도 flag 나 새 enum 값(`'anonymous'`)으로 확장 가능

**조직 상한 검증**: `organizations.max_visibility` — 조직 admin 이 "우리 조직 이미지는 authenticated 이상 못 나가게" 설정하면, 그 조직에 공유된 이미지의 visibility 는 그 상한을 초과할 수 없음. API 에서 검증하고, DB trigger 로 이중 방어.

### 3.6 `organization_activity_logs` (v0.2 신규)

**PRD v0.2 §6 Scope In** 에 추가된 조직 활동 로그. 조직 관리 페이지에서 admin+ 가 조회.

```sql
CREATE TYPE org_activity_type AS ENUM (
  'organization_created',
  'organization_updated',
  'member_invited',
  'member_joined',
  'member_removed',
  'member_role_changed',
  'invite_revoked',
  'image_shared',              -- 개인 이미지가 조직에 공유됨
  'image_unshared',            -- 조직 공유 취소
  'image_visibility_changed'   -- Community 승격/강등 포함
);

CREATE TABLE public.organization_activity_logs (
  id BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  activity_type org_activity_type NOT NULL,
  -- 대상 (필요한 것만 채움)
  target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  target_image_id UUID REFERENCES public.images(id) ON DELETE SET NULL,
  target_invite_id UUID REFERENCES public.organization_invites(id) ON DELETE SET NULL,
  -- 상세 (예: role 변경 전후, visibility 변경 전후)
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_org_activity_org_time
  ON public.organization_activity_logs(organization_id, created_at DESC);
CREATE INDEX idx_org_activity_actor
  ON public.organization_activity_logs(actor_user_id, created_at DESC);
CREATE INDEX idx_org_activity_target_image
  ON public.organization_activity_logs(target_image_id)
  WHERE target_image_id IS NOT NULL;
```

**설계 노트**
- `BIGSERIAL` — 활동 로그는 매우 많아지므로 UUID 보다 부담 적은 정수 PK
- `metadata JSONB` — 유연한 상세 (예: `{"from_role":"editor","to_role":"admin"}`, `{"from":"organization","to":"public"}`)
- CASCADE 는 organization 삭제 시만. actor/target 삭제 시엔 NULL 로 유지 (감사 무결성)
- 정렬은 (organization_id, created_at DESC) 인덱스로 조직별 최신 순 조회 O(log n)

**로그 기록 규칙**
- API 라우트에서 성공적으로 처리 후 서버 사이드에서 insert (service role)
- 실패한 액션은 기록하지 않음 (403/400 시 스킵)
- 크레딧 소비 없음

### 3.7 Migration Strategy

- 신규 테이블 4개 (`organizations`, `organization_members`, `organization_invites`, `image_organization_shares`) + 활동 로그 1개
- **파괴적 변경**: `images.is_public`, `images.is_shareable` DROP → `visibility` enum 도입
- **RLS 재작성**: 기존 `images_select_v3` (P1 확장분) 를 폐기하고 v0.2 정책으로 대체
- 기존 이미지는 자동으로 조직에 소속되지 않음 (모두 개인 소유 유지)
- Backfill 없음 — 사용자가 명시적으로 조직 생성 + 이미지 공유
- 단일 migration 파일 `033_organizations.sql` 로 배포 (사용자가 Supabase SQL Editor 에서 한 번에 실행 가능한 규모 유지)

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

### 4.2 `images` SELECT RLS — v0.2 재작성

기존 `images_select_own_public_or_shareable` (v1 → v3 확장분) 을 모두 폐기하고, `visibility` enum 기준의 단일 정책으로 통합:

```sql
DROP POLICY IF EXISTS images_select_own_public_or_shareable ON public.images;
DROP POLICY IF EXISTS images_select_v3 ON public.images;

CREATE POLICY images_select_v4 ON public.images
  FOR SELECT USING (
    auth.uid() = user_id                                        -- 소유자
    OR visibility IN ('authenticated', 'public')                 -- 로그인 회원 누구나
    OR (
      visibility = 'organization'
      AND image_visible_via_org(id, auth.uid())                  -- 조직 멤버
    )
  );
```

**정책 노트**
- `visibility = 'private'` 이면 오직 소유자만 (auth.uid() = user_id 조건만 매치)
- `visibility = 'organization'` 이면 소유자 + 이 이미지가 공유된 조직의 active 멤버
- `visibility = 'authenticated'` 이면 로그인한 모든 회원
- `visibility = 'public'` 도 접근 조건은 authenticated 와 같음. 차이는 Community 페이지 노출 (application 레벨 필터)

**성능 노트**
- `image_visible_via_org` 는 STABLE 함수라 같은 트랜잭션 내 캐시 가능하지만, 이미지 목록 API 에서 매 row 서브쿼리는 N+1 위험
- 조직 라이브러리 API 는 `image_organization_shares` 를 JOIN 하는 방식으로 우회 (§5.2)
- Community 페이지는 `WHERE visibility='public'` 만 필터하므로 부분 인덱스(`idx_images_visibility_public`)로 상수 시간에 조회

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

**Community 승격 확장**: 이미지가 조직에 공유되어 있다면 조직 admin+ 도 `visibility` 를 상향(예: `organization` → `public`) 조정할 수 있어야 함 (결정 7, Option B).

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
        AND om.status = 'active'
    )
  );
```

**주의**: WITH CHECK 는 policy 상 유지되지만, 어떤 필드가 수정 가능한지는 API 에서 좁혀야 함. 조직 admin 은 오직 `visibility` 만 수정 가능하고, prompt/tags/user_id 등은 API 에서 거부.

### 4.7 `organization_activity_logs` RLS (v0.2 신규)

```sql
ALTER TABLE public.organization_activity_logs ENABLE ROW LEVEL SECURITY;

-- admin+ 만 활동 로그 조회
CREATE POLICY activity_logs_select_admin ON public.organization_activity_logs
  FOR SELECT USING (
    org_role(organization_id, auth.uid()) IN ('owner', 'admin')
  );

-- INSERT 는 service role 만 (API 라우트가 service client 로 기록)
-- 별도 policy 불필요 (authenticated 에게 GRANT INSERT 안 함)

GRANT SELECT ON public.organization_activity_logs TO authenticated;
GRANT INSERT ON public.organization_activity_logs TO service_role;
```

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

### 5.4 기존 API 확장 (v0.2)

- `PATCH /api/images/[id]` — `isPublic` + `isShareable` 필드 제거, **`visibility` 단일 필드** 로 대체 (`'private'|'organization'|'authenticated'|'public'`). 조직 admin 이 대리 승격 시 소유자에게 알림 트리거
- `POST /api/images/download-zip` — `scope` 에 `organization:{orgId}` 값 추가 (Zod). 서버는 `image_organization_shares` JOIN 으로 검증. 개수/용량 상한은 P2a 그대로 (50개 / 100MB)
- `GET /api/images` — 라이브러리 목록에 `visibility` 필드 노출. 필터 옵션 `visibility=public` (기존 `filter=public` 대체)
- `GET /api/community` — 내부 필터가 `visibility='public'` 로 변경 (기존 `is_public=TRUE` 대체)

### 5.5 활동 로그 API (v0.2 신규)

| Method | Path | Role Required | 설명 |
|---|---|---|---|
| GET | `/api/organizations/[slug]/activity` | admin+ | 조직 활동 로그 목록 (paginated). type 필터 지원 |

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

## 9. Migration Order (SQL 단계) — v0.2

단일 파일 `supabase/migrations/033_organizations.sql` 로 배포. 순서:

1. **Enums**: `organization_role`, `image_visibility`, `org_activity_type`
2. **Tables**: `organizations`, `organization_members`, `organization_invites`, `image_organization_shares`, `organization_activity_logs`
3. **Indexes**: 각 테이블별 (§3 참조)
4. **Helper functions**: `is_org_member`, `org_role`, `image_visible_via_org` (SECURITY DEFINER STABLE)
5. **`images.visibility` 컬럼 추가** (DEFAULT 'private')
6. **Backfill**: `is_public=TRUE → visibility='public'`, `is_shareable=TRUE → visibility='authenticated'`
7. **기존 RLS 폐기**: `images_select_own_public_or_shareable`, `images_select_v3` DROP
8. **`is_public`, `is_shareable` 컬럼 DROP**
9. **새 SELECT RLS**: `images_select_v4` (visibility 기준)
10. **새 UPDATE RLS**: `images_update` (소유자 + 조직 admin+)
11. **부분 인덱스**: `idx_images_visibility_public`
12. **RLS 정책**: organizations, organization_members, organization_invites, image_organization_shares, organization_activity_logs
13. **GRANTS**: 각 테이블별 authenticated / service_role 권한

**주의**: 6→8 사이에 데이터가 있는 상태로 DROP 하므로 순서 엄격히 준수.

**앱 코드 배포 조율**: SQL 실행 순간 기존 코드가 `is_public`/`is_shareable` 조회 시 컬럼 없음 에러. 배포 순서:
1. 앱 코드에 `visibility` 처리 로직 추가 (구 컬럼도 병행 처리)
2. SQL migration 실행
3. 구 컬럼 참조 코드 제거

이 조율을 위해 **v0.2 마이그레이션 실행은 구 로직을 완전히 대체한 앱 배포 후에 진행**.

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
| 13. 공개 범위 표현 | §3.5 **`visibility` enum 단일화** (is_public + is_shareable 완전 대체) |
| Scope 추가 (활동 로그) | §3.6 organization_activity_logs 신설 |
| KPI 갱신 | PRD §5 (초대 수락률 60%, 조직 활성화율 70%, 조직 이미지 공유율 40%, Community 승격율 15~20%) |
