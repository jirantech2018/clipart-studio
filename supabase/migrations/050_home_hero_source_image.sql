-- Migration: 050_home_hero_source_image
--
-- 홈 히어로 배너를 "관리자 큐레이션 대표 작품" 개념으로 확장.
-- 관리자가 공유 라이브러리(is_on_community=TRUE) 이미지 중 하나를 선택해
-- 홈 배너로 등록하고, 사용자가 배너를 클릭하면 그 이미지 상세로 이동.
--
-- source_image_id NULL → 기존 파일 업로드 방식 (self-contained r2_key)
-- source_image_id 세팅 → curation 방식. r2_key 는 원본 것을 그대로 저장하지만
--   홈 SSR 은 source_image_id 로 이미지 상세 링크·태그를 조회한다.
--
-- ON DELETE SET NULL: 원본 이미지가 삭제되면 링크만 무효화되고 배너 자체는
--   유지 (r2_key 는 남지만 R2 파일이 사라졌을 가능성 → 실제로는 폴백 처리).

ALTER TABLE public.home_hero_images
  ADD COLUMN IF NOT EXISTS source_image_id UUID
    REFERENCES public.images(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_home_hero_source_image
  ON public.home_hero_images(source_image_id)
  WHERE source_image_id IS NOT NULL;
