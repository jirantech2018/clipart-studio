-- Migration: 021_community_download_count
-- Design Ref: KPI 재사용률 — download_events 집계를 community feed의 정렬 기준(인기순)으로 노출.
-- Approach: rebuild the community_images view with a correlated subquery so that
-- Supabase can order by download_count in a single round-trip.

CREATE OR REPLACE VIEW public.community_images AS
SELECT
  i.id,
  i.user_id,
  i.prompt,
  i.model,
  i.seed,
  i.r2_key,
  i.thumbnail_r2_key,
  i.is_public,
  i.is_upscaled,
  i.parent_image_id,
  i.batch_id,
  i.generation_mode,
  i.reference_image_id,
  i.school_profile_applied,
  i.status,
  i.created_at,
  p.account_type AS author_type,
  sp.school_name AS author_school_name,
  COALESCE((
    SELECT COUNT(*)
      FROM public.download_events d
     WHERE d.image_id = i.id
       AND d.event_type = 'download'
  ), 0)::BIGINT AS download_count
FROM public.images i
JOIN public.profiles p ON i.user_id = p.id
LEFT JOIN public.school_profiles sp ON i.user_id = sp.user_id
WHERE i.is_public = TRUE AND i.status = 'saved';

GRANT SELECT ON public.community_images TO authenticated;
GRANT SELECT ON public.community_images TO service_role;
