// Organization member — 개별 조작.
//
// PATCH  /api/organizations/[slug]/members/[userId]  — 역할 변경 (admin+ 만)
// DELETE /api/organizations/[slug]/members/[userId]  — 강퇴 (admin+) 또는 본인 탈퇴
//
// 안전 규칙:
//   - owner 는 다른 owner 를 강등할 수 없다 (조직에 owner 는 오직 1명 — 소유권 이전 UI 는 P5-D 예정)
//   - 마지막 owner 는 탈퇴 불가 (조직에 owner 가 아예 없어지는 상태 방지)
//   - owner 자신의 강퇴는 다른 admin 도 불가

import { ZodError } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';
import { updateMemberRoleSchema } from '@/types/schemas';

import type { OrganizationRole } from '@/types/domain';

async function loadContext(slug: string, requesterId: string) {
  const supabase = createSupabaseServerClient();
  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();
  if (!org) return { orgId: null, requesterRole: null };
  const orgId = (org as { id: string }).id;

  const { data: me } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', requesterId)
    .eq('status', 'active')
    .maybeSingle();

  return {
    orgId,
    requesterRole: (me?.role as OrganizationRole | undefined) ?? null,
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: { slug: string; userId: string } },
) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { orgId, requesterRole } = await loadContext(params.slug, user.id);
  if (!orgId) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  if (requesterRole !== 'owner' && requesterRole !== 'admin') {
    return apiError('FORBIDDEN', '조직 관리자만 역할을 변경할 수 있어요');
  }

  let body;
  try {
    body = updateMemberRoleSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요');
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  // 대상 멤버 조회
  const { data: target } = await supabase
    .from('organization_members')
    .select('role, user_id')
    .eq('organization_id', orgId)
    .eq('user_id', params.userId)
    .maybeSingle();
  if (!target) return apiError('NOT_FOUND', '해당 멤버를 찾을 수 없습니다');
  const targetRole = (target as { role: OrganizationRole }).role;

  // 안전 규칙: owner 는 owner 를 대상으로 변경 불가 (자신 포함)
  if (targetRole === 'owner') {
    return apiError('FORBIDDEN', '소유자의 역할은 소유권 이전을 통해서만 변경할 수 있어요');
  }
  // 안전 규칙: 새 role 이 owner 면 거부 (owner 승격은 소유권 이전 별도 절차)
  if (body.role === 'owner') {
    return apiError('FORBIDDEN', '소유자 지정은 소유권 이전을 통해서만 가능해요');
  }
  if (targetRole === body.role) {
    return apiOk({ id: params.userId, role: body.role, unchanged: true });
  }

  const { error: updateError } = await supabase
    .from('organization_members')
    .update({ role: body.role })
    .eq('organization_id', orgId)
    .eq('user_id', params.userId);

  if (updateError) {
    console.error('[members PATCH] update error', updateError);
    return apiError('INTERNAL_ERROR', '역할 변경 실패');
  }

  // 활동 로그
  const service = createSupabaseServiceClient();
  await service.from('organization_activity_logs').insert({
    organization_id: orgId,
    actor_user_id: user.id,
    activity_type: 'member_role_changed',
    target_user_id: params.userId,
    metadata: { from_role: targetRole, to_role: body.role },
  });

  return apiOk({ id: params.userId, role: body.role });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { slug: string; userId: string } },
) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { orgId, requesterRole } = await loadContext(params.slug, user.id);
  if (!orgId) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');

  const isSelf = params.userId === user.id;
  const canManage = requesterRole === 'owner' || requesterRole === 'admin';
  if (!isSelf && !canManage) {
    return apiError('FORBIDDEN', '본인이 아니면 조직 관리자만 강퇴할 수 있어요');
  }

  const { data: target } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', params.userId)
    .maybeSingle();
  if (!target) return apiError('NOT_FOUND', '해당 멤버를 찾을 수 없습니다');
  const targetRole = (target as { role: OrganizationRole }).role;

  // 안전 규칙: owner 는 강퇴 불가 (소유권 이전 필요). 본인이 owner 인 경우 탈퇴도 불가.
  if (targetRole === 'owner') {
    return apiError(
      'FORBIDDEN',
      '소유자는 조직을 나갈 수 없어요. 소유권 이전 후 시도해주세요.',
    );
  }

  const { error: delError } = await supabase
    .from('organization_members')
    .delete()
    .eq('organization_id', orgId)
    .eq('user_id', params.userId);

  if (delError) {
    console.error('[members DELETE] delete error', delError);
    return apiError('INTERNAL_ERROR', '멤버 제거 실패');
  }

  // 활동 로그 (관련: 조직 이미지 공유 CASCADE 도 발생하지만 여기선 별도 로그 안 남김)
  const service = createSupabaseServiceClient();
  await service.from('organization_activity_logs').insert({
    organization_id: orgId,
    actor_user_id: user.id,
    activity_type: 'member_removed',
    target_user_id: params.userId,
    metadata: { self: isSelf, previous_role: targetRole },
  });

  return apiOk({ id: params.userId, removed: true });
}
