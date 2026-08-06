-- Migration: 064_backfill_my_organizations
-- Milestone: M2
-- Depends on: 062_provision_my_organization
-- Plan Ref: docs/01-plan/features/organization-token-management.plan.md v0.2.2 §6.9
--
-- 목적:
--   Migration 063 이 배포된 이후 신규 유저는 자동으로 MY Organization 을
--   갖지만, 그 이전에 signup 한 기존 유저는 아직 없다. 이 마이그레이션이
--   전 유저를 순회하며 provision_my_organization 을 호출해 backfill 한다.
--
-- 정책:
--   - provision_my_organization 은 idempotent 하므로 이미 provisioning 된
--     유저는 즉시 return.
--   - 각 유저는 개별 함수 호출 = 개별 트랜잭션 (PostgreSQL 은 함수 하나가
--     사실상 하나의 트랜잭션이므로 유저별 실패가 다른 유저에게 영향 X).
--   - profile 이 없는 auth.users 도 있을 수 있어 (예: OAuth 실패 후 leftover)
--     provision 은 그냥 진행. profiles.credits 이관은 profile 이 있을 때만.
--
-- 검증:
--   실행 후 다음이 성립해야 한다.
--     SELECT COUNT(*) FROM organizations WHERE type='personal'
--       = SELECT COUNT(*) FROM auth.users
--     SELECT COUNT(*) FROM token_pools = SELECT COUNT(*) FROM organizations
--     invariant: 각 personal pool balance = 이관 전 profiles.credits

DO $$
DECLARE
  u RECORD;
  v_result JSONB;
  v_provisioned INT := 0;
  v_already INT := 0;
BEGIN
  FOR u IN SELECT id FROM auth.users LOOP
    v_result := public.provision_my_organization(u.id);
    IF v_result->>'status' = 'provisioned' THEN
      v_provisioned := v_provisioned + 1;
    ELSE
      v_already := v_already + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'backfill complete: provisioned=%, already=%', v_provisioned, v_already;
END $$;
