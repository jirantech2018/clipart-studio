// M5 Image Review — Super Admin 전체 이미지 조회.
//
// GET /api/admin/images
//   ?status=all|active|trashed
//   ?type=all|personal|general
//   ?organizationId=<uuid>          (선택, 특정 워크스페이스만)
//   ?dateFrom=<ISO>  ?dateTo=<ISO>  (created_at 범위)
//   ?limit=<n>&offset=<n>
//
// 응답: { images: [{ id, workspace, ownerEmail, createdAt, trashStatus, ... }], total }

import { z } from 'zod';

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  status: z.enum(['all', 'active', 'trashed']).default('all'),
  type: z.enum(['all', 'personal', 'general']).default('all'),
  organizationId: z.string().uuid().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(120).default(48),
  offset: z.coerce.number().int().min(0).default(0),
});

export interface AdminImageRow {
  id: string;
  userId: string;
  ownerEmail: string | null;
  organizationId: string | null;
  organizationName: string | null;
  organizationSlug: string | null;
  organizationType: 'personal' | 'school' | 'general' | null;
  prompt: string;
  thumbnailUrl: string;
  createdAt: string;
  trashStatus: 'ACTIVE' | 'TRASHED';
  trashedAt: string | null;
  trashReason: string | null;
  trashActorType: 'USER' | 'ORG_ADMIN' | 'SUPER_ADMIN' | null;
  trashedByEmail: string | null;
}

export async function GET(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');
  if (!isAdmin(user.email)) return apiError('FORBIDDEN', '관리자만 접근할 수 있어요');

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    status: url.searchParams.get('status') ?? undefined,
    type: url.searchParams.get('type') ?? undefined,
    organizationId: url.searchParams.get('organizationId') ?? undefined,
    dateFrom: url.searchParams.get('dateFrom') ?? undefined,
    dateTo: url.searchParams.get('dateTo') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '쿼리 파라미터가 올바르지 않습니다', {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }
  const { status, type, organizationId, dateFrom, dateTo, limit, offset } = parsed.data;

  const service = createSupabaseServiceClient();

  let query = service
    .from('images')
    .select(
      'id, user_id, organization_id, prompt, thumbnail_r2_key, r2_key, created_at, trash_status, trashed_at, trashed_by, trash_reason, trash_actor_type',
      { count: 'exact' },
    )
    .eq('status', 'saved');

  if (status === 'active') query = query.eq('trash_status', 'ACTIVE');
  if (status === 'trashed') query = query.eq('trash_status', 'TRASHED');

  if (organizationId) query = query.eq('organization_id', organizationId);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', dateTo);

  query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  const { data: rows, error, count } = await query;
  if (error) {
    console.error('[admin images GET] query error', error);
    return apiError('INTERNAL_ERROR', '이미지 목록 조회 실패');
  }

  const imageRows = (rows ?? []) as Array<{
    id: string;
    user_id: string;
    organization_id: string | null;
    prompt: string;
    thumbnail_r2_key: string | null;
    r2_key: string;
    created_at: string;
    trash_status: 'ACTIVE' | 'TRASHED';
    trashed_at: string | null;
    trashed_by: string | null;
    trash_reason: string | null;
    trash_actor_type: 'USER' | 'ORG_ADMIN' | 'SUPER_ADMIN' | null;
  }>;

  // organization + profile email 매핑
  const orgIds = Array.from(new Set(imageRows.map((r) => r.organization_id).filter((v): v is string => !!v)));
  const userIds = Array.from(new Set([
    ...imageRows.map((r) => r.user_id),
    ...imageRows.map((r) => r.trashed_by).filter((v): v is string => !!v),
  ]));

  const [orgResult, profResult] = await Promise.all([
    orgIds.length > 0
      ? service.from('organizations').select('id, slug, name, type').in('id', orgIds)
      : Promise.resolve({ data: [] as Array<{ id: string; slug: string; name: string; type: 'personal' | 'school' | 'general' }> }),
    userIds.length > 0
      ? service.from('profiles').select('id, email').in('id', userIds)
      : Promise.resolve({ data: [] as Array<{ id: string; email: string | null }> }),
  ]);

  const orgByIdRaw = new Map<string, { id: string; slug: string; name: string; type: 'personal' | 'school' | 'general' }>();
  for (const o of (orgResult.data ?? []) as Array<{ id: string; slug: string; name: string; type: 'personal' | 'school' | 'general' }>) {
    orgByIdRaw.set(o.id, o);
  }
  const emailByUserId = new Map<string, string>();
  for (const p of (profResult.data ?? []) as Array<{ id: string; email: string | null }>) {
    if (p.email) emailByUserId.set(p.id, p.email);
  }

  // type 필터를 여기서 처리 (organization type 은 JOIN 후에만 알 수 있으므로).
  const filtered = imageRows.filter((r) => {
    if (type === 'all') return true;
    const org = r.organization_id ? orgByIdRaw.get(r.organization_id) : null;
    if (!org) return false;
    return org.type === type;
  });

  const images: AdminImageRow[] = filtered.map((r) => {
    const org = r.organization_id ? orgByIdRaw.get(r.organization_id) : null;
    return {
      id: r.id,
      userId: r.user_id,
      ownerEmail: emailByUserId.get(r.user_id) ?? null,
      organizationId: r.organization_id,
      organizationName: org
        ? org.type === 'personal'
          ? '내 작업실'
          : org.name
        : null,
      organizationSlug: org?.slug ?? null,
      organizationType: org?.type ?? null,
      prompt: r.prompt,
      thumbnailUrl: publicUrl(r.thumbnail_r2_key ?? r.r2_key),
      createdAt: r.created_at,
      trashStatus: r.trash_status,
      trashedAt: r.trashed_at,
      trashReason: r.trash_reason,
      trashActorType: r.trash_actor_type,
      trashedByEmail: r.trashed_by ? emailByUserId.get(r.trashed_by) ?? null : null,
    };
  });

  // total 은 서버 count (type 필터 이전 값) 로 반환한다. 무한 스크롤이 이
  // 값을 기준으로 다음 페이지 여부를 판단해야 하므로, type 필터에 의해 페이지
  // 안 표시 개수가 줄어도 이후 페이지에서 남은 이미지를 계속 받아온다.
  // 정확한 type-필터 count 는 서버 join 필터 도입 시 개선.
  return apiOk({
    images,
    total: count ?? images.length,
    limit,
    offset,
  });
}
