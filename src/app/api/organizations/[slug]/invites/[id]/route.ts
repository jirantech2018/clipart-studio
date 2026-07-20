// Organization invite — 개별 취소 (revoke).
//
// DELETE /api/organizations/[slug]/invites/[id]  — admin+ 만
//   실제 삭제 대신 revoked_at 세팅 (감사 로그 유지).

import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

import type { OrganizationRole } from '@/types/domain';

export async function DELETE(
  _req: Request,
  { params }: { params: { slug: string; id: string } },
) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  // 조직 slug → id
  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', params.slug)
    .is('deleted_at', null)
    .maybeSingle();
  if (!org) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  const orgId = (org as { id: string }).id;

  // 요청자 역할 확인
  const { data: me } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();
  const requesterRole = (me?.role as OrganizationRole | undefined) ?? null;
  if (requesterRole !== 'owner' && requesterRole !== 'admin') {
    return apiError('FORBIDDEN', '조직 관리자만 초대를 취소할 수 있어요');
  }

  // 초대 확인 (혹시 다른 조직 초대 id 인지 방어)
  const { data: invite } = await supabase
    .from('organization_invites')
    .select('id, organization_id, accepted_at, revoked_at')
    .eq('id', params.id)
    .maybeSingle();
  if (!invite || (invite as { organization_id: string }).organization_id !== orgId) {
    return apiError('NOT_FOUND', '초대를 찾을 수 없습니다');
  }
  if ((invite as { accepted_at: string | null }).accepted_at) {
    return apiError('CONFLICT', '이미 수락된 초대는 취소할 수 없어요');
  }
  if ((invite as { revoked_at: string | null }).revoked_at) {
    return apiOk({ id: params.id, alreadyRevoked: true });
  }

  const { error: updateError } = await supabase
    .from('organization_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', params.id);

  if (updateError) {
    console.error('[invites DELETE] update error', updateError);
    return apiError('INTERNAL_ERROR', '초대 취소 실패');
  }

  const service = createSupabaseServiceClient();
  await service.from('organization_activity_logs').insert({
    organization_id: orgId,
    actor_user_id: user.id,
    activity_type: 'invite_revoked',
    target_invite_id: params.id,
  });

  return apiOk({ id: params.id, revoked: true });
}
