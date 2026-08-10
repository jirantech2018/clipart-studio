-- Migration: 067_token_pools_auto_provision
-- Milestone: M4-1 (전제)
-- Depends on: 033_organizations_expand, 057_token_pools, 062_provision_my_organization
-- Plan Ref: docs/01-plan/features/organization-token-management.plan.md v0.2.9 §2.3.4
--
-- 목적:
--   M3-3 도중 발견된 gap. `token_pools` row 는 MY (personal) organization 에
--   대해서만 signup / provision 트리거로 자동 생성되고, 학교/일반 조직 생성
--   시에는 만들어지지 않았다. Super Admin 이 학교 조직에 첫 지급을 시도하면
--   `allocate_tokens` 가 pool_id = NULL → `INVALID_TARGET: to_pool required`
--   예외.
--
-- 처리:
--   1) 백필: 아직 pool 이 없는 모든 조직에 balance=0 pool row 를 만든다.
--   2) 트리거: 앞으로 새로 생성되는 모든 organizations 에 대해서도 자동으로
--      pool row 를 함께 만든다. `provision_my_organization` 이 만드는 MY pool
--      과 겹칠 경우에도 `ON CONFLICT (organization_id) DO NOTHING` 으로 무해.
--
-- 안전성:
--   * `token_pools.organization_id` UNIQUE constraint 가 이미 있어 중복 방지.
--   * 트리거는 AFTER INSERT — 조직 row 가 확정된 후 실행.
--   * balance=0 으로 시작하므로 어떤 크레딧도 새로 발행되지 않는다 (감사 이벤트
--     없음). 실제 지급은 이후 `allocate_tokens` (ISSUE) 를 통해서만.

-- ============================================================
-- (1) 백필
-- ============================================================
INSERT INTO public.token_pools (organization_id, balance)
SELECT o.id, 0
  FROM public.organizations o
  LEFT JOIN public.token_pools p ON p.organization_id = o.id
 WHERE p.id IS NULL
   AND o.deleted_at IS NULL
ON CONFLICT (organization_id) DO NOTHING;

-- ============================================================
-- (2) 신규 조직 자동 provisioning 트리거
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_organizations_provision_pool()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  INSERT INTO public.token_pools (organization_id, balance)
    VALUES (NEW.id, 0)
    ON CONFLICT (organization_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_provision_pool ON public.organizations;

CREATE TRIGGER organizations_provision_pool
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_organizations_provision_pool();
