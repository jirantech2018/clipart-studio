// M5 Image Trash: POST /api/images/[id]/restore
//   - 소유자 또는 그 이미지가 속한 조직의 owner/admin 만 실행
//   - Super Admin 은 별도 admin route 에서 처리
//   - 이미 ACTIVE 면 idempotent

import { apiError, apiOk } from '@/lib/api-error';
import { resolveTrashActorType } from '@/features/library/lib/image-trash-authz';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const service = createSupabaseServiceClient();
  const { data: image } = await service
    .from('images')
    .select('id, user_id, organization_id, trash_status')
    .eq('id', params.id)
    .maybeSingle();
  if (!image) return apiError('NOT_FOUND', '이미지를 찾을 수 없어요');

  const actorType = await resolveTrashActorType(
    service,
    image as { user_id: string; organization_id: string | null },
    user.id,
  );
  if (!actorType) return apiError('FORBIDDEN', '이 이미지를 복원할 권한이 없어요');

  if ((image as { trash_status: string }).trash_status === 'ACTIVE') {
    return apiOk({ id: params.id, trashStatus: 'ACTIVE', changed: false });
  }

  const { error: updErr } = await service
    .from('images')
    .update({
      trash_status: 'ACTIVE',
      trashed_at: null,
      trashed_by: null,
      trash_reason: null,
      trash_actor_type: null,
    })
    .eq('id', params.id);
  if (updErr) {
    console.error('[image restore] update error', updErr);
    return apiError('INTERNAL_ERROR', '복원 실패');
  }

  await service.from('image_trash_logs').insert({
    image_id: params.id,
    action: 'RESTORE',
    actor_user_id: user.id,
    actor_type: actorType,
    reason: null,
  });

  return apiOk({ id: params.id, trashStatus: 'ACTIVE', actorType, changed: true });
}
