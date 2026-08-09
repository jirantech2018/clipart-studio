// Plan v0.2.8 §M3-3 B-2: Super Admin → Organization Token Pool 지급 (ISSUE).
//
// POST /api/admin/organizations/[id]/allocate
//   body: { amount: number, memo?: string }
//   - Requester 는 ADMIN_EMAIL 과 정확히 일치해야 함 (Migration 초기 정책).
//   - Ledger 에 ISSUE row 생성 (from=NULL) + pool.balance 증가.
//   - 개인/조직 구분 없이 organization_id 하나만으로 pool 을 resolve.
//
// M4 (Admin Dashboard) 는 이 API 를 UI 로 감싸는 역할만 수행. 지금은 curl 로
// 사용 가능한 형태로 배포한다.

import { ZodError, z } from 'zod';

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import {
  PoolNotFoundError,
  allocateTokens,
  resolvePoolByOrganization,
} from '@/services/credit';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

const bodySchema = z.object({
  amount: z.number().int().positive().max(1_000_000),
  memo: z.string().trim().max(500).optional(),
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');
  if (!isAdmin(user.email)) return apiError('FORBIDDEN', '관리자만 지급할 수 있어요');

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

  // organization 존재 확인 (service_role 로 RLS 우회 — admin 확인은 위에서 통과).
  const service = createSupabaseServiceClient();
  const { data: orgRow } = await service
    .from('organizations')
    .select('id, slug, name, type')
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!orgRow) return apiError('NOT_FOUND', '조직을 찾을 수 없어요');

  let toPoolId: string;
  try {
    toPoolId = await resolvePoolByOrganization(params.id);
  } catch (err) {
    if (err instanceof PoolNotFoundError) {
      return apiError('INTERNAL_ERROR', '이 조직의 크레딧 풀이 없습니다');
    }
    throw err;
  }

  const memo = body.memo ?? `admin allocate by ${user.email ?? user.id}`;
  const result = await allocateTokens({
    fromPoolId: null, // ISSUE
    toPoolId,
    amount: body.amount,
    memo,
    actorUserId: user.id,
  });

  // 활동 로그 (감사)
  await service.from('organization_activity_logs').insert({
    organization_id: params.id,
    actor_user_id: user.id,
    activity_type: 'organization_updated',
    metadata: {
      allocate: {
        amount: body.amount,
        memo,
        transaction_id: result.transactionId,
        to_balance: result.toBalance,
      },
    },
  });

  return apiOk({
    organizationId: params.id,
    slug: (orgRow as { slug: string }).slug,
    name: (orgRow as { name: string }).name,
    poolId: toPoolId,
    amount: body.amount,
    transactionId: result.transactionId,
    balance: result.toBalance,
  });
}
