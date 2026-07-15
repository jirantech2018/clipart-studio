-- Migration: 031_drop_prompt_rules
-- Purpose: Knowledge CMS 로의 파이프라인 이관 완료. 더 이상 사용하지 않는
-- prompt_rules 테이블과 legacy admin_settings 테이블 (system_prompt 만 담고 있던)
-- 을 완전히 제거한다.
--
-- 관련 코드는 이미 삭제됨:
--   src/services/prompt-rules/
--   src/features/prompt-rules/
--   src/app/api/admin/prompt-rules/
-- 파이프라인 (src/services/image-gen/pipeline.ts, src/app/api/jobs/[id]/stream/route.ts)
-- 은 Knowledge 매칭이 없으면 사용자 프롬프트를 그대로 사용한다.

-- ---------------------------------------------------------------
-- 1. prompt_rules 테이블 제거
--    - 인덱스 / 트리거는 CASCADE 로 함께 삭제됨.
-- ---------------------------------------------------------------
DROP TABLE IF EXISTS public.prompt_rules CASCADE;

-- ---------------------------------------------------------------
-- 2. admin_settings 테이블 제거
--    - 023 에서 도입된 단일 행 system_prompt 저장소. Knowledge 이관 후 미사용.
-- ---------------------------------------------------------------
DROP TABLE IF EXISTS public.admin_settings CASCADE;
