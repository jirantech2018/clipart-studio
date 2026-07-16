-- Migration: 033b_community_view_expand
-- Design Ref: docs/02-design/features/organization.design.md v0.3
--
-- Purpose (Expand 단계 보완):
--   community_images 뷰가 아직 옛 컬럼(is_public) 만 노출하고 있어, 앱 코드가
--   새 컬럼(visibility, is_on_community) 을 조회할 수 없다. 뷰를 확장해서:
--     * 새 컬럼 (visibility, is_on_community) 도 노출
--     * 필터를 (is_public = TRUE OR is_on_community = TRUE) 로 완화
--       — 옛 앱은 여전히 is_public 만 봐서 정상 동작, 새 앱은 is_on_community
--         기준으로 필터해도 정상 동작.
--   기존 컬럼 (is_public 등) 은 그대로 유지하므로 Expand 원칙 위반 없음.
--
-- 실행 시점: 033_organizations_expand.sql 실행 후, 앱 코드 리팩터 배포 전.
-- 안전성: 뷰 REPLACE 만 하고 데이터 스키마 변경 없음. 무중단.
--
-- Postgres 제약:
--   CREATE OR REPLACE VIEW 는 기존 컬럼의 이름·순서 변경 불가. 새 컬럼은
--   반드시 SELECT 리스트의 **맨 뒤** 에만 추가 가능. 여기서는 기존 순서
--   (024_aspect_ratio.sql 정의) 를 그대로 유지하고 visibility / is_on_community
--   두 컬럼만 width / height 뒤에 append.

CREATE OR REPLACE VIEW public.community_images AS
SELECT
  i.id,
  i.user_id,
  i.prompt,
  i.model,
  i.seed,
  i.r2_key,
  i.thumbnail_r2_key,
  i.is_public,               -- 옛 앱 호환용 (Contract 이후 제거)
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
  ), 0)::BIGINT AS download_count,
  i.width,
  i.height,
  i.visibility,              -- 신규 (맨 뒤에 append)
  i.is_on_community          -- 신규 (맨 뒤에 append)
FROM public.images i
JOIN public.profiles p ON i.user_id = p.id
LEFT JOIN public.school_profiles sp ON i.user_id = sp.user_id
WHERE (i.is_public = TRUE OR i.is_on_community = TRUE)
  AND i.status = 'saved';

GRANT SELECT ON public.community_images TO authenticated;
GRANT SELECT ON public.community_images TO service_role;
