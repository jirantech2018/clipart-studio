// Organization member list.
//
// GET /api/organizations/[slug]/members
//   - 조회 권한: 소속 active 멤버 (RLS members_select 로 강제)
//   - Response: 멤버 리스트 (email, account_type, role, joined_at, isMe)
//
// profiles 는 RLS 로 소유자만 조회 가능하지만, 조직 페이지에서는 같은 조직
// 멤버의 email/account_type 을 볼 필요가 있다. service role 로 필터해서 응답.

import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

import type { AccountType, OrganizationMember, OrganizationRole, OrganizationMemberStatus } from '@/types/domain';

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  // 조직 slug → id 조회 + 요청자 멤버십 확인
  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', params.slug)
    .is('deleted_at', null)
    .maybeSingle();

  if (!org) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  const orgId = (org as { id: string }).id;

  // 멤버 목록 (RLS 는 요청자가 소속 멤버여야 SELECT 허용)
  const { data: members, error } = await supabase
    .from('organization_members')
    .select('user_id, role, status, joined_at')
    .eq('organization_id', orgId)
    .order('joined_at', { ascending: true });

  if (error) {
    console.error('[members GET] query error', error);
    return apiError('FORBIDDEN', '조직 멤버만 조회할 수 있습니다');
  }

  if (!members || members.length === 0) {
    return apiOk({ members: [] });
  }

  // profiles (email, account_type) — service role 로 조회 (RLS 우회)
  const userIds = members.map((m) => (m as { user_id: string }).user_id);
  const service = createSupabaseServiceClient();
  const { data: profiles } = await service
    .from('profiles')
    .select('id, email, account_type')
    .in('id', userIds);

  const profileMap = new Map<string, { email: string; accountType: AccountType }>();
  for (const p of profiles ?? []) {
    const row = p as { id: string; email: string; account_type: AccountType };
    profileMap.set(row.id, { email: row.email, accountType: row.account_type });
  }

  const result: OrganizationMember[] = members.map((m) => {
    const row = m as {
      user_id: string;
      role: OrganizationRole;
      status: OrganizationMemberStatus;
      joined_at: string;
    };
    const p = profileMap.get(row.user_id);
    return {
      userId: row.user_id,
      email: p?.email ?? '(unknown)',
      accountType: p?.accountType ?? 'general',
      role: row.role,
      status: row.status,
      joinedAt: row.joined_at,
      isMe: row.user_id === user.id,
    };
  });

  return apiOk({ members: result });
}
