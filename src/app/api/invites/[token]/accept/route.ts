// Invite accept — 로그인 사용자가 초대를 수락한다.
//
// POST /api/invites/[token]/accept
//   - authenticated 요구
//   - 서버가 로그인 사용자 이메일 vs 초대 이메일 정확히 일치 검증
//   - service role 로 organization_members INSERT + invites accepted_at 세팅

import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

import type { OrganizationRole } from '@/types/domain';

export async function POST(_req: Request, { params }: { params: { token: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');
  const requesterEmail = (user.email ?? '').toLowerCase();

  const service = createSupabaseServiceClient();
  const { data: invite } = await service
    .from('organization_invites')
    .select('id, organization_id, email, role, expires_at, accepted_at, revoked_at')
    .eq('token', params.token)
    .maybeSingle();

  if (!invite) return apiError('NOT_FOUND', '유효하지 않은 초대 링크입니다');

  const row = invite as {
    id: string;
    organization_id: string;
    email: string;
    role: OrganizationRole;
    expires_at: string;
    accepted_at: string | null;
    revoked_at: string | null;
  };

  if (row.revoked_at) return apiError('NOT_FOUND', '이 초대는 취소되었습니다');
  if (row.accepted_at) return apiError('CONFLICT', '이 초대는 이미 사용되었습니다');
  if (new Date(row.expires_at) < new Date()) {
    return apiError('CONFLICT', '이 초대는 만료되었어요. 관리자에게 재발송을 요청해주세요.');
  }
  if (row.email.toLowerCase() !== requesterEmail) {
    return apiError(
      'FORBIDDEN',
      '이 초대는 다른 이메일로 발송됐어요. 초대 대상 이메일로 로그인 후 다시 시도해주세요.',
    );
  }

  // 이미 조직 멤버인지 (double invite 방어)
  const { data: existing } = await service
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', row.organization_id)
    .eq('user_id', user.id)
    .maybeSingle();

  const { data: org } = await service
    .from('organizations')
    .select('slug, deleted_at')
    .eq('id', row.organization_id)
    .maybeSingle();
  if (!org || (org as { deleted_at: string | null }).deleted_at) {
    return apiError('NOT_FOUND', '이미 삭제된 조직입니다');
  }
  const orgSlug = (org as { slug: string }).slug;

  if (existing) {
    // 이미 멤버라면 초대만 accepted_at 세팅 후 정상 응답 (idempotent)
    await service
      .from('organization_invites')
      .update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
      .eq('id', row.id);
    return apiOk({ organizationSlug: orgSlug, alreadyMember: true });
  }

  // 멤버 INSERT (service role — RLS 우회, 서버가 이미 이메일 검증 완료)
  const { error: memberError } = await service
    .from('organization_members')
    .insert({
      organization_id: row.organization_id,
      user_id: user.id,
      role: row.role,
      status: 'active',
    });
  if (memberError) {
    console.error('[invite accept] member insert error', memberError);
    return apiError('INTERNAL_ERROR', '가입 처리 실패');
  }

  // 초대 세팅
  await service
    .from('organization_invites')
    .update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
    .eq('id', row.id);

  // 활동 로그
  await service.from('organization_activity_logs').insert({
    organization_id: row.organization_id,
    actor_user_id: user.id,
    activity_type: 'member_joined',
    target_user_id: user.id,
    target_invite_id: row.id,
    metadata: { role: row.role },
  });

  return apiOk({ organizationSlug: orgSlug, joined: true });
}
