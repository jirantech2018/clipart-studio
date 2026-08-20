// Conversation Server Storage — POST message (upsert)
// Plan Ref: docs/01-plan/features/conversation-server-storage.plan.md §4
//
// 클라이언트가 새 Block(draft) 을 만들 때 호출. id 를 미리 넘기면 idempotent.

export const runtime = 'nodejs';

import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import { createSupabaseServerClient } from '@/services/supabase/server';

const bodySchema = z.object({
  id: z.string().uuid().optional(),
  role: z.enum(['user', 'assistant', 'system']).default('user'),
  prompt: z.string().max(4000).default(''),
  options: z.unknown().optional(),
  packagePlan: z.unknown().optional(),
  status: z.enum(['draft', 'submitted', 'completed', 'failed']).default('draft'),
  orderIndex: z.number().int().min(0).max(1000).optional(),
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
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
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다', {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  // conversation 소유 확인 (RLS 도 있지만 명확한 404 반환).
  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!conv) return apiError('NOT_FOUND', '대화를 찾을 수 없어요');

  // orderIndex 미제공 시 마지막 + 1.
  let orderIndex = parsed.data.orderIndex;
  if (orderIndex === undefined) {
    const { data: last } = await supabase
      .from('conversation_messages')
      .select('order_index')
      .eq('conversation_id', params.id)
      .order('order_index', { ascending: false })
      .limit(1)
      .maybeSingle();
    orderIndex = last ? (last as { order_index: number }).order_index + 1 : 0;
  }

  const payload: Record<string, unknown> = {
    conversation_id: params.id,
    role: parsed.data.role,
    prompt: parsed.data.prompt,
    options: parsed.data.options ?? null,
    package_plan: parsed.data.packagePlan ?? null,
    status: parsed.data.status,
    order_index: orderIndex,
  };
  if (parsed.data.id) payload.id = parsed.data.id;

  const { data, error } = await supabase
    .from('conversation_messages')
    .insert(payload)
    .select('id, role, prompt, options, package_plan, status, job_id, order_index, created_at, updated_at')
    .single();

  if (error) {
    // 이미 있는 id 로 재요청 → 회수해서 반환.
    if (error.code === '23505' && parsed.data.id) {
      const { data: existing } = await supabase
        .from('conversation_messages')
        .select('id, role, prompt, options, package_plan, status, job_id, order_index, created_at, updated_at')
        .eq('id', parsed.data.id)
        .maybeSingle();
      if (existing) return apiOk(shapeMessage(existing));
    }
    console.error('[messages POST] insert failed', error);
    return apiError('INTERNAL_ERROR', '메시지 생성 실패');
  }

  return apiOk(shapeMessage(data), 201);
}

function shapeMessage(row: unknown) {
  const r = row as {
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
  };
  return {
    id: r.id,
    role: r.role,
    prompt: r.prompt,
    options: r.options,
    packagePlan: r.package_plan,
    status: r.status,
    jobId: r.job_id,
    orderIndex: r.order_index,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
