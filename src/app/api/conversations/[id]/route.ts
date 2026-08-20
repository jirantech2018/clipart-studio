// Conversation Server Storage — GET (detail with messages) / PATCH (title/status) / DELETE (soft)
// Plan Ref: docs/01-plan/features/conversation-server-storage.plan.md §4 §7

export const runtime = 'nodejs';

import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import { createSupabaseServerClient } from '@/services/supabase/server';

const patchSchema = z.object({
  title: z.string().max(200).nullable().optional(),
  status: z.enum(['active', 'archived']).optional(),
});

interface ConversationMessageRow {
  id: string;
  role: 'user' | 'assistant' | 'system';
  prompt: string;
  options: unknown;
  package_plan: unknown;
  status: 'draft' | 'submitted' | 'completed' | 'failed';
  job_id: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { data: conv, error } = await supabase
    .from('conversations')
    .select(
      'id, title, status, created_at, updated_at, last_activity_at, organization_id',
    )
    .eq('id', params.id)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    console.error('[conversations/:id GET] failed', error);
    return apiError('INTERNAL_ERROR', '대화 조회 실패');
  }
  if (!conv) return apiError('NOT_FOUND', '대화를 찾을 수 없어요');

  const { data: msgs, error: msgErr } = await supabase
    .from('conversation_messages')
    .select(
      'id, role, prompt, options, package_plan, status, job_id, order_index, created_at, updated_at',
    )
    .eq('conversation_id', params.id)
    .order('order_index', { ascending: true });

  if (msgErr) {
    console.error('[conversations/:id messages] failed', msgErr);
    return apiError('INTERNAL_ERROR', '메시지 조회 실패');
  }

  const c = conv as {
    id: string;
    title: string | null;
    status: string;
    created_at: string;
    updated_at: string;
    last_activity_at: string;
    organization_id: string;
  };

  return apiOk({
    id: c.id,
    title: c.title,
    status: c.status,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    lastActivityAt: c.last_activity_at,
    organizationId: c.organization_id,
    messages: ((msgs ?? []) as ConversationMessageRow[]).map((m) => ({
      id: m.id,
      role: m.role,
      prompt: m.prompt,
      options: m.options,
      packagePlan: m.package_plan,
      status: m.status,
      jobId: m.job_id,
      orderIndex: m.order_index,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    })),
  });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
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
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다', {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;

  if (Object.keys(patch).length === 0) {
    return apiError('VALIDATION_ERROR', '변경 항목이 없어요');
  }

  const { data, error } = await supabase
    .from('conversations')
    .update(patch)
    .eq('id', params.id)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .select('id, title, status, updated_at, last_activity_at')
    .maybeSingle();

  if (error) {
    console.error('[conversations/:id PATCH] failed', error);
    return apiError('INTERNAL_ERROR', '대화 수정 실패');
  }
  if (!data) return apiError('NOT_FOUND', '대화를 찾을 수 없어요');

  const r = data as {
    id: string;
    title: string | null;
    status: string;
    updated_at: string;
    last_activity_at: string;
  };
  return apiOk({
    id: r.id,
    title: r.title,
    status: r.status,
    updatedAt: r.updated_at,
    lastActivityAt: r.last_activity_at,
  });
}

// Soft delete — status='deleted' + deleted_at=NOW().
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { data, error } = await supabase
    .from('conversations')
    .update({ status: 'deleted', deleted_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[conversations/:id DELETE] failed', error);
    return apiError('INTERNAL_ERROR', '대화 삭제 실패');
  }
  if (!data) return apiError('NOT_FOUND', '대화를 찾을 수 없어요');

  return apiOk({ id: (data as { id: string }).id });
}
