-- Migration: 033_organizations_expand
-- Design Ref: docs/02-design/features/organization.design.md v0.3
-- PRD Ref:    docs/00-pm/organization.prd.md v0.3
--
-- Deployment strategy: Expand → Migrate → Contract (zero-downtime)
--   * This file is the EXPAND phase — only additive changes.
--     기존 컬럼(images.is_public, images.is_shareable) 과 기존 정책은
--     그대로 유지하므로, 이 SQL 을 실행해도 지금 배포된 앱은 아무 변경
--     없이 정상 동작한다.
--   * MIGRATE phase: 앱 코드가 새 컬럼(visibility, is_on_community) 만
--     쓰도록 재작성 & 배포.
--   * CONTRACT phase: 새 앱이 안정화된 뒤 034_organizations_contract.sql
--     을 실행해서 옛 컬럼/정책을 완전히 제거.

-- ================================================================
-- 1. Enums
-- ================================================================

CREATE TYPE organization_role AS ENUM ('owner', 'admin', 'editor', 'viewer');

CREATE TYPE image_visibility AS ENUM (
  'private',
  'organization',
  'authenticated',
  'public'
);

CREATE TYPE org_activity_type AS ENUM (
  'organization_created',
  'organization_updated',
  'member_invited',
  'member_joined',
  'member_removed',
  'member_role_changed',
  'invite_revoked',
  'image_shared',
  'image_unshared',
  'image_visibility_changed'
);

-- ================================================================
-- 2. organizations
-- ================================================================

CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  homepage_url TEXT,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  max_visibility image_visibility NOT NULL DEFAULT 'public',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT organizations_slug_format
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  CONSTRAINT organizations_name_length
    CHECK (char_length(name) BETWEEN 1 AND 100),
  CONSTRAINT organizations_slug_not_reserved
    CHECK (slug NOT IN (
      'admin', 'api', 'auth', 'login', 'logout', 'signup',
      'settings', 'organization', 'organizations', 'library',
      'community', 'profile', 'account', 'help', 'support',
      'new', 'edit', 'invite', 'invites',
      'image', 'images', 'generate', 'onboarding', 'search',
      'callback', 'knowledge', 'dashboard',
      '_next', '_static', '_vercel',
      'sitemap', 'robots', 'favicon', 'manifest',
      'www', 'mail', 'ftp', 'ns1', 'ns2',
      'null', 'undefined'
    ))
);

CREATE INDEX idx_organizations_owner
  ON public.organizations(owner_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_organizations_slug
  ON public.organizations(slug)
  WHERE deleted_at IS NULL;

-- ================================================================
-- 3. organization_members
-- ================================================================

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

-- ================================================================
-- 4. organization_invites
-- ================================================================

CREATE TABLE public.organization_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role organization_role NOT NULL,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  token TEXT NOT NULL UNIQUE,
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

CREATE UNIQUE INDEX idx_organization_invites_unique_pending
  ON public.organization_invites(organization_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- ================================================================
-- 5. image_organization_shares
-- ================================================================

CREATE TABLE public.image_organization_shares (
  image_id UUID NOT NULL REFERENCES public.images(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shared_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  shared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (image_id, organization_id)
);

CREATE INDEX idx_ios_organization
  ON public.image_organization_shares(organization_id, shared_at DESC);

CREATE INDEX idx_ios_image
  ON public.image_organization_shares(image_id);

-- ================================================================
-- 6. organization_activity_logs
-- ================================================================

CREATE TABLE public.organization_activity_logs (
  id BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  activity_type org_activity_type NOT NULL,
  target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  target_image_id UUID REFERENCES public.images(id) ON DELETE SET NULL,
  target_invite_id UUID REFERENCES public.organization_invites(id) ON DELETE SET NULL,
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

-- ================================================================
-- 7. Helper functions (RLS 서브쿼리 캐시용, SECURITY DEFINER STABLE)
-- ================================================================

CREATE OR REPLACE FUNCTION public.is_org_member(org_id UUID, uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.organization_members
    WHERE organization_id = org_id
      AND user_id = uid
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.org_role(org_id UUID, uid UUID)
RETURNS organization_role
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM public.organization_members
  WHERE organization_id = org_id
    AND user_id = uid
    AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.image_visible_via_org(img_id UUID, uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.image_organization_shares ios
    JOIN public.organization_members om
      ON om.organization_id = ios.organization_id
    WHERE ios.image_id = img_id
      AND om.user_id = uid
      AND om.status = 'active'
  );
$$;

-- ================================================================
-- 8. images 확장 — 새 컬럼만 추가 (기존 is_public / is_shareable 은 유지!)
-- ================================================================

ALTER TABLE public.images
  ADD COLUMN visibility image_visibility NOT NULL DEFAULT 'private',
  ADD COLUMN is_on_community BOOLEAN NOT NULL DEFAULT FALSE;

-- 기존 데이터 백필: is_public / is_shareable → visibility / is_on_community
UPDATE public.images
   SET visibility = 'public', is_on_community = TRUE
 WHERE is_public = TRUE;

UPDATE public.images
   SET visibility = 'authenticated'
 WHERE is_public = FALSE AND is_shareable = TRUE;

-- Community 노출 정합성 강제 (visibility >= authenticated 일 때만 TRUE 허용)
ALTER TABLE public.images
  ADD CONSTRAINT images_community_requires_public_or_auth
  CHECK (
    is_on_community = FALSE
    OR visibility IN ('authenticated', 'public')
  );

-- ================================================================
-- 9. 부분 인덱스 (신규)
-- ================================================================

CREATE INDEX idx_images_on_community
  ON public.images(created_at DESC)
  WHERE is_on_community = TRUE;

CREATE INDEX idx_images_visibility
  ON public.images(visibility);

-- ================================================================
-- 10. 새 SELECT / UPDATE RLS — 기존 정책과 공존 (RLS 는 여러 정책 OR 로 평가)
--     같은 사용자에 대해 옛/새 정책 중 하나라도 허용하면 접근 가능.
--     백필로 두 시스템이 동일한 접근 권한을 표현하므로 실질적 차이 없음.
-- ================================================================

CREATE POLICY images_select_v4 ON public.images
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR visibility IN ('authenticated', 'public')
    OR (
      visibility = 'organization'
      AND image_visible_via_org(id, auth.uid())
    )
  );

CREATE POLICY images_update_v2 ON public.images
  FOR UPDATE
  USING (
    auth.uid() = user_id
    OR EXISTS(
      SELECT 1
      FROM public.image_organization_shares ios
      JOIN public.organization_members om
        ON om.organization_id = ios.organization_id
      WHERE ios.image_id = images.id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.status = 'active'
    )
  );

-- image_tags / image_categories 도 visibility 조건 추가 정책 (기존 정책과 공존)
CREATE POLICY tags_select_v2 ON public.image_tags
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.images
       WHERE images.id = image_tags.image_id
         AND (
           images.user_id = auth.uid()
           OR images.visibility IN ('authenticated', 'public')
           OR (
             images.visibility = 'organization'
             AND image_visible_via_org(images.id, auth.uid())
           )
         )
    )
  );

CREATE POLICY categories_select_v2 ON public.image_categories
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.images
       WHERE images.id = image_categories.image_id
         AND (
           images.user_id = auth.uid()
           OR images.visibility IN ('authenticated', 'public')
           OR (
             images.visibility = 'organization'
             AND image_visible_via_org(images.id, auth.uid())
           )
         )
    )
  );

