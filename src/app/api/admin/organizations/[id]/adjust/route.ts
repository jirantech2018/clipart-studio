// Plan v0.2.9 §M4-1: Super Admin — 조직 pool ADJUST (수동 조정, 감사 기록).
//
// POST /api/admin/organizations/[id]/adjust
//   body: { delta: number (non-zero), memo: string (필수) }
//
// - `allocate_tokens` (ISSUE) 와 달리 delta 는 음수 (회수) 도 허용
// - Credit Service `adjustTokens` 로 pool.balance 갱신 + Ledger ADJUST row
// - `adjust_tokens` RPC 는 balance + delta < 0 이면 예외 (음수 잔액 방지)
// - admin 만 접근. memo 는 감사 필수 필드로 강제.

import { ZodError, z } from 'zod';

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import {
  InsufficientPoolBalanceError,
  PoolNotFoundError,
  adjustTokens,
} from '@/services/credit';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  delta: z
    .number()
    .int()
    .gte(-1_000_000)
    .lte(1_000_000)
    .refine((n) => n !== 0, 'delta 는 0 이 될 수 없어요'),
  memo: z.string().trim().min(1, '조정 사유는 필수예요').max(500),
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');
  if (!isAdmin(user.email)) return apiError('FORBIDDEN', '관리자만 조정할 수 있어요');

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  const service = createSupabaseServiceClient();
  const { data: orgRow } = await service
    .from('organizations')
    .select('id, slug, name, type')
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!orgRow) return apiError('NOT_FOUND', '조직을 찾을 수 없어요');

  const { data: poolRow } = await service
    .from('token_pools')
    .select('id')
    .eq('organization_id', params.id)
    .maybeSingle();
  if (!poolRow) return apiError('INTERNAL_ERROR', '이 조직의 크레딧 풀이 없습니다');
  const poolId = (poolRow as { id: string }).id;

  const memo = `admin adjust: ${body.memo}`;

  try {
    const result = await adjustTokens({
      poolId,
      delta: body.delta,
      memo,
      actorUserId: user.id,
    });

    await service.from('organization_activity_logs').insert({
      organization_id: params.id,
      actor_user_id: user.id,
      activity_type: 'organization_updated',
      metadata: {
        adjust: {
          delta: body.delta,
          memo: body.memo,
          transaction_id: result.transactionId,
          balance: result.balance,
        },
      },
    });

    return apiOk({
      organizationId: params.id,
      slug: (orgRow as { slug: string }).slug,
      name: (orgRow as { name: string }).name,
      poolId,
      delta: body.delta,
      transactionId: result.transactionId,
      balance: result.balance,
    });
  } catch (err) {
    if (err instanceof InsufficientPoolBalanceError) {
      return apiError('INSUFFICIENT_CREDITS', '조정 결과가 음수가 되어 처리할 수 없어요');
    }
    if (err instanceof PoolNotFoundError) {
      return apiError('INTERNAL_ERROR', '이 조직의 크레딧 풀이 없습니다');
    }
    throw err;
  }
}
