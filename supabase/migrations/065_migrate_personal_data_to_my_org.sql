-- Migration: 065_migrate_personal_data_to_my_org
-- Milestone: M2
-- Depends on: 011_images, 014_generation_jobs, 025_reference_images,
--             046_generation_jobs_org_id, 064_backfill_my_organizations
-- Plan Ref: docs/01-plan/features/organization-token-management.plan.md v0.2.2 §6.10
--
-- 목적:
--   개인 owner_id 기반 데이터 (images / reference_images / generation_jobs)
--   의 organization_id 를 유저의 MY Organization id 로 이관한다.
--
-- 정책 (사용자 지시):
--   - 기존 owner_id / user_id 는 그대로 유지.
--   - organization_id 만 MY Organization id 로 채운다.
--   - 조직 컨텍스트로 이미 생성된 데이터 (org_id / organization_id 가 이미
--     NULL 이 아닌 데이터) 는 손대지 않는다.
--   - `org_id=NULL` 을 영구적인 개인 데이터 표현으로 사용하지 않는다 (MY
--     Organization Decision Response §핵심 원칙 8).
--
-- 대상 테이블:
--   - `images`         : organization_id 컬럼 신설 (nullable) + UPDATE
--   - `reference_images`: organization_id 컬럼 신설 (nullable) + UPDATE
--   - `generation_jobs`: org_id 컬럼 기존 (Migration 046) + UPDATE
--
-- 이 마이그레이션 이후에도 fallback 조회 (org_id 가 NULL 이고 owner 가 나) 는
-- 이관 기간 (사용자 결정 D-open-6) 동안 잠정 허용하나, 앱 코드에서 새로운
-- 데이터는 반드시 organization_id 를 채워 삽입한다 (M3 에서 반영).

-- ============================================================
-- 1. images.organization_id 컬럼 신설
-- ============================================================
ALTER TABLE public.images
  ADD COLUMN IF NOT EXISTS organization_id UUID
  REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_images_organization_created
  ON public.images(organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;

-- ============================================================
-- 2. reference_images.organization_id 컬럼 신설
-- ============================================================
ALTER TABLE public.reference_images
  ADD COLUMN IF NOT EXISTS organization_id UUID
  REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reference_images_organization
  ON public.reference_images(organization_id)
  WHERE organization_id IS NOT NULL;

-- ============================================================
-- 3. 개인 데이터 → MY Organization id 로 UPDATE
-- ============================================================
-- Batch UPDATE 는 각 유저의 MY organization 을 조회해 매핑. Migration 064
-- 실행 이후이므로 모든 유저는 MY organization 을 이미 갖고 있다.

-- images: user_id 기반 개인 이미지 중 organization_id 가 아직 없는 것.
UPDATE public.images i
   SET organization_id = my_org.id
  FROM public.organizations my_org
 WHERE my_org.owner_id = i.user_id
   AND my_org.type = 'personal'
   AND my_org.deleted_at IS NULL
   AND i.organization_id IS NULL;

-- reference_images: user_id 기반 개인 참조 이미지 중 organization_id 가
-- 아직 없는 것.
UPDATE public.reference_images r
   SET organization_id = my_org.id
  FROM public.organizations my_org
 WHERE my_org.owner_id = r.user_id
   AND my_org.type = 'personal'
   AND my_org.deleted_at IS NULL
   AND r.organization_id IS NULL;

-- generation_jobs: user_id 기반 개인 job 중 org_id 가 아직 없는 것.
-- (조직 컨텍스트로 생성된 job 은 이미 org_id 가 있으므로 skip)
UPDATE public.generation_jobs j
   SET org_id = my_org.id
  FROM public.organizations my_org
 WHERE my_org.owner_id = j.user_id
   AND my_org.type = 'personal'
   AND my_org.deleted_at IS NULL
   AND j.org_id IS NULL;

-- ============================================================
-- 4. 검증 리포트 (RAISE NOTICE)
-- ============================================================
DO $$
DECLARE
  v_images_null_org INT;
  v_refs_null_org INT;
  v_jobs_null_org INT;
BEGIN
  SELECT COUNT(*) INTO v_images_null_org
    FROM public.images WHERE organization_id IS NULL;
  SELECT COUNT(*) INTO v_refs_null_org
    FROM public.reference_images WHERE organization_id IS NULL;
  SELECT COUNT(*) INTO v_jobs_null_org
    FROM public.generation_jobs WHERE org_id IS NULL;

  RAISE NOTICE 'migration report — leftover rows without organization_id:';
  RAISE NOTICE '  images:            % rows', v_images_null_org;
  RAISE NOTICE '  reference_images:  % rows', v_refs_null_org;
  RAISE NOTICE '  generation_jobs:   % rows', v_jobs_null_org;
  RAISE NOTICE '(any non-zero means the user has no MY organization yet;';
  RAISE NOTICE ' re-run Migration 064 backfill and this UPDATE)';
END $$;
