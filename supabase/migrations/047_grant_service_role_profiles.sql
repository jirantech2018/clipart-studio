-- Migration: 047_grant_service_role_profiles
--
-- 원인:
--   010_grants.sql 에서 profiles / school_profiles 를 authenticated 에만 GRANT
--   하고 service_role 에는 명시 GRANT 를 하지 않았다. Supabase 최근 프로젝트
--   에서는 service_role 도 새 테이블에 대해 명시 GRANT 가 필요해서 API 에서
--   service role 로 profiles.email 을 조회하면 42501 permission denied 가
--   발생한다.
--
--   증거: /api/organizations/[slug]/activity-logs 에서 profiles 조회가 실패
--   ("permission denied for table profiles") 하고 auth.admin.getUserById
--   fallback 으로만 이메일이 채워지고 있었음.
--
-- 이 파일이 하는 일:
--   profiles, school_profiles 두 테이블에 service_role 전체 권한 부여.
--   RLS 는 그대로 유지 (service_role 은 RLS 우회이므로 정책 무관).
--
-- 안전성:
--   GRANT 는 순수 권한 부여로 데이터/스키마 변경 없음. 즉시 반영.

GRANT ALL ON public.profiles        TO service_role;
GRANT ALL ON public.school_profiles TO service_role;
