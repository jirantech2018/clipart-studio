-- Migration: 070_organization_requests_service_role_grants
-- Milestone: M4 Organization Approval Flow — hotfix #2
-- Depends on: 068_organization_requests, 069_organization_requests_grants
--
-- 배경:
--   이 Supabase 프로젝트는 "Automatically expose new tables" 옵션이 OFF 라
--   신규 테이블에 대해 service_role 도 기본 grant 를 받지 않는다 (Migration
--   018 이 같은 이유로 image 관련 테이블에 명시 grant 를 추가한 전례가 있음).
--   068 은 authenticated 만 grant 했고 (069 hotfix), service_role 은 여전히
--   permission denied. GET /api/admin/organization-requests 가 500 반환:
--     42501 permission denied for table organization_requests
--     hint: Grant the required privileges to the current role with:
--           GRANT SELECT ON public.organization_requests TO service_role;
--
-- 조치:
--   * organization_requests 에 service_role 로 ALL 부여.
--   * approve_organization_request RPC 는 이미 service_role 로 EXECUTE 됨.
--     RPC 안에서 다른 테이블 (organizations / organization_members /
--     organization_activity_logs) INSERT 는 SECURITY DEFINER 라 owner 권한
--     으로 실행되므로 이 hotfix 만으로 승인 흐름도 정상 동작.
--
-- Idempotent: GRANT 는 이미 있어도 무해. NOTIFY 도 무해.

GRANT ALL ON public.organization_requests TO service_role;

-- PostgREST schema cache 즉시 갱신.
NOTIFY pgrst, 'reload schema';
