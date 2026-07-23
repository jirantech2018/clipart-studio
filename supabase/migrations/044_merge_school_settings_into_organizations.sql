-- Migration: 044_merge_school_settings_into_organizations
--
-- 배경:
--   P5-D-A/B 초기 설계에서 organization_school_settings 를 별도 테이블로
--   신설했지만, 실제 요구는 "학교 AI 생성 설정이 곧 조직 기본 정보" 였다.
--     - 학교명       = organizations.name
--     - 학교 홈페이지 = organizations.homepage_url
--   두 개 필드가 중복 관리되는 문제가 있어 통합한다.
--
-- 이 마이그레이션이 하는 일:
--   1) organizations 에 학교 AI 생성 관련 3개 컬럼 추가
--        - school_level  (schoolLevel enum, nullable)
--        - base_prompt   (text, nullable)
--        - style_enabled (boolean, default true)
--   2) organization_school_settings 테이블 DROP (관련 트리거·RLS·GRANT 함께)
--
-- 안전성:
--   - 043 배포 후 조직이 없는 상태에서 진행되므로 organization_school_settings
--     에 담긴 데이터는 없다. DROP 이 안전.
--   - style_enabled 기본값 TRUE — 기존 조직들도 저장 없이 곧바로 유효한 상태.

-- ================================================================
-- 1. organizations 컬럼 추가
-- ================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS school_level school_level_enum,
  ADD COLUMN IF NOT EXISTS base_prompt TEXT,
  ADD COLUMN IF NOT EXISTS style_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- ================================================================
-- 2. organization_school_settings 정리
-- ================================================================

DROP TRIGGER IF EXISTS org_school_settings_updated_at
  ON public.organization_school_settings;

DROP FUNCTION IF EXISTS public.touch_org_school_settings_updated_at();

DROP TABLE IF EXISTS public.organization_school_settings;
