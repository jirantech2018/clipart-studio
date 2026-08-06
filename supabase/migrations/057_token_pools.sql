-- Migration: 057_token_pools
-- Milestone: M1
-- Depends on: 033_organizations_expand, 056_organizations_type_and_reserved_slugs
-- Plan Ref: docs/01-plan/features/organization-token-management.plan.md v0.2.1 §6.2
--
-- 목적:
--   조직 (개인 · 학교 · 일반) 별 Token Pool. 잔액 캐시. Ledger 의 SUM 결과
--   가 진실이며 이 컬럼은 성능용 캐시. 직접 UPDATE 는 Credit Service RPC
--   만 (service_role) 허용.
--
-- 정책 (Addendum v1.1):
--   - Pool 은 organization 소속만 (Personal Pool 개념 폐기).
--   - organization_id UNIQUE → 조직당 정확히 1개의 Pool.
--   - authenticated 는 SELECT 만. INSERT / UPDATE / DELETE 는 service_role 만.
--   - CHECK (balance >= 0) — 음수 잔액 원천 차단.
--
-- 초기 배포 시 이 테이블은 비어 있다. M2 (Migration 062-064) 에서
-- MY organization 마다 Pool 이 자동 생성된다. 학교 조직 Pool 은 M4 UI 에서
-- 관리자가 지급하는 시점에 필요.

CREATE TABLE public.token_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  balance INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (balance >= 0)
);

CREATE INDEX idx_token_pools_organization ON public.token_pools(organization_id);

-- RLS: 조직의 active 멤버만 pool 조회 가능.
ALTER TABLE public.token_pools ENABLE ROW LEVEL SECURITY;

CREATE POLICY token_pools_select_member ON public.token_pools
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = token_pools.organization_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
  );

-- 쓰기 권한 차단. authenticated / anon 은 SELECT 만.
-- service_role (Credit Service RPC) 만 write 가능.
REVOKE INSERT, UPDATE, DELETE ON public.token_pools FROM authenticated, anon;
GRANT SELECT ON public.token_pools TO authenticated;
GRANT ALL ON public.token_pools TO service_role;

-- updated_at 자동 갱신 트리거.
CREATE OR REPLACE FUNCTION public.tg_token_pools_touch_updated_at()
  RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_token_pools_updated_at
  BEFORE UPDATE ON public.token_pools
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_token_pools_touch_updated_at();
