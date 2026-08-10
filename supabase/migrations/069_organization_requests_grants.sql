-- Migration: 069_organization_requests_grants
-- Milestone: M4 Organization Approval Flow — hotfix
-- Depends on: 068_organization_requests
--
-- 배경:
--   068 초안에는 authenticated role 에 대한 GRANT 문이 빠져 있었다. RLS 만
--   있고 GRANT 가 없으면 Postgres 는 42501 (permission denied) 를 반환한다.
--   프로덕션에서 신청 저장이 500 으로 실패해 hotfix.
--
-- 이 파일은 idempotent:
--   * GRANT 는 이미 있어도 무해.
--   * NOTIFY 는 매번 발동해도 무해.

GRANT SELECT, INSERT ON public.organization_requests TO authenticated;

-- PostgREST schema cache 즉시 갱신 요청.
NOTIFY pgrst, 'reload schema';
