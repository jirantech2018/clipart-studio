// Organization reference image — 개별 삭제.
//
// DELETE /api/organizations/[slug]/reference-images/[id] — owner 만.
//   R2 객체와 DB row 모두 정리. R2 삭제 실패는 로깅만 (DB 만 정리).

import { apiError, apiOk } from '@/lib/api-error';
import { deleteObject } from '@/services/r2/upload';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

import type { OrganizationRole } from '@/types/domain';

async function loadContext(slug: string, userId: string) {
  const supabase = createSupabaseServerClient();
  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();
  if (!org) return { orgId: null, role: null as OrganizationRole | null };
  const orgId = (org as { id: string }).id;

  const { data: me } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  return {
    orgId,
    role: (me?.role as OrganizationRole | undefined) ?? null,
  };
}

export async function DELETE(
  _req: Request,
  { params }: { params: { slug: string; id: string } },
) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { orgId, role } = await loadContext(params.slug, user.id);
  if (!orgId) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  if (!role) {
    return apiError('FORBIDDEN', '조직 멤버만 삭제할 수 있어요');
  }

  const service = createSupabaseServiceClient();
  const { data: row } = await service
    .from('organization_reference_images')
    .select('id, r2_key, organization_id')
    .eq('id', params.id)
    .maybeSingle();
  if (!row || (row as { organization_id: string }).organization_id !== orgId) {
    return apiError('NOT_FOUND', '해당 이미지를 찾을 수 없어요');
  }

  // Non-owner 도 삭제 가능하도록 service_role 로 처리.
  const { error: delError } = await service
    .from('organization_reference_images')
    .delete()
    .eq('id', params.id);
  if (delError) {
    console.error('[org ref-images DELETE] db error', delError);
    return apiError('INTERNAL_ERROR', '삭제 실패');
  }

  // R2 객체 삭제 실패는 로깅만 (DB 정리는 이미 성공).
  const r2Key = (row as { r2_key: string }).r2_key;
  await deleteObject(r2Key).catch((err) => {
    console.error('[org ref-images DELETE] R2 delete failed', err);
  });

  return apiOk({ id: params.id, removed: true });
}
