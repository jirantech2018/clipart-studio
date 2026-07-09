-- Migration: 020_community_images_view
-- Design Ref: §3.3 community_images view — public assets + author metadata
-- Reason: Community feed and home curation need is_public='TRUE' images joined
--         with author account_type and (optionally) school_name in one call.
--
-- The view relies on the underlying tables' RLS. Anyone who can SELECT public
-- images can SELECT the view; RLS on profiles/school_profiles restricts columns
-- they own, but the joined columns we surface (account_type, school_name) are
-- deliberately whitelisted for public exposure and are the two the Design spec
-- calls out for the AuthorBadge.

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
  sp.school_name AS author_school_name
FROM public.images i
JOIN public.profiles p ON i.user_id = p.id
LEFT JOIN public.school_profiles sp ON i.user_id = sp.user_id
WHERE i.is_public = TRUE AND i.status = 'saved';

-- Grants for both role tiers used by the app.
GRANT SELECT ON public.community_images TO authenticated;
GRANT SELECT ON public.community_images TO service_role;
