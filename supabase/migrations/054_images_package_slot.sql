-- Migration: 054_images_package_slot
--
-- Package job 결과 이미지를 slot 과 양방향 연결.
-- 기존 images.batch_id (job.id 참조) 는 그대로 유지하고 slot 참조만 추가.
-- Single job 이미지는 package_slot_id = NULL.

ALTER TABLE public.images
  ADD COLUMN IF NOT EXISTS package_slot_id UUID
  REFERENCES public.generation_job_slots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_images_package_slot
  ON public.images(package_slot_id)
  WHERE package_slot_id IS NOT NULL;
