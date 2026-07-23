-- Migration: 041_community_source_and_tag_rls
--
-- P5-C Phase B-3 (finalization):
--
-- (1) org_activity_type enum 에 커뮤니티 큐레이션 전용 값 두 개 추가.
--     그 전까지는 activity type 을 image_shared / image_unshared 로 재사용
--     했으나 활동 로그에서 "조직 공유" 와 "공유 라이브러리 승격" 을 구분할
--     수 없다는 문제가 있었다.
-- (2) community_images 뷰에 출처 조직 (slug, name) 을 함께 노출해서
--     Community 카드에 큐레이션 조직 뱃지를 즉시 표시할 수 있게 한다.
--     grandfather 데이터는 source 가 NULL 이므로 뱃지 자동 미표시.
-- (3) tags_select_v2 / categories_select_v2 정책이 shares 관계를 인정하지
--     않아서, 조직 라이브러리에서 다른 멤버 이미지의 태그·카테고리가 안
--     보이는 문제가 있었다. images_select_v5 (037) 와 동일한 shares 조건을
--     추가해 정합성을 맞춘다.

-- ================================================================
-- 1. org_activity_type enum 확장
-- ================================================================
--
-- ALTER TYPE ADD VALUE 는 PostgreSQL 12+ 에서 트랜잭션 내 실행이 허용되지만
-- 같은 트랜잭션에서 그 값을 즉시 사용하는 것은 여전히 제한된다. 이 파일은
-- 새 값을 이 파일 내부에서 즉시 참조하지 않으므로 안전.

ALTER TYPE public.org_activity_type ADD VALUE IF NOT EXISTS 'community_published';
ALTER TYPE public.org_activity_type ADD VALUE IF NOT EXISTS 'community_unpublished';

-- ================================================================
-- 2. community_images 뷰 재정의 — 출처 조직 정보 포함
-- ================================================================
--
-- LEFT JOIN organizations 로 source_organization_slug / name 을 함께 노출.
-- soft-deleted 조직은 매칭 안 되도록 조건 걸어서 삭제된 조직 이름이 카드에
-- 뜨는 사고를 방지.

DROP VIEW IF EXISTS public.community_images;

CREATE VIEW public.community_images AS
SELECT
  i.id,
  i.user_id,
  i.prompt,
  i.model,
  i.seed,
  i.r2_key,
  i.thumbnail_r2_key,
  i.visibility,
  i.is_on_community,
  i.is_upscaled,
  i.parent_image_id,
  i.batch_id,
  i.generation_mode,
  i.reference_image_id,
  i.school_profile_applied,
  i.status,
  i.created_at,
  i.community_published_at,
  i.community_published_by,
  i.community_source_organization_id,
  src.slug AS source_organization_slug,
  src.name AS source_organization_name,
  p.account_type AS author_type,
  sp.school_name AS author_school_name,
  COALESCE((
    SELECT COUNT(*)
      FROM public.download_events d
     WHERE d.image_id = i.id
       AND d.event_type = 'download'
  ), 0)::BIGINT AS download_count,
  i.width,
  i.height
FROM public.images i
JOIN public.profiles p ON i.user_id = p.id
LEFT JOIN public.school_profiles sp ON i.user_id = sp.user_id
LEFT JOIN public.organizations src
  ON src.id = i.community_source_organization_id
 AND src.deleted_at IS NULL
WHERE i.is_on_community = TRUE
  AND i.status = 'saved';

GRANT SELECT ON public.community_images TO authenticated;
GRANT SELECT ON public.community_images TO service_role;

-- ================================================================
-- 3. image_tags / image_categories SELECT RLS 확장
-- ================================================================
--
-- v2: 소유자 OR visibility IN ('authenticated', 'public') OR
--     (visibility='organization' AND image_visible_via_org)
-- v3: v2 + shares 관계로 접근 가능한 조직 active 멤버
--
-- images_select_v5 (037) 와 동일 조건을 tags·categories 조회에도 반영해
-- 조직 라이브러리에서 다른 멤버 이미지의 메타데이터가 함께 보이도록.

DROP POLICY IF EXISTS tags_select_v2 ON public.image_tags;

CREATE POLICY tags_select_v3 ON public.image_tags
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
           OR EXISTS (
             SELECT 1
             FROM public.image_organization_shares ios
             JOIN public.organization_members om
               ON om.organization_id = ios.organization_id
             WHERE ios.image_id = images.id
               AND om.user_id = auth.uid()
               AND om.status = 'active'
           )
         )
    )
  );

DROP POLICY IF EXISTS categories_select_v2 ON public.image_categories;

CREATE POLICY categories_select_v3 ON public.image_categories
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
           OR EXISTS (
             SELECT 1
             FROM public.image_organization_shares ios
             JOIN public.organization_members om
               ON om.organization_id = ios.organization_id
             WHERE ios.image_id = images.id
               AND om.user_id = auth.uid()
               AND om.status = 'active'
           )
         )
    )
  );
