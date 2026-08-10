// M5 Image Trash: POST /api/images/[id]/trash
//   body: { reason?: string }
//   - 소유자 또는 그 이미지가 속한 조직의 owner/admin 만 실행 가능
//   - 이미 TRASHED 면 idempotent 로 no-op (동일 응답)
//   - image_trash_logs 에 TRASH 이력 append

import { ZodError, z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import { resolveTrashActorType } from '@/features/library/lib/image-trash-authz';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse((await request.json().catch(() => ({}))) ?? {});
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  const service = createSupabaseServiceClient();
  const { data: image, error: imgErr } = await service
    .from('images')
    .select('id, user_id, organization_id, trash_status')
    .eq('id', params.id)
    .maybeSingle();
  if (imgErr || !image) return apiError('NOT_FOUND', '이미지를 찾을 수 없어요');

  const actorType = await resolveTrashActorType(
    service,
    image as { user_id: string; organization_id: string | null },
    user.id,
  );
  if (!actorType) return apiError('FORBIDDEN', '이 이미지를 휴지통으로 이동할 권한이 없어요');

  // idempotent — 이미 TRASHED 면 그대로 반환.
  if ((image as { trash_status: string }).trash_status === 'TRASHED') {
    return apiOk({ id: params.id, trashStatus: 'TRASHED', changed: false });
  }

  const now = new Date().toISOString();
  const { error: updErr } = await service
    .from('images')
    .update({
      trash_status: 'TRASHED',
      trashed_at: now,
      trashed_by: user.id,
      trash_reason: body.reason ?? null,
      trash_actor_type: actorType,
    })
    .eq('id', params.id);
  if (updErr) {
    console.error('[image trash] update error', updErr);
    return apiError('INTERNAL_ERROR', '휴지통 이동 실패');
  }

  await service.from('image_trash_logs').insert({
    image_id: params.id,
    action: 'TRASH',
    actor_user_id: user.id,
    actor_type: actorType,
    reason: body.reason ?? null,
  });

  return apiOk({
    id: params.id,
    trashStatus: 'TRASHED',
    trashedAt: now,
    actorType,
    changed: true,
  });
}
