-- Migration: 037_images_select_via_org_share
--
-- 배경 (P5-C):
--   조직 라이브러리 기능을 위해 image_organization_shares 를 통한 접근을
--   image visibility 와 독립적으로 열어준다.
--
--   지금 (v4): visibility='organization' 인 이미지만 image_visible_via_org 를
--   통해 조직 멤버가 볼 수 있음. private 이미지를 조직에만 공유한 케이스와
--   public 이미지를 조직에도 얹은 케이스가 모두 취급되지 않음.
--
--   확장 (v5): shares 에 row 가 있고 요청자가 그 조직의 active 멤버이면
--   visibility 값과 무관하게 SELECT 허용.
--
-- 안전성:
--   * 기존 4개의 OR 조건은 그대로 유지.
--   * 조건 하나만 추가되므로 접근이 넓어질 뿐 좁아지지 않음.
--   * 소유자가 명시적으로 공유한 조직에 대해서만 열림. 공유 해제하면 즉시
--     접근 차단.

DROP POLICY IF EXISTS images_select_v4 ON public.images;

CREATE POLICY images_select_v5 ON public.images
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR visibility IN ('authenticated', 'public')
    OR (
      visibility = 'organization'
      AND image_visible_via_org(id, auth.uid())
    )
    OR EXISTS (
      SELECT 1
      FROM public.image_organization_shares ios
      JOIN public.organization_members om
        ON om.organization_id = ios.organization_id
      WHERE ios.image_id = images.id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );
