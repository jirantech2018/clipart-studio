// Organization image share — 단일 이미지 공유 해제.
//
// DELETE /api/organizations/[slug]/shares/[imageId]
//   - 이미지 소유자 또는 조직 owner/admin 이 삭제 가능 (RLS ios_delete).
//   - 실제 DELETE — audit 는 activity_logs 에 남김.

import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

export async function DELETE(
  _req: Request,
  { params }: { params: { slug: string; imageId: string } },
) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', params.slug)
    .is('deleted_at', null)
    .maybeSingle();
  if (!org) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  const orgId = (org as { id: string }).id;

  // 실제 삭제는 authenticated client 로 — RLS ios_delete 가 소유자/owner/admin 만 허용.
  const { error: delError, count } = await supabase
    .from('image_organization_shares')
    .delete({ count: 'exact' })
    .eq('organization_id', orgId)
    .eq('image_id', params.imageId);

  if (delError) {
    console.error('[shares DELETE] delete error', delError);
    return apiError('FORBIDDEN', '이 공유를 해제할 권한이 없어요');
  }
  if (!count) {
    return apiError('NOT_FOUND', '이미 공유 해제된 이미지예요');
  }

  const service = createSupabaseServiceClient();
  await service.from('organization_activity_logs').insert({
    organization_id: orgId,
    actor_user_id: user.id,
    activity_type: 'image_unshared',
    target_image_id: params.imageId,
  });

  return apiOk({ imageId: params.imageId, removed: true });
}
