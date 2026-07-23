-- Migration: 042_pre_org_delete_community_cleanup
--
-- 배경:
--   Migration 038 에서 images.community_source_organization_id 에 FK
--   ON DELETE SET NULL 을 걸었고, 큐레이션 정합성을 위해
--   images_community_curated_ck CHECK constraint 를 함께 두었다.
--
--   문제:
--     `DELETE FROM organizations` 시 Postgres 가 FK action 을 병렬 처리하는
--     과정에서 `SET NULL` 이 `image_organization_shares` CASCADE (그리고
--     그 트리거로 인한 images 세 필드 초기화) 보다 먼저 실행되면
--     `community_source_organization_id` 만 NULL 이 되고 `published_by` /
--     `published_at` 은 채워진 상태가 되어 CHECK constraint 위반
--     (23514, images_community_curated_ck) 이 발생한다.
--
-- 해결:
--   `BEFORE DELETE ON organizations` 트리거를 추가해서, 삭제 대상 조직이
--   커뮤니티 큐레이션 소스인 이미지들의 세 필드 + is_on_community 를
--   **먼저** 리셋한다. 그 뒤 실행되는 FK SET NULL 은 이미 NULL 인 값에 대해
--   no-op 이 되고, CHECK constraint 는 통과.
--
-- 안전성:
--   - 트리거는 조직 삭제(hard delete) 시에만 발동. Soft delete
--     (UPDATE organizations SET deleted_at = ...) 는 이 트리거와 무관.
--   - 트리거의 UPDATE 조건이 정확히 매치되는 image (source = OLD.id) 만
--     대상. 다른 조직 소스 / grandfather (source NULL) / 미공개 이미지는
--     건드리지 않음.
--   - 개인 라이브러리 원본 자체는 삭제하지 않고 커뮤니티 노출 플래그만 리셋.

CREATE OR REPLACE FUNCTION public.pre_org_delete_clear_community()
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
  WHERE community_source_organization_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_pre_org_delete_clear_community ON public.organizations;

CREATE TRIGGER trg_pre_org_delete_clear_community
  BEFORE DELETE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.pre_org_delete_clear_community();
