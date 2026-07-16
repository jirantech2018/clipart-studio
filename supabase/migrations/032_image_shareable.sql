-- Migration: 032_image_shareable
-- Purpose: URL 링크 공유 상태를 워크스페이스(커뮤니티) 공개 상태와 분리.
--
-- 배경:
--   지금까지 images.is_public 하나로 "커뮤니티에 노출" + "URL 공유 가능" 두 가지를
--   묶어서 다뤘음. 사용자가 "커뮤니티에는 안 나와도 링크만으로 공유 가능" 을 원해
--   두 상태를 분리.
--
--   is_public   : 커뮤니티(공유 라이브러리) 노출 여부. Non-Negotiable Rule 4 유지.
--   is_shareable: URL 을 알고 있는 로그인 회원이 접근 가능한지. 소유자가 "링크 복사"
--                 를 누르면 자동으로 TRUE 로 세팅되며, 소유자만 UPDATE 가능.
--
-- RLS 는 두 상태 중 하나만 TRUE 여도 조회 허용 (OR).

-- ---------------------------------------------------------------
-- 1. is_shareable 컬럼 추가 (기본 FALSE 로 안전)
-- ---------------------------------------------------------------
ALTER TABLE public.images
  ADD COLUMN IF NOT EXISTS is_shareable BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------
-- 2. SELECT 정책 재작성 — is_shareable 도 접근 조건에 포함
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS images_select_own_or_public ON public.images;

CREATE POLICY images_select_own_public_or_shareable ON public.images
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR is_public = TRUE
    OR is_shareable = TRUE
  );

-- ---------------------------------------------------------------
-- 3. 관련 테이블 (image_tags, image_categories) 도 동일하게 확장
--    이미지가 shareable 이면 그 이미지의 태그/카테고리도 함께 접근 가능해야 함.
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS tags_select ON public.image_tags;

CREATE POLICY tags_select ON public.image_tags
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.images
       WHERE images.id = image_tags.image_id
         AND (
           images.user_id = auth.uid()
           OR images.is_public = TRUE
           OR images.is_shareable = TRUE
         )
    )
  );

DROP POLICY IF EXISTS categories_select ON public.image_categories;

CREATE POLICY categories_select ON public.image_categories
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.images
       WHERE images.id = image_categories.image_id
         AND (
           images.user_id = auth.uid()
           OR images.is_public = TRUE
           OR images.is_shareable = TRUE
         )
    )
  );