-- ================================================================
-- 11. organizations RLS
-- ================================================================

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY orgs_select ON public.organizations
  FOR SELECT USING (
    deleted_at IS NULL
    AND (
      auth.uid() = owner_id
      OR is_org_member(id, auth.uid())
    )
  );

CREATE POLICY orgs_insert ON public.organizations
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY orgs_update ON public.organizations
  FOR UPDATE
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY orgs_delete ON public.organizations
  FOR DELETE USING (auth.uid() = owner_id);

-- ================================================================
-- 12. organization_members RLS
-- ================================================================

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY members_select ON public.organization_members
  FOR SELECT USING (
    is_org_member(organization_id, auth.uid())
  );

CREATE POLICY members_insert_self ON public.organization_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY members_update_admin ON public.organization_members
  FOR UPDATE USING (
    org_role(organization_id, auth.uid()) IN ('owner', 'admin')
  );

CREATE POLICY members_delete ON public.organization_members
  FOR DELETE USING (
    org_role(organization_id, auth.uid()) IN ('owner', 'admin')
    OR auth.uid() = user_id
  );

-- ================================================================
-- 13. organization_invites RLS
-- ================================================================

ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY invites_select_admin ON public.organization_invites
  FOR SELECT USING (
    org_role(organization_id, auth.uid()) IN ('owner', 'admin')
  );

CREATE POLICY invites_insert_admin ON public.organization_invites
  FOR INSERT WITH CHECK (
    org_role(organization_id, auth.uid()) IN ('owner', 'admin')
    AND invited_by = auth.uid()
  );

CREATE POLICY invites_update_admin ON public.organization_invites
  FOR UPDATE USING (
    org_role(organization_id, auth.uid()) IN ('owner', 'admin')
  );

CREATE POLICY invites_delete_admin ON public.organization_invites
  FOR DELETE USING (
    org_role(organization_id, auth.uid()) IN ('owner', 'admin')
  );

-- ================================================================
-- 14. image_organization_shares RLS
-- ================================================================

ALTER TABLE public.image_organization_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY ios_select ON public.image_organization_shares
  FOR SELECT USING (
    is_org_member(organization_id, auth.uid())
  );

CREATE POLICY ios_insert_editor ON public.image_organization_shares
  FOR INSERT WITH CHECK (
    org_role(organization_id, auth.uid()) IN ('owner', 'admin', 'editor')
    AND shared_by_user_id = auth.uid()
    AND EXISTS(
      SELECT 1 FROM public.images
      WHERE id = image_id AND user_id = auth.uid()
    )
  );

CREATE POLICY ios_delete ON public.image_organization_shares
  FOR DELETE USING (
    EXISTS(SELECT 1 FROM public.images WHERE id = image_id AND user_id = auth.uid())
    OR org_role(organization_id, auth.uid()) IN ('owner', 'admin')
  );

-- ================================================================
-- 15. organization_activity_logs RLS
-- ================================================================

ALTER TABLE public.organization_activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY activity_logs_select_admin ON public.organization_activity_logs
  FOR SELECT USING (
    org_role(organization_id, auth.uid()) IN ('owner', 'admin')
  );

-- ================================================================
-- 16. GRANTS
-- ================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_invites TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.image_organization_shares TO authenticated;
GRANT SELECT ON public.organization_activity_logs TO authenticated;

GRANT INSERT ON public.organization_activity_logs TO service_role;

GRANT USAGE, SELECT ON SEQUENCE public.organization_activity_logs_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.organization_activity_logs_id_seq TO service_role;

-- ================================================================
-- 17. updated_at 트리거 (organizations)
-- ================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_set_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
