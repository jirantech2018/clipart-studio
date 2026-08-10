// M5: Super Admin 이미지 복원.

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
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
  if (!isAdmin(user.email)) return apiError('FORBIDDEN', '관리자만 실행할 수 있어요');

  const service = createSupabaseServiceClient();
  const { data: image } = await service
    .from('images')
    .select('id, trash_status')
    .eq('id', params.id)
    .maybeSingle();
  if (!image) return apiError('NOT_FOUND', '이미지를 찾을 수 없어요');

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
    console.error('[admin image restore] update error', updErr);
    return apiError('INTERNAL_ERROR', '복원 실패');
  }

  await service.from('image_trash_logs').insert({
    image_id: params.id,
    action: 'RESTORE',
    actor_user_id: user.id,
    actor_type: 'SUPER_ADMIN',
    reason: null,
  });

  return apiOk({ id: params.id, trashStatus: 'ACTIVE', changed: true });
}
