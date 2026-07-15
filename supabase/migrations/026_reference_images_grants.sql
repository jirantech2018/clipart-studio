-- Migration: 026_reference_images_grants
-- 025에서 테이블/RLS/트리거만 만들고 role-level GRANT를 빠뜨려서
-- API에서 "permission denied for table reference_images (code=42501)"가 났음.
-- 010_grants.sql / 018_service_role_grants.sql와 같은 패턴으로 부여한다.

-- authenticated: RLS로 자기 행만 보이지만 테이블 자체에도 CRUD 권한이 있어야 통과.
GRANT SELECT, INSERT, DELETE ON public.reference_images TO authenticated;

-- service_role: 서버 사이드에서 우회 필요 시 사용 (예: 잡 롤백 정리).
GRANT ALL ON public.reference_images TO service_role;
