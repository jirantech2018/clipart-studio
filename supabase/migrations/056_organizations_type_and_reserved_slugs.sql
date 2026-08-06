-- Migration: 056_organizations_type_and_reserved_slugs
-- Milestone: M1
-- Depends on: 001_profiles, 033_organizations_expand
-- Plan Ref: docs/01-plan/features/organization-token-management.plan.md v0.2.1 §6.1
--
-- 목적:
--   개인 워크스페이스도 organization row 로 존재시킨다. type enum 으로 personal /
--   school / general 을 구분하고, 개인은 유저당 정확히 1개만 허용한다.
--
-- 정책:
--   - `type='personal'` 은 초대 없는 1인 organization. UNIQUE partial index 로
--     유저당 1개만 존재 강제 (D-open-2 사용자 지시).
--   - 사용자 URL `/organization/my` 는 middleware alias. DB slug 는 hidden
--     (예: `personal-{user_id}`). 사용자 화면에는 절대 노출하지 않는다.
--   - `my` / `me` / `admin` / `api` / `organizations` / `organization` 는
--     일반 조직 slug 로 사용 금지 (URL alias · 예약 경로 충돌 방지).
--
-- 호환성:
--   - 기존 organizations 는 default 'general' 로 설정. school 은 이후 UI 로
--     승격 (별도 정책, 이번 마이그레이션 밖).
--   - type 컬럼은 NOT NULL DEFAULT 이므로 기존 row 자동 backfill.
--   - 예약 slug 를 이미 쓰는 조직이 있는지 사전 확인 필요. grep 결과 없음.

CREATE TYPE organization_type_enum AS ENUM (
  'personal',
  'school',
  'general'
);

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS type organization_type_enum NOT NULL DEFAULT 'general';

-- 예약 slug 는 일반 조직 slug 로 금지.
-- personal type 은 hidden slug (personal-{user_id}) 를 쓰므로 이 CHECK 를
-- 어차피 통과한다.
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_slug_not_reserved;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_slug_not_reserved
  CHECK (
    slug NOT IN ('my', 'me', 'admin', 'api', 'organizations', 'organization')
  );

-- 유저당 personal Organization 은 정확히 1개.
-- deleted_at IS NULL 만 대상으로 해서 soft-delete 후 재생성도 허용.
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_personal_owner
  ON public.organizations(owner_id)
  WHERE type = 'personal' AND deleted_at IS NULL;

-- 관측성: type 별 조회 인덱스 (Super Admin 대시보드 등).
CREATE INDEX IF NOT EXISTS idx_organizations_type
  ON public.organizations(type)
  WHERE deleted_at IS NULL;
