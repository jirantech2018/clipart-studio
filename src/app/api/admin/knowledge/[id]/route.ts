// Admin: single Knowledge get / update / delete.
// DELETE 는 CASCADE 로 knowledge_images 도 함께 지우고, R2 객체도 best-effort 로 정리.

import { ZodError } from 'zod';

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import { knowledgeRowToDomain, loadKnowledgeWithImages } from '@/services/knowledge';
import { deleteObject } from '@/services/r2/upload';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';
import { updateKnowledgeSchema } from '@/types/schemas';

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

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  const knowledge = await loadKnowledgeWithImages(params.id);
  if (!knowledge) return apiError('NOT_FOUND', 'Knowledge 를 찾을 수 없습니다');
  return apiOk({ knowledge });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  let body;
  try {
    body = updateKnowledgeSchema.parse(await request.json());
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
  if (body.description !== undefined) update.description = body.description;
  if (body.triggers !== undefined) update.triggers = body.triggers;
  if (body.negativePrompt !== undefined) update.negative_prompt = body.negativePrompt;
  if (body.priority !== undefined) update.priority = body.priority;
  if (body.enabled !== undefined) update.enabled = body.enabled;

  if (Object.keys(update).length === 0) {
    return apiError('VALIDATION_ERROR', '변경할 필드가 없습니다');
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from('knowledge')
    .update(update)
    .eq('id', params.id)
    .select('id, name, description, triggers, negative_prompt, priority, enabled, created_at, updated_at')
    .single();

  if (error || !data) {
    console.error('[admin/knowledge PATCH]', error);
    return apiError('NOT_FOUND', 'Knowledge 를 찾을 수 없습니다');
  }

  // 이미지까지 함께 응답 (수정 후에도 이미지 목록은 그대로여야 UI 가 편함)
  const full = await loadKnowledgeWithImages(params.id);
  return apiOk({
    knowledge: full ?? knowledgeRowToDomain(
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
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  const service = createSupabaseServiceClient();

  // 삭제 전에 R2 정리를 위해 이미지 r2_key 를 먼저 수집.
  const { data: imgs } = await service
    .from('knowledge_images')
    .select('r2_key')
    .eq('knowledge_id', params.id);

  const { error: delError } = await service
    .from('knowledge')
    .delete()
    .eq('id', params.id);

  if (delError) {
    console.error('[admin/knowledge DELETE]', delError);
    return apiError('INTERNAL_ERROR', 'Knowledge 삭제 실패');
  }

  // R2 객체는 best-effort — DB 는 CASCADE 로 이미 정리됨.
  for (const row of imgs ?? []) {
    const key = (row as { r2_key: string }).r2_key;
    await deleteObject(key).catch((err) => {
      console.error('[admin/knowledge DELETE] R2 cleanup failed', key, err);
    });
  }

  return apiOk({ id: params.id });
}
