// Invite preview — 초대 링크 진입 시 페이지가 표시할 요약 정보.
//
// GET /api/invites/[token]
//   - authenticated 요구 (비로그인이면 서버 페이지에서 이미 리다이렉트)
//   - service role 로 초대·조직·프로필 조회 (RLS 우회) — 안전한 필드만 노출
//   - 만료/이미 사용/조직 삭제 등의 상태를 명확히 응답

import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

import type { InvitePreview, OrganizationRole } from '@/types/domain';

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');
  const requesterEmail = (user.email ?? '').toLowerCase();

  // 진단 로그 (P5-B 문제 해결용). 이후 정상화되면 제거.
  console.log('[invites GET] start', {
    tokenPrefix: params.token.slice(0, 12),
    tokenLen: params.token.length,
    hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    serviceRoleKeyLen: process.env.SUPABASE_SERVICE_ROLE_KEY?.length ?? 0,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });

  // service role 로 초대 조회 (RLS 는 admin+ 만 SELECT 이므로 우회 필요)
  const service = createSupabaseServiceClient();
  const { data: invite, error: inviteError } = await service
    .from('organization_invites')
    .select('email, role, invited_by, expires_at, accepted_at, revoked_at, organization_id')
    .eq('token', params.token)
    .maybeSingle();

  console.log('[invites GET] query result', {
    hasInvite: !!invite,
    error: inviteError ? { code: inviteError.code, message: inviteError.message } : null,
  });

  if (inviteError) {
    return apiError(
      'INTERNAL_ERROR',
      `초대 조회 실패 — ${inviteError.code ?? ''}: ${inviteError.message}`,
    );
  }
  if (!invite) return apiError('NOT_FOUND', '유효하지 않은 초대 링크입니다');

  const row = invite as {
    email: string;
    role: OrganizationRole;
    invited_by: string | null;
    expires_at: string;
    accepted_at: string | null;
    revoked_at: string | null;
    organization_id: string;
  };

  if (row.revoked_at) return apiError('NOT_FOUND', '이 초대는 취소되었습니다');

  // 사용됨(accepted_at 있음) 은 에러 대신 preview 상태로 반환 → UI 가 안내 문구 제어.
  const alreadyAccepted = !!row.accepted_at;

  const now = new Date();
  const expired = new Date(row.expires_at) < now;

  // 조직 정보
  const { data: org } = await service
    .from('organizations')
    .select('name, slug, deleted_at')
    .eq('id', row.organization_id)
    .maybeSingle();
  if (!org) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  const orgRow = org as { name: string; slug: string; deleted_at: string | null };
  if (orgRow.deleted_at) return apiError('NOT_FOUND', '이미 삭제된 조직입니다');

  // 초대자 이메일 (선택 — 없어도 응답)
  let inviterEmail: string | null = null;
  if (row.invited_by) {
    const { data: inviter } = await service
      .from('profiles')
      .select('email')
      .eq('id', row.invited_by)
      .maybeSingle();
    inviterEmail = (inviter as { email: string } | null)?.email ?? null;
  }

  // 이미 조직 멤버인지 확인
  const { data: existingMember } = await service
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', row.organization_id)
    .eq('user_id', user.id)
    .maybeSingle();

  const preview: InvitePreview = {
    organizationName: orgRow.name,
    organizationSlug: orgRow.slug,
    role: row.role,
    inviterEmail,
    targetEmail: row.email,
    expiresAt: row.expires_at,
    expired,
    alreadyMember: !!existingMember,
    alreadyAccepted,
    emailMismatch: row.email.toLowerCase() !== requesterEmail,
  };

  return apiOk({ invite: preview });
}
