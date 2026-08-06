-- Migration: 060_credit_service_rpcs
-- Milestone: M1
-- Depends on: 001_profiles, 057_token_pools, 058_token_ledger
-- Plan Ref: docs/01-plan/features/organization-token-management.plan.md v0.2.1 §6.5, §7
--
-- Credit Service 6개 RPC. **함수만 배포**. 앱 코드는 M3 에서 이 함수들을
-- 호출로 전환한다. M1 단계에서는 이 함수들이 존재하지만 실제 트래픽이 없다.
--
-- 원칙 (Addendum v1.1 §Financial Rule):
--   1. Ledger 는 진실 (append-only).
--   2. Pool.balance 는 잔액 캐시. 직접 UPDATE 금지.
--   3. profiles.credits 는 UI 캐시. 직접 UPDATE 금지 (M3 에서 트리거 활성).
--   4. 모든 변동은 하나의 트랜잭션 안에서 Ledger insert → Pool update →
--      profiles.credits update 순서. 실패 시 전체 rollback.
--   5. 세션 변수 `app.credit_service_active` = 'true' 를 RPC 시작 시 SET
--      → M3 에서 profiles.credits Write Guard 트리거가 이 값을 확인해 통과.
--
-- 함수 시그니처:
--   allocate_tokens (from | NULL, to, amount, memo, actor) → JSONB
--     - from = NULL 이면 ISSUE (Super Admin 신규 발행)
--     - from 존재하면 TRANSFER (같은 tx_id 로 2 row)
--   use_tokens (pool, amount, job, actor) → JSONB
--   refund_tokens (pool, amount, job, reason) → JSONB (중복 방지)
--   adjust_tokens (pool, delta, memo, actor) → JSONB
--   transfer_tokens (from, to, amount, memo, actor) → JSONB (allocate 별칭)
--   get_balance (pool) → TABLE (pool_id, balance, ledger_sum)

