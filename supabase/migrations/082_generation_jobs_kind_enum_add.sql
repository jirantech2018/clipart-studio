-- Migration: 082_generation_jobs_kind_enum_add
-- Feature: learning-helper (Phase 1 M1)
-- Plan Ref: docs/01-plan/features/learning-helper.plan.md v0.4 §M1
--
-- 트랜잭션 분리 이유:
--   PostgreSQL 은 하나의 트랜잭션 안에서 방금 추가한 enum 값을 그 트랜잭션 내부의
--   다른 statement (예: 인덱스 WHERE 절, CHECK constraint, RLS 정책, DEFAULT) 에서
--   즉시 사용하면 오류를 낸다 ("unsafe use of new value of enum type").
--   Supabase CLI 는 각 마이그레이션 파일을 개별 트랜잭션으로 실행하므로, 새 enum
--   값을 추가하는 이 파일 (082) 을 먼저 커밋한 뒤 별도 파일 (083) 에서 그 값을 사용한다.
--
-- 이 파일이 담당하는 유일한 작업:
--   기존 job_kind_enum('single', 'package') 에 'learning_doc' 값 추가.
--
-- 재실행 안전성:
--   IF NOT EXISTS 로 이미 있으면 skip. PostgreSQL 12+.

ALTER TYPE public.job_kind_enum ADD VALUE IF NOT EXISTS 'learning_doc';

NOTIFY pgrst, 'reload schema';
