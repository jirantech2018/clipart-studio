-- Migration: 059_generation_jobs_openai_cost
-- Milestone: M1
-- Depends on: 014_generation_jobs
-- Plan Ref: docs/01-plan/features/organization-token-management.plan.md v0.2.1 §6.4
--
-- 목적:
--   조직별 · 유저별 실비용 집계를 위해 이미지 생성 provider 의 실제 usage
--   와 계산된 비용을 job 단위로 저장한다. Addendum v1.1 §OpenAI Cost 결정:
--   "배치 근사 계산을 사용하지 않는다" — 매 job completed_at 시점에 usage 를
--   upsert 한다.
--
-- 컬럼:
--   provider              — 'openai' | 'replicate' | ...
--   model                 — 'gpt-image-1' | 'flux-schnell' | ...
--   usage_input_tokens    — provider 응답의 prompt / input tokens (있으면)
--   usage_output_tokens   — provider 응답의 output / image tokens (있으면)
--   image_count           — 실제 생성된 이미지 수
--   provider_cost_usd     — 계산된 USD 비용
--   provider_cost_krw     — KRW 환산 비용 (표시 편의)
--   usage_raw             — provider 원본 usage 페이로드 (감사 · 재계산)
--
-- 저장 시점은 M3 에서 이미지 생성 파이프라인이 구현할 예정. 이 마이그레이션
-- 은 스키마만 배포.

ALTER TABLE public.generation_jobs
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS usage_input_tokens INT,
  ADD COLUMN IF NOT EXISTS usage_output_tokens INT,
  ADD COLUMN IF NOT EXISTS image_count INT,
  ADD COLUMN IF NOT EXISTS provider_cost_usd NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS provider_cost_krw NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS usage_raw JSONB;

-- Super Admin 대시보드의 provider 별 · 월별 집계용.
CREATE INDEX IF NOT EXISTS idx_jobs_provider_completed
  ON public.generation_jobs(provider, completed_at DESC)
  WHERE completed_at IS NOT NULL;
