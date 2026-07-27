// Organization activity log — 조직 owner/admin 만 조회.
//
// GET /api/organizations/[slug]/activity-logs?limit=50
//   최근 활동을 시간 역순으로 반환. member 는 403.
//
// RLS (activity_logs_select_admin) 도 owner/admin 만 허용하므로 이중 게이팅.

import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

import type { OrganizationRole } from '@/types/domain';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

interface ActivityLogRow {
  id: number;
  organization_id: string;
  actor_user_id: string | null;
  activity_type: string;
  target_user_id: string | null;
  target_image_id: string | null;
  target_invite_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ActivityLogEntry {
  id: number;
  activityType: string;
  actorEmail: string | null;
  targetEmail: string | null;
  targetImageId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export async function GET(request: Request, { params }: { params: { slug: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(1, Math.floor(rawLimit)), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', params.slug)
    .is('deleted_at', null)
    .maybeSingle();
  if (!org) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  const orgId = (org as { id: string }).id;

  // owner/admin 인지 확인 (RLS 정책과 동일한 조건). member/viewer 는 403.
  const { data: me } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();
  const myRole = (me as { role: OrganizationRole } | null)?.role ?? null;
  if (myRole !== 'owner' && myRole !== 'admin') {
    return apiError('FORBIDDEN', '활동 로그는 관리자만 볼 수 있어요');
  }

  const { data: logs, error } = await supabase
    .from('organization_activity_logs')
    .select(
      'id, organization_id, actor_user_id, activity_type, target_user_id, target_image_id, target_invite_id, metadata, created_at',
    )
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[activity-logs GET] query error', error);
    return apiError('INTERNAL_ERROR', '활동 로그를 불러오지 못했어요');
  }

  const rows = (logs ?? []) as ActivityLogRow[];
  const userIds = new Set<string>();
  for (const row of rows) {
    if (row.actor_user_id) userIds.add(row.actor_user_id);
    if (row.target_user_id) userIds.add(row.target_user_id);
  }

  const emailMap = new Map<string, string>();
  if (userIds.size > 0) {
    const service = createSupabaseServiceClient();
    const { data: profiles } = await service
      .from('profiles')
      .select('id, email')
      .in('id', Array.from(userIds));
    for (const p of profiles ?? []) {
      const row = p as { id: string; email: string };
      if (row.email) emailMap.set(row.id, row.email);
    }

    // 폴백: profiles 에 없거나 email 이 비어있으면 auth.admin.getUserById 로
    // 채운다. 회원가입 트리거가 누락되어 profiles 행이 없는 케이스 대응.
    const missingIds = Array.from(userIds).filter((id) => !emailMap.has(id));
    if (missingIds.length > 0) {
      const authLookups = await Promise.all(
        missingIds.map(async (id) => {
          const { data, error } = await service.auth.admin.getUserById(id);
          if (error || !data?.user?.email) return null;
          return { id, email: data.user.email };
        }),
      );
      for (const row of authLookups) {
        if (row) emailMap.set(row.id, row.email);
      }
    }
  }

  const entries: ActivityLogEntry[] = rows.map((row) => ({
    id: row.id,
    activityType: row.activity_type,
    actorEmail: row.actor_user_id ? emailMap.get(row.actor_user_id) ?? null : null,
    targetEmail: row.target_user_id ? emailMap.get(row.target_user_id) ?? null : null,
    targetImageId: row.target_image_id,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  }));

  return apiOk({ entries });
}
