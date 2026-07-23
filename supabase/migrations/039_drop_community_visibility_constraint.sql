-- Migration: 039_drop_community_visibility_constraint
--
-- 배경 (P5-C Phase A 후속):
--   Migration 033 에서 걸어둔 CHECK constraint
--     images_community_requires_public_or_auth
--   는 "is_on_community=TRUE 이면 visibility 가 authenticated 또는 public
--   이어야 한다" 를 강제한다. 개인이 직접 커뮤니티에 공개하던 시절의 규칙.
--
--   P5-C 큐레이션 흐름에서는:
--     * 이미지 visibility 는 조직 공유·큐레이션과 독립적으로 관리한다
--       (사용자 결정 — private 이미지도 조직 라이브러리·공유 라이브러리에
--        올라갈 수 있어야 함).
--     * 조직 멤버가 이미지에 접근하는 경로는 image_select_v5 (037) 가
--       shares 관계를 별도로 인정하도록 이미 확장돼 있다.
--     * 큐레이션 정합성은 038 의 images_community_curated_ck 가 담당한다
--       (세 컬럼이 세트로만 채워지도록).
--
--   즉 옛 visibility 강제 CHECK 는 더 이상 유효한 도메인 규칙이 아니고,
--   Phase A 배치 publish API 를 막고 있다.
--
-- 이 마이그레이션이 하는 일:
--   Migration 033 의 CHECK constraint 만 DROP. 038 에서 만든 큐레이션
--   정합성 CHECK 는 그대로 유지.

ALTER TABLE public.images
  DROP CONSTRAINT IF EXISTS images_community_requires_public_or_auth;
