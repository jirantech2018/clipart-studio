-- Migration: 058_token_ledger
-- Milestone: M1
-- Depends on: 014_generation_jobs, 057_token_pools
-- Plan Ref: docs/01-plan/features/organization-token-management.plan.md v0.2.1 §6.3
--
-- 목적:
--   모든 토큰 변동의 감사(audit) 로그. Source of Truth.
--   append-only. UPDATE / DELETE 는 트리거로 예외 발생.
--
-- 정책 (Addendum v1.1 §Financial Rule):
--   - 모든 크레딧 변동은 반드시 이 테이블에 append.
--   - Pool.balance 는 이 테이블의 SUM(amount) 캐시.
--   - Reconciliation 배치가 매일 SUM 과 balance 를 비교해 drift 감지.
--
-- 컬럼:
--   transaction_id UUID — 하나의 논리 트랜잭션 묶음.
--                          TRANSFER 는 from / to 두 row 가 같은 tx_id 공유.
--                          단일 pool 변경도 자체 tx_id 를 갖는다 (조회 편의).
--   pool_id         — 이 row 가 반영되는 대상 pool.
--   from_pool_id    — TRANSFER 에서 amount 가 빠져나가는 pool (그 외 NULL).
--   to_pool_id      — TRANSFER 에서 amount 가 들어오는 pool (그 외 NULL).
--   type            — ISSUE / TRANSFER / USE / REFUND / ADJUST / MIGRATION.
--   amount          — pool 관점 부호. + 이면 pool 증가, - 이면 감소.
--   actor_id        — 이 변동을 일으킨 유저 (Super Admin · Org Admin · Member · system).
--   job_id          — 관련된 generation_jobs (USE / REFUND 인 경우).
--   memo            — 사람용 설명.
--   metadata JSONB  — provider 확장 · 이관 정보 · monthly cycle 등.

CREATE TYPE token_ledger_type_enum AS ENUM (
  'ISSUE',      -- Super Admin 신규 발행 (from_pool_id=NULL)
  'TRANSFER',   -- Pool 간 이동 (from_pool_id · to_pool_id 둘 다 세팅, tx_id 로 2 row)
  'USE',        -- 이미지 생성 소진
  'REFUND',     -- 실패/취소 환불
  'ADJUST',     -- 관리자 수동 조정
  'MIGRATION'   -- 레거시 profiles.credits → MY Pool 이관 흔적
);

CREATE TABLE public.token_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL,
  pool_id UUID NOT NULL REFERENCES public.token_pools(id) ON DELETE RESTRICT,
  from_pool_id UUID REFERENCES public.token_pools(id) ON DELETE RESTRICT,
  to_pool_id UUID REFERENCES public.token_pools(id) ON DELETE RESTRICT,
  type token_ledger_type_enum NOT NULL,
  amount INT NOT NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  job_id UUID REFERENCES public.generation_jobs(id) ON DELETE SET NULL,
  memo TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ledger_pool_created ON public.token_ledger(pool_id, created_at DESC);
CREATE INDEX idx_ledger_transaction ON public.token_ledger(transaction_id);
CREATE INDEX idx_ledger_type_created ON public.token_ledger(type, created_at DESC);
CREATE INDEX idx_ledger_job ON public.token_ledger(job_id) WHERE job_id IS NOT NULL;

-- Append Only 강제: UPDATE / DELETE 시도 → 예외.
CREATE OR REPLACE FUNCTION public.tg_token_ledger_append_only()
  RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'token_ledger is append-only (%)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_no_update
  BEFORE UPDATE ON public.token_ledger
  FOR EACH ROW EXECUTE FUNCTION public.tg_token_ledger_append_only();

CREATE TRIGGER trg_ledger_no_delete
  BEFORE DELETE ON public.token_ledger
  FOR EACH ROW EXECUTE FUNCTION public.tg_token_ledger_append_only();

-- RLS: pool 소속 조직의 active 멤버만 SELECT.
ALTER TABLE public.token_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY token_ledger_select_member ON public.token_ledger
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.token_pools p
      JOIN public.organization_members m
        ON m.organization_id = p.organization_id
      WHERE p.id = token_ledger.pool_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
  );

-- 쓰기 권한 차단. Credit Service RPC (service_role) 만 INSERT.
REVOKE INSERT ON public.token_ledger FROM authenticated, anon;
GRANT SELECT ON public.token_ledger TO authenticated;
GRANT ALL ON public.token_ledger TO service_role;
