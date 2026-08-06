-- Migration: 062_provision_my_organization
-- Milestone: M2
-- Depends on: 001_profiles, 033_organizations_expand, 056, 057, 058, 060
-- Plan Ref: docs/01-plan/features/organization-token-management.plan.md v0.2.2 §6.7
--
-- 목적:
--   유저 하나에 대해 MY Organization + Owner Membership + Token Pool + 초기
--   Ledger 를 idempotent 하게 provisioning 한다.
--
-- 정책:
--   - `owner_id + type='personal'` 조합에 대한 partial UNIQUE index (Migration 056) 로
--     같은 유저에 두 번 실행해도 두 개가 생성되지 않는다. 이 RPC 도 사전 조회로
--     이미 있으면 즉시 반환 (idempotency).
--   - 기존 `profiles.credits` 값을 legacy migration 으로 MY Pool 에 이관한다.
--     이관은 반드시 Credit Service 의 `allocate_tokens(NULL, my_pool, credits,
--     'legacy migration', system_actor)` 을 통과. Raw UPDATE 금지 (Addendum 원칙).
--   - hidden slug: `personal-{user_id}`. 사용자 화면에 절대 노출되지 않는다.
--     예약 slug (`my`, `me`, ...) 는 Migration 056 CHECK 로 금지되어 있고,
--     `personal-{uuid}` 는 그 예약 목록에 없으므로 통과.

CREATE OR REPLACE FUNCTION public.provision_my_organization(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_pool_id UUID;
  v_credits INT;
  v_migrated_credits INT := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_USER_ID: p_user_id required';
  END IF;

  -- 1. 이미 존재하는지 확인 (idempotent).
  SELECT id INTO v_org_id
    FROM public.organizations
   WHERE owner_id = p_user_id
     AND type = 'personal'
     AND deleted_at IS NULL
   LIMIT 1;

  IF v_org_id IS NOT NULL THEN
    SELECT id INTO v_pool_id FROM public.token_pools WHERE organization_id = v_org_id;
    RETURN jsonb_build_object(
      'status', 'already_provisioned',
      'organization_id', v_org_id,
      'pool_id', v_pool_id
    );
  END IF;

  -- 2. MY Organization 생성.
  -- slug 는 hidden. 사용자 화면에는 절대 노출하지 않는다 (`/organization/my` alias).
  INSERT INTO public.organizations (name, slug, owner_id, type, max_visibility)
  VALUES (
    '내 워크스페이스',
    'personal-' || REPLACE(p_user_id::TEXT, '-', ''),
    p_user_id,
    'personal',
    'private'
  )
  RETURNING id INTO v_org_id;

  -- 3. Owner Membership 자동 생성.
  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  VALUES (v_org_id, p_user_id, 'owner', 'active')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  -- 4. Token Pool 생성 (balance 0 로 시작).
  INSERT INTO public.token_pools (organization_id, balance)
  VALUES (v_org_id, 0)
  RETURNING id INTO v_pool_id;

  -- 5. Legacy `profiles.credits` 이관 (Credit Service RPC 통과).
  -- Ledger 는 append-only 이므로 사후 UPDATE 불가. legacy 마킹은
  -- memo='legacy migration' 로 충분히 식별 가능. (metadata 추가는 향후
  -- allocate_tokens 시그니처에 metadata 파라미터를 추가할 때 반영.)
  SELECT credits INTO v_credits FROM public.profiles WHERE id = p_user_id;
  IF v_credits IS NOT NULL AND v_credits > 0 THEN
    PERFORM public.allocate_tokens(
      NULL, v_pool_id, v_credits, 'legacy migration', p_user_id
    );
    v_migrated_credits := v_credits;
  END IF;

  RETURN jsonb_build_object(
    'status', 'provisioned',
    'organization_id', v_org_id,
    'pool_id', v_pool_id,
    'migrated_credits', v_migrated_credits
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.provision_my_organization(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_my_organization(UUID) TO service_role;
