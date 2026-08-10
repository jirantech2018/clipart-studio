// Plan v0.2.9 §M4-1: Super Admin — 조직 Ledger 이력 조회.
//
// GET /api/admin/organizations/[id]/ledger?limit=50&offset=0
//   response: {
//     entries: [{
//       id, transactionId, type, amount, memo,
//       actorEmail, jobId, metadata, createdAt
//     }],
//     total
//   }
//
// - admin 만 접근
// - pool 이 없는 조직은 빈 결과 (0 rows)
// - 최신순 정렬 · limit 최대 200

import { z } from 'zod';

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');
  if (!isAdmin(user.email)) return apiError('FORBIDDEN', '관리자만 접근할 수 있어요');

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '쿼리 파라미터가 올바르지 않습니다', {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }
  const { limit, offset } = parsed.data;

  const service = createSupabaseServiceClient();

  // pool_id 조회
  const { data: poolRow } = await service
    .from('token_pools')
    .select('id')
    .eq('organization_id', params.id)
    .maybeSingle();
  if (!poolRow) {
    return apiOk({ entries: [], total: 0 });
  }
  const poolId = (poolRow as { id: string }).id;

  // Ledger 조회 (최신순)
  const { data: rows, count, error } = await service
    .from('token_ledger')
    .select('id, transaction_id, type, amount, memo, actor_id, job_id, metadata, created_at', {
      count: 'exact',
    })
    .eq('pool_id', poolId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return apiError('INTERNAL_ERROR', 'Ledger 조회 실패');

  // actor email 매핑
  const actorIds = Array.from(
    new Set(
      ((rows ?? []) as Array<{ actor_id: string | null }>)
        .map((r) => r.actor_id)
        .filter((v): v is string => !!v),
    ),
  );
  const emailByUserId = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profs } = await service.from('profiles').select('id, email').in('id', actorIds);
    for (const p of profs ?? []) {
      const r = p as { id: string; email: string | null };
      if (r.email) emailByUserId.set(r.id, r.email);
    }
  }

  const entries = (rows ?? []).map((row) => {
    const r = row as {
      id: number;
      transaction_id: string;
      type: string;
      amount: number;
      memo: string | null;
      actor_id: string | null;
      job_id: string | null;
      metadata: unknown;
      created_at: string;
    };
    return {
      id: r.id,
      transactionId: r.transaction_id,
      type: r.type,
      amount: r.amount,
      memo: r.memo,
      actorEmail: r.actor_id ? emailByUserId.get(r.actor_id) ?? null : null,
      jobId: r.job_id,
      metadata: r.metadata,
      createdAt: r.created_at,
    };
  });

  return apiOk({ entries, total: count ?? entries.length });
}
