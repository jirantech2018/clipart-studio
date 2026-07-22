-- Migration: 038_community_curation
--
-- 배경 (P5-C Phase A):
--   공유 라이브러리(Community) 를 개인이 직접 공개하는 채널에서
--   "조직(owner)이 조직 라이브러리에서 선별해서 큐레이션" 하는 채널로 전환.
--
--   지금까지: 이미지 소유자가 스스로 is_on_community=TRUE 로 설정하여 공개.
--   앞으로  : owner 인 조직에서만 공유 라이브러리로 승격. editor/viewer 불가.
--
--   기존 커뮤니티 이미지(is_on_community=TRUE) 는 grandfather 로 유지되고
--   community_source_organization_id=NULL 로 남는다 (히스토리 부재를 명시).
--
-- 이 마이그레이션이 하는 일:
--   1) images 에 큐레이션 이력 3개 컬럼 추가 (모두 nullable).
--   2) CHECK constraint 로 신규 공개 시 세 필드가 세트로 채워지도록 강제.
--   3) images_update RLS 를 v2 → v3 로 교체 — 조직 owner 가 조직 공유된
--      이미지를 UPDATE 가능하게 (admin/editor 로부터는 접근 회수).
--   4) image_organization_shares DELETE 트리거 — 삭제되는 조직이 이미지의
--      큐레이션 소스와 일치하면 커뮤니티 필드를 초기화. 다른 조직의 공유는
--      건드리지 않음.

-- ================================================================
-- 1. 컬럼 추가
-- ================================================================

ALTER TABLE public.images
  ADD COLUMN community_published_by UUID
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN community_published_at TIMESTAMPTZ,
  ADD COLUMN community_source_organization_id UUID
    REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX idx_images_community_source
  ON public.images(community_source_organization_id)
  WHERE community_source_organization_id IS NOT NULL;

CREATE INDEX idx_images_community_published_at
  ON public.images(community_published_at DESC NULLS LAST)
  WHERE is_on_community = TRUE;

-- ================================================================
-- 2. CHECK constraint — 신규 공개는 세 필드 세트로만 허용
-- ================================================================
--
-- 허용 조합:
--   (a) is_on_community=FALSE                             — 비공개 (필드 모두 NULL)
--   (b) is_on_community=TRUE  + 세 필드 모두 NOT NULL     — 조직 큐레이션 신규 공개
--   (c) is_on_community=TRUE  + 세 필드 모두 NULL         — 038 이전 grandfather
--
-- (b) 와 (c) 를 모두 허용해서 기존 데이터를 건드리지 않는다.

ALTER TABLE public.images
  ADD CONSTRAINT images_community_curated_ck CHECK (
    is_on_community = FALSE
    OR (
      community_published_at IS NOT NULL
      AND community_published_by IS NOT NULL
      AND community_source_organization_id IS NOT NULL
    )
    OR (
      community_published_at IS NULL
      AND community_published_by IS NULL
      AND community_source_organization_id IS NULL
    )
  );

-- ================================================================
-- 3. images UPDATE RLS 재편 (v2 → v3)
-- ================================================================
--
-- v2: 소유자 OR (조직 owner/admin 이 조직 공유된 이미지)
-- v3: 소유자 OR (조직 owner   가 조직 공유된 이미지)
--
-- admin 은 migration 036 에서 사실상 사용 중단됨. 커뮤니티 승격 권한은
-- 명시적으로 owner 로 좁힌다.

DROP POLICY IF EXISTS images_update_v2 ON public.images;

CREATE POLICY images_update_v3 ON public.images
  FOR UPDATE
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.image_organization_shares ios
      JOIN public.organization_members om
        ON om.organization_id = ios.organization_id
      WHERE ios.image_id = images.id
        AND om.user_id = auth.uid()
        AND om.role = 'owner'
        AND om.status = 'active'
    )
  );

-- ================================================================
-- 4. 조직 공유 해제 시 커뮤니티 자동 해제 트리거
-- ================================================================
--
-- image_organization_shares DELETE 시 발동. 삭제되는 (image_id, org_id)
-- 가 그 이미지의 community_source_organization_id 와 일치할 때만
-- 커뮤니티 필드를 초기화. 이 조직이 소스가 아니면 아무 것도 안 함
-- (다른 조직의 큐레이션은 유지).
--
-- CASCADE (조직 삭제 시)/원본 이미지 삭제 시에도 발동해서 자연스럽게 정리.

CREATE OR REPLACE FUNCTION public.unshare_org_clears_community()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.images
  SET
    is_on_community = FALSE,
    community_published_by = NULL,
    community_published_at = NULL,
    community_source_organization_id = NULL
  WHERE id = OLD.image_id
    AND community_source_organization_id = OLD.organization_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_unshare_org_clears_community
  ON public.image_organization_shares;

CREATE TRIGGER trg_unshare_org_clears_community
  AFTER DELETE ON public.image_organization_shares
  FOR EACH ROW
  EXECUTE FUNCTION public.unshare_org_clears_community();
