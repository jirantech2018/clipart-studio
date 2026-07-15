-- 기존 prompt_rules 스냅샷 백업 (Phase A 승인 시점에 관리자가 직접 실행).
-- Phase C 이관 완료 후 관리자가 최종 검증하고 나서 원본 prompt_rules 를 폐기할 예정.
--
-- 이 파일은 migrations 폴더가 아닌 scripts 폴더에 있어서 Supabase 마이그레이션 자동
-- 실행에 포함되지 않는다. 관리자가 Supabase SQL Editor 에서 명시적으로 열어
-- 실행해야 한다.
--
-- 병행으로 Supabase Dashboard 의 Table Editor → prompt_rules → Export → JSON
-- 도 다운받아 파일 백업까지 이중으로 남기는 것을 권장한다.

-- 스냅샷 테이블 생성 (오늘 날짜 기준).
-- 이미 있으면 새로 만들지 않는다 (중복 실행 안전).
CREATE TABLE IF NOT EXISTS public.prompt_rules_archive_2026_07_15 AS
SELECT * FROM public.prompt_rules;

-- 스냅샷 크기 확인
SELECT
  (SELECT COUNT(*) FROM public.prompt_rules)                 AS live_count,
  (SELECT COUNT(*) FROM public.prompt_rules_archive_2026_07_15) AS archive_count;
