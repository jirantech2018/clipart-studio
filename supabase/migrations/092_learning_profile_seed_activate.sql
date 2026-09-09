-- Migration: 092_learning_profile_seed_activate
-- Feature: learning-helper (Phase 1 M2-1.8)
--
-- 목적:
--   091 에서 draft 상태로 삽입한 최소 seed 프로필을 active 로 전환.
--   RLS 정책이 status='active' AND profile_set.status='active' 만 노출하므로,
--   전환 전에는 서비스가 EMPTY_PROFILE 폴백을 사용해 데이터 기반 검수가 동작하지 않는다.
--
-- 안전:
--   - 대상: 오직 신규 테이블 learning_profile_sets / learning_profiles (2026-09-09 신설, 다른 서비스 미참조).
--   - 기존 001~083 데이터·스키마·RLS 무영향.
--   - 회귀 문제 발견 시 롤백은 status 를 다시 'draft' 로 UPDATE (아래 주석 참조).
--
-- 롤백:
--   UPDATE public.learning_profile_sets SET status='draft' WHERE code='KR_ELEM_2022_V1';
--   UPDATE public.learning_profiles SET status='draft'
--     WHERE profile_set_id = (SELECT id FROM public.learning_profile_sets WHERE code='KR_ELEM_2022_V1');

UPDATE public.learning_profile_sets
   SET status = 'active', updated_at = NOW()
 WHERE code = 'KR_ELEM_2022_V1'
   AND status = 'draft';

UPDATE public.learning_profiles p
   SET status = 'active', updated_at = NOW()
  FROM public.learning_profile_sets ps
 WHERE p.profile_set_id = ps.id
   AND ps.code = 'KR_ELEM_2022_V1'
   AND p.status = 'draft';

NOTIFY pgrst, 'reload schema';
