// Admin CRUD (list + create) for prompt_rules. ADMIN_EMAIL whitelist required.

import { ZodError } from 'zod';

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';
import { createPromptRuleSchema } from '@/types/schemas';

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

export async function GET() {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from('prompt_rules')
    .select('id, name, category, tags, priority, enabled, content, created_at, updated_at')
    .order('category', { ascending: true })
    .order('priority', { ascending: true });

  if (error) {
    console.error('[admin/prompt-rules GET]', error);
    return apiError('INTERNAL_ERROR', '규칙 목록을 불러오지 못했습니다');
  }

  const rules = (data ?? []).map((r) => toDomain(r as unknown as RuleRow));
  return apiOk({ rules });
}

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  let body;
  try {
    body = createPromptRuleSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from('prompt_rules')
    .insert({
      name: body.name,
      category: body.category,
      tags: body.tags,
      priority: body.priority,
      enabled: body.enabled,
      content: body.content,
    })
    .select('id, name, category, tags, priority, enabled, content, created_at, updated_at')
    .single();

  if (error || !data) {
    console.error('[admin/prompt-rules POST]', error);
    return apiError('INTERNAL_ERROR', '규칙 생성 실패');
  }

  return apiOk({ rule: toDomain(data as unknown as RuleRow) }, 201);
}
