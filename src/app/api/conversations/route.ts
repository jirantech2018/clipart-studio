// Conversation Server Storage — GET (list) + POST (create)
// Plan Ref: docs/01-plan/features/conversation-server-storage.plan.md §4
//
// 대화 목록 조회 · 신규 대화 생성. 유저 소유만 (RLS 로 이중 강제).

export const runtime = 'nodejs';

import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import { createSupabaseServerClient } from '@/services/supabase/server';

const listQuerySchema = z.object({
  organizationSlug: z.string().min(1).max(64),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().datetime().nullable().optional(),
});

const createBodySchema = z.object({
  // 클라이언트가 UUID 를 미리 생성해 넘기면 그대로 사용 (idempotent 재시도 안전).
  id: z.string().uuid().optional(),
  organizationSlug: z.string().min(1).max(64),
});

export async function GET(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const url = new URL(request.url);
  const parsed = listQuerySchema.safeParse({
    organizationSlug: url.searchParams.get('organizationSlug') ?? '',
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor'),
  });
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다', {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const { organizationSlug, limit, cursor } = parsed.data;

  // slug → organization_id 매핑 (개인 워크스페이스 slug 는 hidden 형식).
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', organizationSlug)
    .is('deleted_at', null)
    .maybeSingle();
  if (!orgRow) {
    return apiError('NOT_FOUND', '워크스페이스를 찾을 수 없어요');
  }
  const organizationId = (orgRow as { id: string }).id;

  let query = supabase
    .from('conversations')
    .select('id, title, status, created_at, updated_at, last_activity_at')
    .eq('user_id', user.id)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('last_activity_at', { ascending: false })
    .limit(limit);

  if (cursor) {
    query = query.lt('last_activity_at', cursor);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[conversations GET] query failed', error);
    return apiError('INTERNAL_ERROR', '대화 목록 조회 실패');
  }

  const rows = (data ?? []) as Array<{
    id: string;
    title: string | null;
    status: string;
    created_at: string;
    updated_at: string;
    last_activity_at: string;
  }>;

  const nextCursor = rows.length === limit ? rows[rows.length - 1]!.last_activity_at : null;

  return apiOk({
    conversations: rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastActivityAt: r.last_activity_at,
    })),
    nextCursor,
  });
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }
  const parsed = createBodySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다', {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const { id, organizationSlug } = parsed.data;

  const { data: orgRow } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', organizationSlug)
    .is('deleted_at', null)
    .maybeSingle();
  if (!orgRow) {
    return apiError('NOT_FOUND', '워크스페이스를 찾을 수 없어요');
  }
  const organizationId = (orgRow as { id: string }).id;

  // 조직 멤버십 확인 — RLS 로도 막히지만 명확한 에러 코드가 낫다.
  const { data: member } = await supabase
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();
  if (!member) {
    return apiError('FORBIDDEN', '이 조직의 멤버가 아니에요');
  }

  // id 가 이미 있으면 그 값 그대로. 재요청 시 UNIQUE PK 충돌하면 이미 만든 것으로 간주.
  const insertPayload: Record<string, unknown> = {
    user_id: user.id,
    organization_id: organizationId,
  };
  if (id) insertPayload.id = id;

  const { data, error } = await supabase
    .from('conversations')
    .insert(insertPayload)
    .select('id, title, status, created_at, updated_at, last_activity_at')
    .single();

  if (error) {
    // 이미 존재하는 id 로 재요청한 경우 200 OK 로 회수.
    if (error.code === '23505' && id) {
      const { data: existing } = await supabase
        .from('conversations')
        .select('id, title, status, created_at, updated_at, last_activity_at')
        .eq('id', id)
        .maybeSingle();
      if (existing) {
        const r = existing as {
          id: string;
          title: string | null;
          status: string;
          created_at: string;
          updated_at: string;
          last_activity_at: string;
        };
        return apiOk({
          id: r.id,
          title: r.title,
          status: r.status,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          lastActivityAt: r.last_activity_at,
        });
      }
    }
    console.error('[conversations POST] insert failed', error);
    return apiError('INTERNAL_ERROR', '대화 생성 실패');
  }

  const r = data as {
    id: string;
    title: string | null;
    status: string;
    created_at: string;
    updated_at: string;
    last_activity_at: string;
  };

  return apiOk(
    {
      id: r.id,
      title: r.title,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastActivityAt: r.last_activity_at,
    },
    201,
  );
}
