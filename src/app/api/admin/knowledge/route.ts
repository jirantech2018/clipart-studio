// Admin CRUD (list + create) for Knowledge. ADMIN_EMAIL whitelist required.
// RLS 는 authenticated 를 차단하므로 이 route 는 반드시 service_role 클라이언트를 쓴다.

import { ZodError } from 'zod';

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import { knowledgeRowToDomain, loadKnowledgeList } from '@/services/knowledge';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';
import { createKnowledgeSchema } from '@/types/schemas';

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

export async function GET(request: Request) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  const url = new URL(request.url);
  const enabledOnly = url.searchParams.get('enabled') === 'true';
  const search = url.searchParams.get('search') ?? undefined;

  const knowledge = await loadKnowledgeList({ enabledOnly, search });
  return apiOk({ knowledge });
}

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  let body;
  try {
    body = createKnowledgeSchema.parse(await request.json());
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
    .from('knowledge')
    .insert({
      name: body.name,
      description: body.description,
      triggers: body.triggers,
      negative_prompt: body.negativePrompt,
      priority: body.priority,
      enabled: body.enabled,
    })
    .select('id, name, description, triggers, negative_prompt, priority, enabled, created_at, updated_at')
    .single();

  if (error || !data) {
    console.error('[admin/knowledge POST]', error);
    return apiError('INTERNAL_ERROR', 'Knowledge 생성 실패');
  }

  return apiOk(
    {
      knowledge: knowledgeRowToDomain(
        data as unknown as {
          id: string;
          name: string;
          description: string;
          triggers: string[] | null;
          negative_prompt: string;
          priority: number;
          enabled: boolean;
          created_at: string;
          updated_at: string;
        },
        [],
      ),
    },
    201,
  );
}
