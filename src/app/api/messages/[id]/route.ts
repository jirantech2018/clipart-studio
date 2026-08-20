// Conversation Server Storage — PATCH message (debounced draft update)
// Plan Ref: docs/01-plan/features/conversation-server-storage.plan.md §4 §5.2

export const runtime = 'nodejs';

import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import { createSupabaseServerClient } from '@/services/supabase/server';

const patchSchema = z.object({
  prompt: z.string().max(4000).optional(),
  options: z.unknown().optional(),
  packagePlan: z.unknown().optional(),
  status: z.enum(['draft', 'submitted', 'completed', 'failed']).optional(),
  jobId: z.string().uuid().nullable().optional(),
});

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
  if (parsed.data.prompt !== undefined) patch.prompt = parsed.data.prompt;
  if (parsed.data.options !== undefined) patch.options = parsed.data.options;
  if (parsed.data.packagePlan !== undefined) patch.package_plan = parsed.data.packagePlan;
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (parsed.data.jobId !== undefined) patch.job_id = parsed.data.jobId;

  if (Object.keys(patch).length === 0) {
    return apiError('VALIDATION_ERROR', '변경 항목이 없어요');
  }

  // RLS 정책이 conversation.user_id = auth.uid() 를 강제하므로 서버는 그대로 UPDATE.
  const { data, error } = await supabase
    .from('conversation_messages')
    .update(patch)
    .eq('id', params.id)
    .select('id, prompt, options, package_plan, status, job_id, order_index, updated_at')
    .maybeSingle();

  if (error) {
    console.error('[messages/:id PATCH] failed', error);
    return apiError('INTERNAL_ERROR', '메시지 수정 실패');
  }
  if (!data) return apiError('NOT_FOUND', '메시지를 찾을 수 없어요');

  const r = data as {
    id: string;
    prompt: string;
    options: unknown;
    package_plan: unknown;
    status: 'draft' | 'submitted' | 'completed' | 'failed';
    job_id: string | null;
    order_index: number;
    updated_at: string;
  };

  return apiOk({
    id: r.id,
    prompt: r.prompt,
    options: r.options,
    packagePlan: r.package_plan,
    status: r.status,
    jobId: r.job_id,
    orderIndex: r.order_index,
    updatedAt: r.updated_at,
  });
}
