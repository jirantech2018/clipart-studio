-- Migration: 025_reference_images
-- 사용자가 업로드한 참조 이미지 슬롯 (계정당 5개 제한).
-- 라이브러리 이미지(chaining)와 별개의 저장 공간이며, /generate 페이지에서
-- 프롬프트와 함께 첨부해 img2img 생성에 활용한다.

-- ---------------------------------------------------------------
-- 1. reference_images 테이블
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reference_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  filename TEXT,
  width INT NOT NULL,
  height INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reference_images_user
  ON public.reference_images (user_id, created_at DESC);

-- ---------------------------------------------------------------
-- 2. 5개 제한 트리거 (BEFORE INSERT)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_reference_image_limit()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT COUNT(*) FROM public.reference_images WHERE user_id = NEW.user_id) >= 5 THEN
    RAISE EXCEPTION 'reference_image_limit_reached' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_reference_image_limit ON public.reference_images;
CREATE TRIGGER trg_enforce_reference_image_limit
  BEFORE INSERT ON public.reference_images
  FOR EACH ROW EXECUTE FUNCTION public.enforce_reference_image_limit();

-- ---------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------
ALTER TABLE public.reference_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reference_images_select_own" ON public.reference_images;
CREATE POLICY "reference_images_select_own"
  ON public.reference_images
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "reference_images_insert_own" ON public.reference_images;
CREATE POLICY "reference_images_insert_own"
  ON public.reference_images
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "reference_images_delete_own" ON public.reference_images;
CREATE POLICY "reference_images_delete_own"
  ON public.reference_images
  FOR DELETE
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------
-- 4. generation_jobs 확장 — 업로드 참조 이미지 R2 key
-- ---------------------------------------------------------------
-- reference_image_id는 라이브러리 이미지(chaining) 참조로 계속 사용.
-- custom_reference_r2_key는 사용자가 업로드한 참조 이미지의 R2 키.
-- 둘은 상호 배타적으로 사용된다 (API 계층에서 강제).
ALTER TABLE public.generation_jobs
  ADD COLUMN IF NOT EXISTS custom_reference_r2_key TEXT;

-- ---------------------------------------------------------------
-- 5. Role-level GRANT
-- ---------------------------------------------------------------
-- RLS와 별개로 authenticated/service_role에 테이블 자체 접근 권한이 필요하다.
-- (fresh install에서도 완결되도록 025에 포함. 이미 배포된 곳은 026이 이 부분을
-- 다시 실행하지만 GRANT는 idempotent라 안전하다.)
GRANT SELECT, INSERT, DELETE ON public.reference_images TO authenticated;
GRANT ALL ON public.reference_images TO service_role;
