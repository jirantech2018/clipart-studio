// Plan v0.2.9 §M4-1: Super Admin Token Dashboard 데이터 소스.
//
// GET /api/admin/token-dashboard
//   response: {
//     workspaces: [{
//       id, slug, name, type,
//       ownerEmail,
//       credits,         // pool.balance
//       totalIssued,     // ledger SUM(amount) WHERE type IN ('ISSUE','TRANSFER'+incoming) AND amount > 0
//       totalUsed,       // ledger SUM(-amount) WHERE type='USE'
//       monthUsed,       // 이번 달 (KST 기준 아니고 UTC — 감사 목적)
//       memberCount,
//       lastUsedAt,
//       poolId,
//     }],
//     totals: { workspaces, credits, monthUsed }
//   }
//
// 성능:
//   - workspaces + pools + members (COUNT) + ledger (aggregate) 를 각각 한 번씩만 조회
//   - Ledger aggregate 는 pool_id 별 GROUP BY 로 Map 구성 → workspaces 와 join
//   - 이번 달은 date_trunc('month', NOW()) 로 컷
//
// 원칙 확인:
//   - profiles.credits 나 token_pools.balance 를 직접 UPDATE 하지 않는다 (조회만)
//   - admin 만 접근 (isAdmin(email))

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  type: 'personal' | 'school' | 'general';
  ownerEmail: string | null;
  credits: number;
  totalIssued: number;
  totalUsed: number;
  monthUsed: number;
  memberCount: number;
  lastUsedAt: string | null;
  poolId: string | null;
}

export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');
  if (!isAdmin(user.email)) return apiError('FORBIDDEN', '관리자만 접근할 수 있어요');

  const service = createSupabaseServiceClient();

  // 1) 조직 목록 (soft-delete 제외)
  const { data: orgRows, error: orgErr } = await service
    .from('organizations')
    .select('id, slug, name, type, owner_id')
    .is('deleted_at', null);
  if (orgErr || !orgRows) return apiError('INTERNAL_ERROR', '조직 목록 조회 실패');

  const orgIds = orgRows.map((o) => (o as { id: string }).id);
  if (orgIds.length === 0) {
    return apiOk({ workspaces: [], totals: { workspaces: 0, credits: 0, monthUsed: 0 } });
  }

  // 2) 소유자 email
  const ownerIds = Array.from(new Set((orgRows as Array<{ owner_id: string }>).map((o) => o.owner_id)));
  const emailByUserId = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: profs } = await service.from('profiles').select('id, email').in('id', ownerIds);
    for (const p of profs ?? []) {
      const r = p as { id: string; email: string | null };
      if (r.email) emailByUserId.set(r.id, r.email);
    }
  }

  // 3) pools
  const { data: poolRows } = await service
    .from('token_pools')
    .select('id, organization_id, balance')
    .in('organization_id', orgIds);
  const poolByOrgId = new Map<string, { id: string; balance: number }>();
  const orgIdByPoolId = new Map<string, string>();
  for (const row of poolRows ?? []) {
    const r = row as { id: string; organization_id: string; balance: number };
    poolByOrgId.set(r.organization_id, { id: r.id, balance: r.balance });
    orgIdByPoolId.set(r.id, r.organization_id);
  }

  // 4) 멤버 수 (status='active')
  const { data: memberRows } = await service
    .from('organization_members')
    .select('organization_id')
    .in('organization_id', orgIds)
    .eq('status', 'active');
  const memberCountByOrgId = new Map<string, number>();
  for (const row of memberRows ?? []) {
    const orgId = (row as { organization_id: string }).organization_id;
    memberCountByOrgId.set(orgId, (memberCountByOrgId.get(orgId) ?? 0) + 1);
  }

  // 5) Ledger 집계 — pool_id 별. 이번 달 USE, 누적 USE, 누적 ISSUE (양수만).
  //    Row 단위 리턴 후 앱에서 aggregate (Supabase JS 로는 GROUP BY 를 직접 못 짜므로
  //    소규모 조직 수 가정 하에 in-memory 처리. 대규모 시 SQL view 로 이관 예정).
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const poolIds = Array.from(poolByOrgId.values()).map((p) => p.id);
  const totalUsedByPoolId = new Map<string, number>();
  const monthUsedByPoolId = new Map<string, number>();
  const totalIssuedByPoolId = new Map<string, number>();
  const lastUsedAtByPoolId = new Map<string, string>();

  if (poolIds.length > 0) {
    const { data: ledgerRows } = await service
      .from('token_ledger')
      .select('pool_id, type, amount, created_at')
      .in('pool_id', poolIds);
    for (const row of ledgerRows ?? []) {
      const r = row as {
        pool_id: string;
        type: 'ISSUE' | 'TRANSFER' | 'USE' | 'REFUND' | 'ADJUST' | 'MIGRATION';
        amount: number;
        created_at: string;
      };
      if (r.type === 'USE' && r.amount < 0) {
        const used = -r.amount;
        totalUsedByPoolId.set(r.pool_id, (totalUsedByPoolId.get(r.pool_id) ?? 0) + used);
        if (new Date(r.created_at) >= monthStart) {
          monthUsedByPoolId.set(r.pool_id, (monthUsedByPoolId.get(r.pool_id) ?? 0) + used);
        }
        const prev = lastUsedAtByPoolId.get(r.pool_id);
        if (!prev || r.created_at > prev) lastUsedAtByPoolId.set(r.pool_id, r.created_at);
      } else if ((r.type === 'ISSUE' || r.type === 'TRANSFER' || r.type === 'MIGRATION') && r.amount > 0) {
        totalIssuedByPoolId.set(r.pool_id, (totalIssuedByPoolId.get(r.pool_id) ?? 0) + r.amount);
      }
    }
  }

  const workspaces: WorkspaceRow[] = (orgRows as Array<{
    id: string;
    slug: string;
    name: string;
    type: 'personal' | 'school' | 'general';
    owner_id: string;
  }>).map((o) => {
    const pool = poolByOrgId.get(o.id);
    const poolId = pool?.id ?? null;
    return {
      id: o.id,
      slug: o.slug,
      name: o.name,
      type: o.type,
      ownerEmail: emailByUserId.get(o.owner_id) ?? null,
      credits: pool?.balance ?? 0,
      totalIssued: poolId ? totalIssuedByPoolId.get(poolId) ?? 0 : 0,
      totalUsed: poolId ? totalUsedByPoolId.get(poolId) ?? 0 : 0,
      monthUsed: poolId ? monthUsedByPoolId.get(poolId) ?? 0 : 0,
      memberCount: memberCountByOrgId.get(o.id) ?? 0,
      lastUsedAt: poolId ? lastUsedAtByPoolId.get(poolId) ?? null : null,
      poolId,
    };
  });

  const totals = {
    workspaces: workspaces.length,
    credits: workspaces.reduce((s, w) => s + w.credits, 0),
    monthUsed: workspaces.reduce((s, w) => s + w.monthUsed, 0),
  };

  return apiOk({ workspaces, totals });
}
