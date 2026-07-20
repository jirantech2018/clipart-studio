-- Migration: 035_grant_service_role_org_tables
--
-- 원인:
--   033_organizations_expand.sql 에서 authenticated 역할에는 GRANT 를 했지만
--   service_role 에 대해 명시 GRANT 를 하지 않아, service role 로 조회 시
--   Postgres 42501 permission denied 가 발생. Supabase 최근 프로젝트에서는
--   service_role 도 새 테이블에 대해 명시 GRANT 가 필요하다.
--
-- 이 파일이 하는 일:
--   조직 관련 5개 테이블 (+ 시퀀스) 에 대해 service_role 에게 전체 권한 부여.
--   RLS 는 그대로 유지 — service_role 은 RLS 를 우회하므로 정책과 무관.
--
-- 안전성:
--   GRANT 는 순수 권한 부여로 데이터/스키마 변경 없음. 실행 시 즉시 반영.

GRANT ALL ON public.organizations              TO service_role;
GRANT ALL ON public.organization_members       TO service_role;
GRANT ALL ON public.organization_invites       TO service_role;
GRANT ALL ON public.image_organization_shares  TO service_role;
GRANT ALL ON public.organization_activity_logs TO service_role;

-- BIGSERIAL 시퀀스 사용 권한
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.organization_activity_logs_id_seq TO service_role;
