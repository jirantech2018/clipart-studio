-- Migration: 034_organizations_contract
-- Design Ref: docs/02-design/features/organization.design.md v0.3
-- PRD Ref:    docs/00-pm/organization.prd.md v0.3
--
-- ⚠️ 실행 조건 (반드시 지켜야 함):
--   1) 033_organizations_expand.sql 가 이미 실행되어 있을 것.
--   2) 앱 코드가 is_public / is_shareable 을 더 이상 참조하지 않고
--      visibility / is_on_community 만 사용하도록 재작성 & 배포 완료.
--   3) 최소 며칠 실사용하며 이상 없음을 확인.
--
--   위 3개 조건이 안 지켜진 상태에서 이 SQL 을 실행하면, 기존 컬럼을
--   참조하는 옛 배포/캐시된 요청이 즉시 500 에러를 일으킨다.
--
-- 이 파일이 하는 일: Expand phase 에서 유지했던 옛 컬럼과 옛 정책을
-- 안전하게 제거하는 정리 작업. 새 시스템 (visibility + is_on_community)
-- 만 남는다.

-- ================================================================
-- 1. 옛 RLS 정책 제거
--    (v1 이후 여러 이름으로 존재해 왔으니 IF EXISTS 로 안전 제거)
-- ================================================================

DROP POLICY IF EXISTS images_select_own_or_public ON public.images;
DROP POLICY IF EXISTS images_select_own_public_or_shareable ON public.images;
DROP POLICY IF EXISTS images_select_v3 ON public.images;
DROP POLICY IF EXISTS images_update_own ON public.images;

DROP POLICY IF EXISTS tags_select ON public.image_tags;
DROP POLICY IF EXISTS categories_select ON public.image_categories;

-- ================================================================
-- 2. 옛 컬럼 제거 (실제 DROP — 되돌리기 어려움)
-- ================================================================

ALTER TABLE public.images DROP COLUMN IF EXISTS is_public;
ALTER TABLE public.images DROP COLUMN IF EXISTS is_shareable;

-- ================================================================
-- 3. Expand 에서 만든 v2 정책의 이름을 원래 이름(tags_select /
--    categories_select) 으로 재정렬하고 싶다면 여기서 rename 하지 말고
--    다음 마이그레이션에서 처리한다 (지금은 스키마 단순화만).
-- ================================================================

-- (정책 이름 정리는 여기서 하지 않는다 — 이름은 그대로 두어도 무해)
