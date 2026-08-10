// Plan v0.2.9 §M4-1: Super Admin Token Dashboard 데이터 소스.
//
// GET /api/admin/token-dashboard
//   response: {
//     workspaces: [{ id, slug, name, type, ownerEmail, credits, memberCount, poolId }],
//     totals: {
//       workspaces,          // 전체 조직 수 (personal 포함)
//       credits,             // 전체 pool.balance 합
//       totalImages,         // status='saved' 이미지 전체 수
//       creditsUsed: { today, week, month },   // Ledger USE 기준 (Asia/Seoul boundary)
//       imagesGenerated: { today, week, month } // images.created_at 기준 (Asia/Seoul)
//     }
//   }
//
// 원칙:
//   - profiles.credits / token_pools.balance / token_ledger 직접 UPDATE 없음 (조회만)
//   - admin 만 접근 (isAdmin(email))
//   - 사용 크레딧 (Ledger USE) 과 생성 이미지 (images) 는 서로 독립적으로 집계.
//     현재는 1 image = 1 credit 이지만 향후 이미지 유형별 비용이 달라질 수 있으므로
//     한 값을 다른 값으로 대체하지 않는다.
//   - 기간 boundary 는 Asia/Seoul 기준. src/lib/time/kst-boundary.ts 참고.

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import { startOfKstDay, startOfKstMonth, startOfKstWeek } from '@/lib/time/kst-boundary';
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  type: 'personal' | 'school' | 'general';
  ownerEmail: string | null;
  credits: number;
  memberCount: number;
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

  // KST 기준 boundary
  const dayStart = startOfKstDay();
  const weekStart = startOfKstWeek();
  const monthStart = startOfKstMonth();

  // 1) 조직 목록 (soft-delete 제외)
  const { data: orgRows, error: orgErr } = await service
    .from('organizations')
    .select('id, slug, name, type, owner_id')
    .is('deleted_at', null);
  if (orgErr || !orgRows) return apiError('INTERNAL_ERROR', '조직 목록 조회 실패');

  const orgIds = (orgRows as Array<{ id: string }>).map((o) => o.id);

  // 2) 소유자 email · pools · members · 총 이미지 통계 · Ledger USE 를 병렬 조회
  const ownerIds = Array.from(
    new Set((orgRows as Array<{ owner_id: string }>).map((o) => o.owner_id)),
  );

  const [profilesResult, poolsResult, membersResult, imgTotalResult, imgTodayResult, imgWeekResult, imgMonthResult] =
    await Promise.all([
      ownerIds.length
        ? service.from('profiles').select('id, email').in('id', ownerIds)
        : Promise.resolve({ data: [] as Array<{ id: string; email: string | null }> }),
      orgIds.length
        ? service.from('token_pools').select('id, organization_id, balance').in('organization_id', orgIds)
        : Promise.resolve({ data: [] as Array<{ id: string; organization_id: string; balance: number }> }),
      orgIds.length
        ? service
            .from('organization_members')
            .select('organization_id')
            .in('organization_id', orgIds)
            .eq('status', 'active')
        : Promise.resolve({ data: [] as Array<{ organization_id: string }> }),
      service.from('images').select('id', { count: 'exact', head: true }).eq('status', 'saved'),
      service
        .from('images')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'saved')
        .gte('created_at', dayStart.toISOString()),
      service
        .from('images')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'saved')
        .gte('created_at', weekStart.toISOString()),
      service
        .from('images')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'saved')
        .gte('created_at', monthStart.toISOString()),
    ]);

  const emailByUserId = new Map<string, string>();
  for (const p of (profilesResult.data ?? []) as Array<{ id: string; email: string | null }>) {
    if (p.email) emailByUserId.set(p.id, p.email);
  }

  const poolByOrgId = new Map<string, { id: string; balance: number }>();
  for (const row of (poolsResult.data ?? []) as Array<{
    id: string;
    organization_id: string;
    balance: number;
  }>) {
    poolByOrgId.set(row.organization_id, { id: row.id, balance: row.balance });
  }

  const memberCountByOrgId = new Map<string, number>();
  for (const row of (membersResult.data ?? []) as Array<{ organization_id: string }>) {
    memberCountByOrgId.set(row.organization_id, (memberCountByOrgId.get(row.organization_id) ?? 0) + 1);
  }

  // 3) Ledger USE — 월 시작 이후 row 만 조회 (오늘/주/월 boundary 는 모두 그 이후).
  //    Supabase js 는 SUM 을 직접 지원하지 않으므로 row 를 받아 앱에서 aggregate.
  //    보통 조직당 하루 수십~수백 건. 대량화 시 SQL VIEW 로 이관 예정.
  let creditsUsedToday = 0;
  let creditsUsedWeek = 0;
  let creditsUsedMonth = 0;

  const { data: useRows } = await service
    .from('token_ledger')
    .select('amount, created_at')
    .eq('type', 'USE')
    .gte('created_at', monthStart.toISOString());
  for (const row of (useRows ?? []) as Array<{ amount: number; created_at: string }>) {
    // USE 는 음수 저장. 사용량은 절대값.
    if (row.amount >= 0) continue;
    const used = -row.amount;
    const createdAt = new Date(row.created_at);
    if (createdAt >= dayStart) creditsUsedToday += used;
    if (createdAt >= weekStart) creditsUsedWeek += used;
    creditsUsedMonth += used; // 전체 조회 자체가 month boundary
  }

  const workspaces: WorkspaceRow[] = (orgRows as Array<{
    id: string;
    slug: string;
    name: string;
    type: 'personal' | 'school' | 'general';
    owner_id: string;
  }>).map((o) => {
    const pool = poolByOrgId.get(o.id);
    return {
      id: o.id,
      slug: o.slug,
      name: o.name,
      type: o.type,
      ownerEmail: emailByUserId.get(o.owner_id) ?? null,
      credits: pool?.balance ?? 0,
      memberCount: memberCountByOrgId.get(o.id) ?? 0,
      poolId: pool?.id ?? null,
    };
  });

  const totals = {
    workspaces: workspaces.length,
    credits: workspaces.reduce((s, w) => s + w.credits, 0),
    totalImages: imgTotalResult.count ?? 0,
    creditsUsed: {
      today: creditsUsedToday,
      week: creditsUsedWeek,
      month: creditsUsedMonth,
    },
    imagesGenerated: {
      today: imgTodayResult.count ?? 0,
      week: imgWeekResult.count ?? 0,
      month: imgMonthResult.count ?? 0,
    },
  };

  return apiOk({ workspaces, totals });
}
