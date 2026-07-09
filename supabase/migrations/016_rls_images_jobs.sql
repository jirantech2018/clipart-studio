-- Migration: 016_rls_images_jobs
-- Design Ref: §3.3 RLS + role GRANT for images/tags/categories/jobs/events
-- Plan SC: NFR RLS (Private isolation + Community exposure)

-- ============ images ============
ALTER TABLE images ENABLE ROW LEVEL SECURITY;

CREATE POLICY images_select_own_or_public ON images
  FOR SELECT
  USING (auth.uid() = user_id OR is_public = TRUE);

CREATE POLICY images_insert_own ON images
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY images_update_own ON images
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY images_delete_own ON images
  FOR DELETE
  USING (auth.uid() = user_id);

-- ============ image_tags ============
ALTER TABLE image_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY tags_select ON image_tags
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM images
       WHERE images.id = image_tags.image_id
         AND (images.user_id = auth.uid() OR images.is_public = TRUE)
    )
  );

-- INSERT via server-side (service role) only; no policy needed

-- ============ image_categories ============
ALTER TABLE image_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY categories_select ON image_categories
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM images
       WHERE images.id = image_categories.image_id
         AND (images.user_id = auth.uid() OR images.is_public = TRUE)
    )
  );

-- ============ generation_jobs ============
ALTER TABLE generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY jobs_own ON generation_jobs
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============ download_events ============
ALTER TABLE download_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY dl_select_own ON download_events
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT via server-side (service role) only; no policy needed

-- ============ GRANTS (required because "Automatically expose new tables" is OFF) ============
GRANT SELECT, INSERT, UPDATE, DELETE ON public.images TO authenticated;
GRANT SELECT ON public.image_tags TO authenticated;
GRANT SELECT ON public.image_categories TO authenticated;
GRANT SELECT, INSERT ON public.generation_jobs TO authenticated;
GRANT SELECT ON public.download_events TO authenticated;
