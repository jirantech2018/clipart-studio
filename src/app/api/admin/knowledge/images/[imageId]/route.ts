// Knowledge Image 단건 메타 수정 / 삭제. 파일 자체 교체는 삭제 후 재업로드로.

import { ZodError } from 'zod';

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import { imageRowToDomain } from '@/services/knowledge';
import { deleteObject } from '@/services/r2/upload';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';
import { updateKnowledgeImageSchema } from '@/types/schemas';

import type { ReferenceType } from '@/types/domain';

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
  { params }: { params: { imageId: string } },
) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  let body;
  try {
    body = updateKnowledgeImageSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  const service = createSupabaseServiceClient();

  // is_primary=true 로 바꾸려면 기존 primary 를 내려야 unique index 를 안 다친다.
  if (body.isPrimary === true) {
    const { data: current } = await service
      .from('knowledge_images')
      .select('knowledge_id, reference_type')
      .eq('id', params.imageId)
      .maybeSingle();
    if (!current) return apiError('NOT_FOUND', '이미지를 찾을 수 없습니다');

    const targetType = (body.referenceType ??
      (current as { reference_type: ReferenceType }).reference_type) as ReferenceType;

    await service
      .from('knowledge_images')
      .update({ is_primary: false })
      .eq('knowledge_id', (current as { knowledge_id: string }).knowledge_id)
      .eq('reference_type', targetType)
      .eq('is_primary', true)
      .neq('id', params.imageId);
  }

  const update: Record<string, unknown> = {};
  if (body.caption !== undefined) update.caption = body.caption;
  if (body.viewpoint !== undefined) update.viewpoint = body.viewpoint;
  if (body.referenceType !== undefined) update.reference_type = body.referenceType;
  if (body.isPrimary !== undefined) update.is_primary = body.isPrimary;
  if (body.sortOrder !== undefined) update.sort_order = body.sortOrder;

  if (Object.keys(update).length === 0) {
    return apiError('VALIDATION_ERROR', '변경할 필드가 없습니다');
  }

  const { data, error } = await service
    .from('knowledge_images')
    .update(update)
    .eq('id', params.imageId)
    .select(
      'id, knowledge_id, r2_key, caption, viewpoint, reference_type, is_primary, sort_order, width, height, filename, created_at',
    )
    .single();

  if (error || !data) {
    console.error('[admin/knowledge/images PATCH]', error);
    return apiError('NOT_FOUND', '이미지를 찾을 수 없습니다');
  }

  return apiOk({
    image: imageRowToDomain(
      data as unknown as {
        id: string;
        knowledge_id: string;
        r2_key: string;
        caption: string;
        viewpoint: string;
        reference_type: ReferenceType;
        is_primary: boolean;
        sort_order: number;
        width: number;
        height: number;
        filename: string | null;
        created_at: string;
      },
    ),
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { imageId: string } },
) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  const service = createSupabaseServiceClient();

  // r2_key 를 먼저 확보한 뒤 DB 삭제
  const { data: row } = await service
    .from('knowledge_images')
    .select('r2_key')
    .eq('id', params.imageId)
    .maybeSingle();

  if (!row) return apiError('NOT_FOUND', '이미지를 찾을 수 없습니다');

  const { error: delError } = await service
    .from('knowledge_images')
    .delete()
    .eq('id', params.imageId);

  if (delError) {
    console.error('[admin/knowledge/images DELETE]', delError);
    return apiError('INTERNAL_ERROR', '이미지 삭제 실패');
  }

  await deleteObject((row as { r2_key: string }).r2_key).catch((err) => {
    console.error('[admin/knowledge/images DELETE] R2 cleanup failed', err);
  });

  return apiOk({ id: params.imageId });
}
