// 이 이미지가 공유된 조직 목록.
//
// GET /api/images/[id]/shared-orgs
//   - 이미지 소유자만 조회 가능 (본인의 공유 상태를 관리할 목적).
//   - Response: { orgs: [{ slug, name, sharedAt }] }

import { apiError, apiOk } from '@/lib/api-error';
import { createSupabaseServerClient } from '@/services/supabase/server';

interface SharedOrg {
  slug: string;
  name: string;
  organizationId: string;
  sharedAt: string;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  // 이미지 소유권 확인
  const { data: img } = await supabase
    .from('images')
    .select('id, user_id')
    .eq('id', params.id)
    .maybeSingle();
  if (!img) return apiError('NOT_FOUND', '이미지를 찾을 수 없습니다');
  if ((img as { user_id: string }).user_id !== user.id) {
    return apiError('FORBIDDEN', '이 이미지의 공유 정보를 볼 권한이 없어요');
  }

  const { data, error } = await supabase
    .from('image_organization_shares')
    .select('shared_at, organization_id, organizations!inner(slug, name)')
    .eq('image_id', params.id)
    .is('organizations.deleted_at', null)
    .order('shared_at', { ascending: false });

  if (error) {
    console.error('[shared-orgs GET] query error', error);
    return apiError('INTERNAL_ERROR', '공유 조직 조회 실패');
  }

  const orgs: SharedOrg[] = (data ?? []).map((row) => {
    const r = row as unknown as {
      shared_at: string;
      organization_id: string;
      organizations: { slug: string; name: string };
    };
    return {
      slug: r.organizations.slug,
      name: r.organizations.name,
      organizationId: r.organization_id,
      sharedAt: r.shared_at,
    };
  });

  return apiOk({ orgs });
}
