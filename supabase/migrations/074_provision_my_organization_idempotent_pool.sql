-- Migration: 074_provision_my_organization_idempotent_pool
-- Milestone: hotfix
-- Depends on: 062_provision_my_organization, 067_token_pools_auto_provision
--
-- 원인:
--   Migration 067 이 organizations INSERT AFTER 트리거로 token_pools row 를
--   자동 생성한다 (ON CONFLICT DO NOTHING). 이후 provision_my_organization 이
--   같은 org_id 로 `INSERT INTO token_pools ... RETURNING id INTO v_pool_id`
--   를 다시 시도하면서 UNIQUE 위반 (23505) → signup 트랜잭션 abort →
--   "Database error saving new user".
--
-- 수정:
--   062 의 token_pools 생성 로직을 "트리거가 이미 만들었을 수 있음" 을 전제로
--   변경한다. INSERT ... ON CONFLICT DO NOTHING 후 SELECT 로 pool_id 를 회수.
--   자동 트리거 자체는 유지 (학교/일반 조직에도 필요).
--
-- 부작용 없음:
--   함수 시그니처/반환 형식 동일. 기존 호출부(handle_new_user, admin 백필)
--   무변경.

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
  INSERT INTO public.organizations (name, slug, owner_id, type, max_visibility)
  VALUES (
    '내 워크스페이스',
    'personal-' || REPLACE(p_user_id::TEXT, '-', ''),
    p_user_id,
    'personal',
    'private'
  )
  RETURNING id INTO v_org_id;

  -- 3. Owner Membership.
  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  VALUES (v_org_id, p_user_id, 'owner', 'active')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  -- 4. Token Pool — Migration 067 트리거가 이미 만들었을 수 있으므로
  --    ON CONFLICT DO NOTHING 후 SELECT 로 회수한다.
  INSERT INTO public.token_pools (organization_id, balance)
  VALUES (v_org_id, 0)
  ON CONFLICT (organization_id) DO NOTHING;

  SELECT id INTO v_pool_id
    FROM public.token_pools
   WHERE organization_id = v_org_id;

  IF v_pool_id IS NULL THEN
    RAISE EXCEPTION 'POOL_PROVISIONING_FAILED: pool row missing after upsert';
  END IF;

  -- 5. Legacy profiles.credits 이관.
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

NOTIFY pgrst, 'reload schema';