-- ============================================================
-- 공용 helper: 특정 pool 의 personal owner (있으면) 를 반환.
-- profiles.credits 캐시 갱신 대상 유저를 결정할 때 사용.
-- ============================================================
CREATE OR REPLACE FUNCTION public._credit_pool_personal_owner(p_pool_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT o.owner_id INTO v_owner
    FROM public.token_pools p
    JOIN public.organizations o ON o.id = p.organization_id
   WHERE p.id = p_pool_id
     AND o.type = 'personal'
   LIMIT 1;
  RETURN v_owner;  -- NULL 이면 personal pool 이 아님 → cache 갱신 대상 없음
END;
$$;

-- ============================================================
-- 공용 helper: profiles.credits 캐시 갱신 (세션 변수 우회).
-- Write Guard 트리거는 M3 에서 부착되지만, RPC 는 언제나 이 함수를 통해
-- 캐시를 갱신해서 트리거 통과 규약을 지킨다.
-- ============================================================
CREATE OR REPLACE FUNCTION public._credit_sync_profile_cache(
  p_user_id UUID,
  p_balance INT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;
  PERFORM set_config('app.credit_service_active', 'true', TRUE);
  UPDATE public.profiles SET credits = p_balance WHERE id = p_user_id;
END;
$$;

-- ============================================================
-- allocate_tokens
-- ============================================================
CREATE OR REPLACE FUNCTION public.allocate_tokens(
  p_from_pool UUID,
  p_to_pool UUID,
  p_amount INT,
  p_memo TEXT,
  p_actor UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx UUID := gen_random_uuid();
  v_from_balance INT;
  v_to_balance INT;
  v_from_owner UUID;
  v_to_owner UUID;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: amount must be positive';
  END IF;
  IF p_to_pool IS NULL THEN
    RAISE EXCEPTION 'INVALID_TARGET: to_pool required';
  END IF;

  -- ============ TRANSFER (from != NULL) ============
  IF p_from_pool IS NOT NULL THEN
    IF p_from_pool = p_to_pool THEN
      RAISE EXCEPTION 'INVALID_TRANSFER: from and to must differ';
    END IF;

    -- from pool 잔액 검증 + 차감 (SELECT FOR UPDATE 로 lock)
    SELECT balance INTO v_from_balance
      FROM public.token_pools
     WHERE id = p_from_pool
     FOR UPDATE;
    IF v_from_balance IS NULL THEN
      RAISE EXCEPTION 'POOL_NOT_FOUND: from';
    END IF;
    IF v_from_balance < p_amount THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE: from pool';
    END IF;

    -- to pool lock (deadlock 방지 위해 id 순 정렬은 caller 규약 밖)
    SELECT balance INTO v_to_balance
      FROM public.token_pools
     WHERE id = p_to_pool
     FOR UPDATE;
    IF v_to_balance IS NULL THEN
      RAISE EXCEPTION 'POOL_NOT_FOUND: to';
    END IF;

    -- Ledger 2 row (같은 tx_id): from 쪽 감소 · to 쪽 증가
    INSERT INTO public.token_ledger
      (transaction_id, pool_id, from_pool_id, to_pool_id, type, amount, actor_id, memo)
    VALUES
      (v_tx, p_from_pool, p_from_pool, p_to_pool, 'TRANSFER', -p_amount, p_actor, p_memo),
      (v_tx, p_to_pool,   p_from_pool, p_to_pool, 'TRANSFER',  p_amount, p_actor, p_memo);

    -- Pool balance 갱신
    UPDATE public.token_pools SET balance = balance - p_amount WHERE id = p_from_pool
      RETURNING balance INTO v_from_balance;
    UPDATE public.token_pools SET balance = balance + p_amount WHERE id = p_to_pool
      RETURNING balance INTO v_to_balance;

    -- profiles.credits 캐시 갱신 (personal owner 만 대상)
    v_from_owner := public._credit_pool_personal_owner(p_from_pool);
    v_to_owner := public._credit_pool_personal_owner(p_to_pool);
    PERFORM public._credit_sync_profile_cache(v_from_owner, v_from_balance);
    PERFORM public._credit_sync_profile_cache(v_to_owner, v_to_balance);

    RETURN jsonb_build_object(
      'transaction_id', v_tx,
      'from_balance', v_from_balance,
      'to_balance', v_to_balance
    );
  END IF;

  -- ============ ISSUE (from = NULL) ============
  SELECT balance INTO v_to_balance
    FROM public.token_pools
   WHERE id = p_to_pool
   FOR UPDATE;
  IF v_to_balance IS NULL THEN
    RAISE EXCEPTION 'POOL_NOT_FOUND: to';
  END IF;

  INSERT INTO public.token_ledger
    (transaction_id, pool_id, from_pool_id, to_pool_id, type, amount, actor_id, memo)
  VALUES
    (v_tx, p_to_pool, NULL, p_to_pool, 'ISSUE', p_amount, p_actor, p_memo);

  UPDATE public.token_pools SET balance = balance + p_amount WHERE id = p_to_pool
    RETURNING balance INTO v_to_balance;

  v_to_owner := public._credit_pool_personal_owner(p_to_pool);
  PERFORM public._credit_sync_profile_cache(v_to_owner, v_to_balance);

  RETURN jsonb_build_object(
    'transaction_id', v_tx,
    'to_balance', v_to_balance
  );
END;
$$;

-- ============================================================
-- use_tokens
-- ============================================================
CREATE OR REPLACE FUNCTION public.use_tokens(
  p_pool UUID,
  p_amount INT,
  p_job UUID,
  p_actor UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx UUID := gen_random_uuid();
  v_balance INT;
  v_owner UUID;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: amount must be positive';
  END IF;

  SELECT balance INTO v_balance
    FROM public.token_pools
   WHERE id = p_pool
   FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'POOL_NOT_FOUND';
  END IF;
  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;

  INSERT INTO public.token_ledger
    (transaction_id, pool_id, type, amount, actor_id, job_id, memo)
  VALUES
    (v_tx, p_pool, 'USE', -p_amount, p_actor, p_job, NULL);

  UPDATE public.token_pools SET balance = balance - p_amount WHERE id = p_pool
    RETURNING balance INTO v_balance;

  v_owner := public._credit_pool_personal_owner(p_pool);
  PERFORM public._credit_sync_profile_cache(v_owner, v_balance);

  RETURN jsonb_build_object(
    'transaction_id', v_tx,
    'balance', v_balance
  );
END;
$$;

-- ============================================================
-- refund_tokens
-- Idempotency: 같은 (pool, job_id, type=REFUND) row 가 이미 있으면 skip.
-- Package 는 slot 별 환불이 있어 metadata->>'slot_id' 로 세분화 가능 (호출자 지정).
-- ============================================================
CREATE OR REPLACE FUNCTION public.refund_tokens(
  p_pool UUID,
  p_amount INT,
  p_job UUID,
  p_reason TEXT,
  p_metadata JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx UUID := gen_random_uuid();
  v_balance INT;
  v_owner UUID;
  v_existing UUID;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: amount must be positive';
  END IF;

  -- 중복 환불 방지: 같은 pool + job 조합의 REFUND row 가 있는지 확인.
  -- metadata->>'slot_id' 가 넘어오면 slot 별로 세분해서 판정 (Package 지원).
  IF p_metadata IS NOT NULL AND p_metadata ? 'slot_id' THEN
    SELECT id INTO v_existing
      FROM public.token_ledger
     WHERE pool_id = p_pool
       AND type = 'REFUND'
       AND job_id = p_job
       AND metadata->>'slot_id' = p_metadata->>'slot_id'
     LIMIT 1;
  ELSE
    SELECT id INTO v_existing
      FROM public.token_ledger
     WHERE pool_id = p_pool
       AND type = 'REFUND'
       AND job_id = p_job
     LIMIT 1;
  END IF;

  IF v_existing IS NOT NULL THEN
    SELECT balance INTO v_balance FROM public.token_pools WHERE id = p_pool;
    RETURN jsonb_build_object(
      'transaction_id', NULL,
      'balance', v_balance,
      'already_refunded', TRUE
    );
  END IF;

  SELECT balance INTO v_balance FROM public.token_pools WHERE id = p_pool FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'POOL_NOT_FOUND';
  END IF;

  INSERT INTO public.token_ledger
    (transaction_id, pool_id, type, amount, job_id, memo, metadata)
  VALUES
    (v_tx, p_pool, 'REFUND', p_amount, p_job, p_reason, p_metadata);

  UPDATE public.token_pools SET balance = balance + p_amount WHERE id = p_pool
    RETURNING balance INTO v_balance;

  v_owner := public._credit_pool_personal_owner(p_pool);
  PERFORM public._credit_sync_profile_cache(v_owner, v_balance);

  RETURN jsonb_build_object(
    'transaction_id', v_tx,
    'balance', v_balance,
    'already_refunded', FALSE
  );
END;
$$;

-- ============================================================
-- adjust_tokens (음수/양수 모두 허용, 결과 음수는 예외)
-- ============================================================
CREATE OR REPLACE FUNCTION public.adjust_tokens(
  p_pool UUID,
  p_delta INT,
  p_memo TEXT,
  p_actor UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx UUID := gen_random_uuid();
  v_balance INT;
  v_owner UUID;
BEGIN
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: delta must be non-zero';
  END IF;

  SELECT balance INTO v_balance FROM public.token_pools WHERE id = p_pool FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'POOL_NOT_FOUND';
  END IF;
  IF v_balance + p_delta < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE: adjust would result in negative';
  END IF;

  INSERT INTO public.token_ledger
    (transaction_id, pool_id, type, amount, actor_id, memo)
  VALUES
    (v_tx, p_pool, 'ADJUST', p_delta, p_actor, p_memo);

  UPDATE public.token_pools SET balance = balance + p_delta WHERE id = p_pool
    RETURNING balance INTO v_balance;

  v_owner := public._credit_pool_personal_owner(p_pool);
  PERFORM public._credit_sync_profile_cache(v_owner, v_balance);

  RETURN jsonb_build_object(
    'transaction_id', v_tx,
    'balance', v_balance
  );
END;
$$;

-- ============================================================
-- transfer_tokens (allocate_tokens 의 별칭 · from 필수)
-- ============================================================
CREATE OR REPLACE FUNCTION public.transfer_tokens(
  p_from_pool UUID,
  p_to_pool UUID,
  p_amount INT,
  p_memo TEXT,
  p_actor UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_from_pool IS NULL THEN
    RAISE EXCEPTION 'INVALID_TRANSFER: from_pool required';
  END IF;
  RETURN public.allocate_tokens(p_from_pool, p_to_pool, p_amount, p_memo, p_actor);
END;
$$;

-- ============================================================
-- get_balance
-- Pool.balance 와 Ledger SUM 을 함께 반환 → invariant 검증 편의.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_balance(p_pool UUID)
RETURNS TABLE (pool_id UUID, balance INT, ledger_sum BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS pool_id,
    p.balance,
    COALESCE(SUM(l.amount), 0)::BIGINT AS ledger_sum
  FROM public.token_pools p
  LEFT JOIN public.token_ledger l ON l.pool_id = p.id
  WHERE p.id = p_pool
  GROUP BY p.id, p.balance;
END;
$$;

-- ============================================================
-- 권한: 앱은 RPC 를 직접 호출하지 않는다 (M3 에서 service_role 만 호출).
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.allocate_tokens(UUID, UUID, INT, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.use_tokens(UUID, INT, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refund_tokens(UUID, INT, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.adjust_tokens(UUID, INT, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transfer_tokens(UUID, UUID, INT, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_balance(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.allocate_tokens(UUID, UUID, INT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.use_tokens(UUID, INT, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_tokens(UUID, INT, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.adjust_tokens(UUID, INT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.transfer_tokens(UUID, UUID, INT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_balance(UUID) TO service_role;
