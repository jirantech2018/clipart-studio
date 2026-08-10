// M5+: Super Admin 이 이미지를 공유 라이브러리 (Community) 로 승격.
//
// POST /api/admin/images/[id]/publish
//   - 관리자 gate. 이미지 자체는 삭제·이동하지 않고 is_on_community 만 TRUE 로.
//   - community_source_organization_id 는 이미지 원본 organization_id 로 기록
//     (조직 큐레이션 UI 에서 이미 사용 중인 컬럼). 원본 org 가 없는 legacy
//     이미지는 null 로.
//   - Credit 무변화. Trash 상태와도 독립 (단, TRASHED 이미지를 승격해도 커뮤니티
//     리스트가 노출할지는 별개 필터에 달림).

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

  if ((image as { is_on_community: boolean }).is_on_community) {
    return apiOk({ id: params.id, isOnCommunity: true, changed: false });
  }

  const orgId = (image as { organization_id: string | null }).organization_id;
  const { error: updErr } = await service
    .from('images')
    .update({
      is_on_community: true,
      community_published_by: user.id,
      community_published_at: new Date().toISOString(),
      community_source_organization_id: orgId,
    })
    .eq('id', params.id);
  if (updErr) {
    console.error('[admin image publish] update error', updErr);
    return apiError('INTERNAL_ERROR', '공유 라이브러리 등록 실패');
  }

  if (orgId) {
    await service.from('organization_activity_logs').insert({
      organization_id: orgId,
      actor_user_id: user.id,
      activity_type: 'community_published',
      metadata: { image_ids: [params.id], count: 1, via: 'admin_review' },
    });
  }

  return apiOk({ id: params.id, isOnCommunity: true, changed: true });
}
