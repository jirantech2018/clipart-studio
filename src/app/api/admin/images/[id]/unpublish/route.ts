// M5+: Super Admin 이 이미지를 공유 라이브러리에서 해제.
//
// POST /api/admin/images/[id]/unpublish
//   - 관리자 gate. is_on_community=FALSE 로 되돌리고 community_* 필드 초기화.
//   - 이미지 자체는 그대로. share 관계 및 workspace 소속 무영향.

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
    .select('id, organization_id, is_on_community')
    .eq('id', params.id)
    .maybeSingle();
  if (!image) return apiError('NOT_FOUND', '이미지를 찾을 수 없어요');

  if (!(image as { is_on_community: boolean }).is_on_community) {
    return apiOk({ id: params.id, isOnCommunity: false, changed: false });
  }

  const orgId = (image as { organization_id: string | null }).organization_id;
  const { error: updErr } = await service
    .from('images')
    .update({
      is_on_community: false,
      community_published_by: null,
      community_published_at: null,
      community_source_organization_id: null,
    })
    .eq('id', params.id);
  if (updErr) {
    console.error('[admin image unpublish] update error', updErr);
    return apiError('INTERNAL_ERROR', '공유 라이브러리 해제 실패');
  }

  if (orgId) {
    await service.from('organization_activity_logs').insert({
      organization_id: orgId,
      actor_user_id: user.id,
      activity_type: 'community_unpublished',
      metadata: { image_ids: [params.id], count: 1, via: 'admin_review' },
    });
  }

  return apiOk({ id: params.id, isOnCommunity: false, changed: true });
}
