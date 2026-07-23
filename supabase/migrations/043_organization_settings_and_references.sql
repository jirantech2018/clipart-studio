-- Migration: 043_organization_settings_and_references
--
-- P5-D-A: 조직 학교 AI 생성 설정 + 조직용 참조 이미지 슬롯 스키마.
--
-- 정책 (사용자 결정):
--   - Q2 (a) school_profiles 병존. 개인 컨텍스트는 기존 school_profiles 를
--     그대로 소비. 이번 마이그레이션은 그 테이블을 건드리지 않는다.
--   - 조직 컨텍스트 (P5-D-B/C 에서 UI · 파이프라인 재배선 예정) 는 여기
--     신설되는 두 테이블을 통해서만 학교 스타일과 참조 이미지를 소비한다.
--   - Q3 (b) /generate?org=[slug] 로 컨텍스트 분기. 스키마 관점에서는 조직
--     설정 저장소만 있으면 됨.
--
-- 이 마이그레이션이 만드는 것:
--   1) organization_school_settings — 조직당 1:0..1. owner 만 편집.
--        조직 컨텍스트 생성 시 소비.
--   2) organization_reference_images — 조직당 최대 5개. owner 만 등록/삭제.
--        멤버는 조회 및 생성 시 사용 가능.
--   3) RLS + GRANT + updated_at 트리거 + reference limit 트리거.
--
-- 안전성:
--   - 두 테이블 모두 organizations FK ON DELETE CASCADE. 조직 삭제 시
--     설정과 참조 이미지 관계가 자동 정리된다 (R2 실제 파일 정리는 별도
--     배치 필요 — P5-D-B 에서 검토).
--   - reference_images (개인) 는 그대로 유지 — 오직 새 테이블만 생성.

-- ================================================================
-- 1. organization_school_settings
-- ================================================================
--
-- school_profiles 와 필드 구성이 유사하지만 organization_id 를 기준으로
-- 하며, owner 가 관리한다. school_profiles.homepage_url 은 학교 홈페이지
-- 이므로 조직 홈페이지 (organizations.homepage_url) 와 별개로 관리.

CREATE TABLE IF NOT EXISTS public.organization_school_settings (
  organization_id UUID PRIMARY KEY
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  school_name TEXT NOT NULL,
  homepage_url TEXT,
  school_level school_level_enum,
  mascot_desc TEXT,
  mascot_ref_url TEXT,
  building_ref_url TEXT,
  style_desc TEXT,
  base_prompt TEXT,
  style_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.touch_org_school_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_school_settings_updated_at
  ON public.organization_school_settings;

CREATE TRIGGER org_school_settings_updated_at
  BEFORE UPDATE ON public.organization_school_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_org_school_settings_updated_at();

-- ================================================================
-- 2. organization_reference_images
-- ================================================================

CREATE TABLE IF NOT EXISTS public.organization_reference_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  filename TEXT,
  width INT NOT NULL,
  height INT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_reference_images_org
  ON public.organization_reference_images (organization_id, sort_order, created_at);

-- 조직당 5개 제한 트리거 — reference_images (개인) 규칙과 동일.
CREATE OR REPLACE FUNCTION public.enforce_org_reference_image_limit()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM public.organization_reference_images
    WHERE organization_id = NEW.organization_id
  ) >= 5 THEN
    RAISE EXCEPTION 'org_reference_image_limit_reached' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_org_reference_image_limit
  ON public.organization_reference_images;

CREATE TRIGGER trg_enforce_org_reference_image_limit
  BEFORE INSERT ON public.organization_reference_images
  FOR EACH ROW EXECUTE FUNCTION public.enforce_org_reference_image_limit();

-- ================================================================
-- 3. RLS
-- ================================================================
--
-- organization_school_settings:
--   SELECT: 조직 active 멤버 (설정 조회 · 생성 시 소비를 위해)
--   INSERT/UPDATE/DELETE: 조직 owner
--
-- organization_reference_images:
--   SELECT: 조직 active 멤버
--   INSERT/DELETE: 조직 owner
--   UPDATE: 조직 owner (정렬 등)

ALTER TABLE public.organization_school_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_school_settings_select ON public.organization_school_settings;
CREATE POLICY org_school_settings_select ON public.organization_school_settings
  FOR SELECT USING (
    is_org_member(organization_id, auth.uid())
  );

DROP POLICY IF EXISTS org_school_settings_insert_owner ON public.organization_school_settings;
CREATE POLICY org_school_settings_insert_owner ON public.organization_school_settings
  FOR INSERT WITH CHECK (
    org_role(organization_id, auth.uid()) = 'owner'
  );

DROP POLICY IF EXISTS org_school_settings_update_owner ON public.organization_school_settings;
CREATE POLICY org_school_settings_update_owner ON public.organization_school_settings
  FOR UPDATE USING (
    org_role(organization_id, auth.uid()) = 'owner'
  );

DROP POLICY IF EXISTS org_school_settings_delete_owner ON public.organization_school_settings;
CREATE POLICY org_school_settings_delete_owner ON public.organization_school_settings
  FOR DELETE USING (
    org_role(organization_id, auth.uid()) = 'owner'
  );

ALTER TABLE public.organization_reference_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_reference_images_select ON public.organization_reference_images;
CREATE POLICY org_reference_images_select ON public.organization_reference_images
  FOR SELECT USING (
    is_org_member(organization_id, auth.uid())
  );

DROP POLICY IF EXISTS org_reference_images_insert_owner ON public.organization_reference_images;
CREATE POLICY org_reference_images_insert_owner ON public.organization_reference_images
  FOR INSERT WITH CHECK (
    org_role(organization_id, auth.uid()) = 'owner'
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS org_reference_images_update_owner ON public.organization_reference_images;
CREATE POLICY org_reference_images_update_owner ON public.organization_reference_images
  FOR UPDATE USING (
    org_role(organization_id, auth.uid()) = 'owner'
  );

DROP POLICY IF EXISTS org_reference_images_delete_owner ON public.organization_reference_images;
CREATE POLICY org_reference_images_delete_owner ON public.organization_reference_images
  FOR DELETE USING (
    org_role(organization_id, auth.uid()) = 'owner'
  );

-- ================================================================
-- 4. GRANTs
-- ================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_school_settings TO authenticated;
GRANT ALL ON public.organization_school_settings TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_reference_images TO authenticated;
GRANT ALL ON public.organization_reference_images TO service_role;
