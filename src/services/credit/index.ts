// Plan v0.2.8 §M3-3: Credit Service — Organization Token Pool 기반 신규 API.
//
// 원칙 (사용자 확정):
//   1. Ledger = source of truth (append-only)
//   2. Pool.balance = 잔액 캐시
//   3. profiles.credits = UI 캐시 (RPC 내부에서 자동 sync)
//   4. Job.organization_id → Pool 로 매핑. 클라이언트가 pool_id 를 넘기지 않는다.
//   5. 신규 코드는 useOrgTokens / refundOrgTokens 만 사용. Legacy
//      reserveCredits / refundCredits 는 deprecated wrapper 로만 유지 (M3-C 에서 제거).

import { createSupabaseServiceClient } from '@/services/supabase/server';

import {
  InsufficientCreditsError,
  InsufficientPoolBalanceError,
  PoolNotFoundError,
} from './errors';
import {
  resolveMyPoolByUserId,
  resolvePoolByOrganization,
} from './pool-resolver';

export { InsufficientCreditsError, InsufficientPoolBalanceError, PoolNotFoundError };
export { resolvePoolByOrganization };

// ============================================================
// Use tokens (job 생성 시 차감)
// ============================================================
export interface UseOrgTokensInput {
  organizationId: string;
  amount: number;
  jobId: string | null;
  actorUserId: string;
}

export async function useOrgTokens({
  organizationId,
  amount,
  jobId,
  actorUserId,
}: UseOrgTokensInput): Promise<{ balance: number; transactionId: string; poolId: string }> {
  const poolId = await resolvePoolByOrganization(organizationId);
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc('use_tokens', {
    p_pool: poolId,
    p_amount: amount,
    p_job: jobId,
    p_actor: actorUserId,
  });
  if (error) {
    if (error.message.includes('INSUFFICIENT_BALANCE')) {
      throw new InsufficientPoolBalanceError(organizationId);
    }
    if (error.message.includes('POOL_NOT_FOUND')) {
      throw new PoolNotFoundError(organizationId);
    }
    throw error;
  }
  const result = data as { transaction_id: string; balance: number };
  return { balance: result.balance, transactionId: result.transaction_id, poolId };
}

// ============================================================
// Refund tokens (실패·취소 환불)
// ============================================================
export interface RefundOrgTokensInput {
  organizationId: string;
  amount: number;
  jobId: string;
  reason: string;
  /** Package slot 등 sub-unit 환불을 dedup 하기 위한 식별자. Single job 은
   *  `{ slot_id: `single-${order}` }` 형태로 order 별 dedup 을 확보한다. */
  metadata?: Record<string, unknown>;
}

export async function refundOrgTokens({
  organizationId,
  amount,
  jobId,
  reason,
  metadata,
}: RefundOrgTokensInput): Promise<{ balance: number; alreadyRefunded: boolean }> {
  if (amount <= 0) {
    return { balance: 0, alreadyRefunded: false };
  }
  const poolId = await resolvePoolByOrganization(organizationId);
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc('refund_tokens', {
    p_pool: poolId,
    p_amount: amount,
    p_job: jobId,
    p_reason: reason,
    p_metadata: metadata ?? null,
  });
  if (error) {
    if (error.message.includes('POOL_NOT_FOUND')) {
      throw new PoolNotFoundError(organizationId);
    }
    throw error;
  }
  const result = data as { balance: number; already_refunded: boolean };
  return { balance: result.balance, alreadyRefunded: result.already_refunded };
}

// ============================================================
// Allocate tokens (Super Admin 발행 · Admin 지급)
// ============================================================
export interface AllocateTokensInput {
  fromPoolId: string | null;
  toPoolId: string;
  amount: number;
  memo: string;
  actorUserId: string;
}

export async function allocateTokens({
  fromPoolId,
  toPoolId,
  amount,
  memo,
  actorUserId,
}: AllocateTokensInput): Promise<{ transactionId: string; toBalance: number }> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc('allocate_tokens', {
    p_from_pool: fromPoolId,
    p_to_pool: toPoolId,
    p_amount: amount,
    p_memo: memo,
    p_actor: actorUserId,
  });
  if (error) throw error;
  const result = data as { transaction_id: string; to_balance: number };
  return { transactionId: result.transaction_id, toBalance: result.to_balance };
}

// ============================================================
// Get balance (Pool.balance + Ledger SUM invariant 조회)
// ============================================================
export async function getOrgBalance(
  organizationId: string,
): Promise<{ poolId: string; balance: number; ledgerSum: number }> {
  const poolId = await resolvePoolByOrganization(organizationId);
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc('get_balance', { p_pool: poolId });
  if (error) throw error;
  const row = ((data as Array<{ pool_id: string; balance: number; ledger_sum: number }>) ?? [])[0];
  if (!row) throw new PoolNotFoundError(organizationId);
  return { poolId: row.pool_id, balance: row.balance, ledgerSum: Number(row.ledger_sum) };
}

// ============================================================
// Legacy wrappers (M3-C 관찰 후 제거 예정)
//
// Plan 원칙: "신규 코드에 legacy reserveCredits/refundCredits 직접 호출 없음
// (deprecated wrapper 만 유지)". Wrapper 는 세션 유저의 MY organization pool
// 로 위임. 다른 workspace 컨텍스트에서 잘못 호출되면 MY pool 에서 차감되므로
// 반드시 신규 useOrgTokens/refundOrgTokens 로 전환할 것.
// ============================================================

/** @deprecated Use useOrgTokens({ organizationId, ... }) — pool 을 explicit 하게 넘기세요. */
export async function reserveCredits(userId: string, amount: number): Promise<number> {
  const poolId = await resolveMyPoolByUserId(userId);
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc('use_tokens', {
    p_pool: poolId,
    p_amount: amount,
    p_job: null,
    p_actor: userId,
  });
  if (error) {
    if (error.message.includes('INSUFFICIENT_BALANCE')) {
      throw new InsufficientCreditsError();
    }
    throw error;
  }
  const result = data as { balance: number };
  return result.balance;
}

/** @deprecated Use refundOrgTokens({ organizationId, jobId, ... }). */
export async function refundCredits(userId: string, amount: number): Promise<number> {
  if (amount <= 0) return 0;
  // Legacy path 는 job 컨텍스트가 없어 dedup 이 불가하므로 adjust 로 보정한다.
  const poolId = await resolveMyPoolByUserId(userId);
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc('adjust_tokens', {
    p_pool: poolId,
    p_delta: amount,
    p_memo: 'legacy refundCredits wrapper',
    p_actor: userId,
  });
  if (error) throw error;
  const result = data as { balance: number };
  return result.balance;
}
