-- Migration: 077_community_view_count
-- Feature: embed community/search 이미지 카드에 클릭수(=상세 진입 조회수) 노출.
-- Depends on: 015_download_events, 041_community_source_and_tag_rls (최신 뷰 정의)
--
-- 정책:
--   - 새 이벤트 타입 'view' 를 download_events.event_type CHECK 에 추가.
--   - user_id NULLABLE 로 (익명 embed 방문자용).
--   - community_images 뷰에 view_count 컬럼 추가 (기존 필드 전부 유지).

-- ============================================================
-- (1) event_type CHECK 확장: 'view' 추가
-- ============================================================
ALTER TABLE public.download_events
  DROP CONSTRAINT IF EXISTS download_events_event_type_check;

ALTER TABLE public.download_events
  ADD CONSTRAINT download_events_event_type_check
    CHECK (event_type IN ('download', 'copy_link', 'chain_source', 'view'));

-- ============================================================
-- (2) user_id 를 NULLABLE 로 (익명 embed 방문자용)
-- ============================================================
ALTER TABLE public.download_events
  ALTER COLUMN user_id DROP NOT NULL;

-- ============================================================
-- (3) community_images 뷰 재정의 — 041 기준 + view_count 추가
-- ============================================================
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
  COALESCE((
    SELECT COUNT(*)
      FROM public.download_events d
     WHERE d.image_id = i.id
       AND d.event_type = 'view'
  ), 0)::BIGINT AS view_count,
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

NOTIFY pgrst, 'reload schema';
