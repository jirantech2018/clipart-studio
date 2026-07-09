-- Migration: 018_service_role_grants
-- Design Ref: §9.4 Service role bypass — trusted server-side writes (image insert, job status update, credit refund)
-- Plan SC: FR-08 pending image insert requires service_role INSERT on images
-- Reason: migration 016 granted only to 'authenticated'. With Supabase project setting
--         "Automatically expose new tables" = OFF, service_role has no default grants
--         on newly created tables → route handlers fail with "permission denied".

GRANT ALL ON public.images              TO service_role;
GRANT ALL ON public.image_tags          TO service_role;
GRANT ALL ON public.image_categories    TO service_role;
GRANT ALL ON public.generation_jobs     TO service_role;
GRANT ALL ON public.download_events     TO service_role;

-- Ensure future sequences (e.g. added later) are also usable by service_role
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
