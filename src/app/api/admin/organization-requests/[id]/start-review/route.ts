// Plan M4: SUBMITTED → REVIEWING 상태 전이.

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
  if (!isAdmin(user.email)) return apiError('FORBIDDEN', '관리자만 접근할 수 있어요');

  const service = createSupabaseServiceClient();
  // SUBMITTED 인 것만 REVIEWING 으로 이동. 이미 REVIEWING/APPROVED/REJECTED 는 no-op.
  const { data: updated, error } = await service
    .from('organization_requests')
    .update({ status: 'REVIEWING', review_started_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('status', 'SUBMITTED')
    .select('id, status')
    .maybeSingle();

  if (error) {
    console.error('[org-requests start-review] update error', error);
    return apiError('INTERNAL_ERROR', '상태 변경 실패');
  }
  if (!updated) {
    // 이미 다른 상태였음. 현재 상태를 다시 조회해 반환.
    const { data: current } = await service
      .from('organization_requests')
      .select('id, status')
      .eq('id', params.id)
      .maybeSingle();
    if (!current) return apiError('NOT_FOUND', '신청을 찾을 수 없어요');
    return apiOk({ id: current.id, status: current.status, changed: false });
  }
  return apiOk({ id: updated.id, status: updated.status, changed: true });
}
