// Admin: update / delete a single prompt rule.

import { ZodError } from 'zod';

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';
import { updatePromptRuleSchema } from '@/types/schemas';

import type { PromptRule, PromptRuleCategory } from '@/types/domain';

interface RuleRow {
  id: string;
  name: string;
  category: PromptRuleCategory;
  tags: string[] | null;
  priority: number;
  enabled: boolean;
  content: string;
  created_at: string;
  updated_at: string;
}

function toDomain(row: RuleRow): PromptRule {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    tags: row.tags ?? [],
    priority: row.priority,
    enabled: row.enabled,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function requireAdmin() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: apiError('UNAUTHORIZED', '로그인이 필요합니다') } as const;
  }
  if (!isAdmin(user.email)) {
    return { error: apiError('FORBIDDEN', '관리자 전용 페이지입니다') } as const;
  }
  return { user } as const;
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  let body;
  try {
    body = updatePromptRuleSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.category !== undefined) update.category = body.category;
  if (body.tags !== undefined) update.tags = body.tags;
  if (body.priority !== undefined) update.priority = body.priority;
  if (body.enabled !== undefined) update.enabled = body.enabled;
  if (body.content !== undefined) update.content = body.content;

  if (Object.keys(update).length === 0) {
    return apiError('VALIDATION_ERROR', '변경할 필드가 없습니다');
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from('prompt_rules')
    .update(update)
    .eq('id', params.id)
    .select('id, name, category, tags, priority, enabled, content, created_at, updated_at')
    .single();

  if (error || !data) {
    console.error('[admin/prompt-rules PATCH]', error);
    return apiError('NOT_FOUND', '규칙을 찾을 수 없습니다');
  }

  return apiOk({ rule: toDomain(data as unknown as RuleRow) });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  const service = createSupabaseServiceClient();
  const { error } = await service.from('prompt_rules').delete().eq('id', params.id);

  if (error) {
    console.error('[admin/prompt-rules DELETE]', error);
    return apiError('INTERNAL_ERROR', '규칙 삭제 실패');
  }

  return apiOk({ id: params.id });
}
