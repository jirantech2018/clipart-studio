-- Migration: 024_aspect_ratio
-- Adds pixel dimensions to images and an aspect_ratio choice to generation_jobs.
-- Existing rows default to 1024x1024 / 'square' — that's what every legacy row
-- was actually generated as, so the backfill is trivially correct.

-- Aspect ratio choice on the job (translated by pipeline.ts into
-- the exact 'WxH' string gpt-image-1 expects).
DO $$ BEGIN
  CREATE TYPE aspect_ratio_enum AS ENUM ('square', 'landscape', 'portrait');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS aspect_ratio aspect_ratio_enum NOT NULL DEFAULT 'square';

-- Actual pixel dimensions of the produced image (needed for masonry layout
-- so cards can reserve space without waiting for the image to load).
ALTER TABLE images
  ADD COLUMN IF NOT EXISTS width  INT NOT NULL DEFAULT 1024,
  ADD COLUMN IF NOT EXISTS height INT NOT NULL DEFAULT 1024;

-- The workspace view mirrors images columns, so refresh it to expose width/height.
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
  i.width,
  i.height,
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
