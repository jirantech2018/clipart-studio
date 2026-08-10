// Plan M4: 승인 = 실제 Organization + owner membership + token_pool (트리거)
// 을 원자적으로 생성. 서버는 approve_organization_request RPC 를 호출만 한다.

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
  if (!isAdmin(user.email)) return apiError('FORBIDDEN', '관리자만 승인할 수 있어요');

  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc('approve_organization_request', {
    p_request_id: params.id,
    p_reviewer_id: user.id,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('REQUEST_NOT_FOUND')) {
      return apiError('NOT_FOUND', '신청을 찾을 수 없어요');
    }
    if (msg.includes('ALREADY_APPROVED')) {
      return apiError('CONFLICT', '이미 승인된 신청이에요');
    }
    if (msg.includes('ALREADY_REJECTED')) {
      return apiError('CONFLICT', '이미 거절된 신청이에요. 재신청을 안내해주세요.');
    }
    if (msg.includes('SLUG_TAKEN')) {
      return apiError(
        'CONFLICT',
        '요청한 URL 이름이 이미 사용 중이에요. 신청자에게 다른 이름으로 재신청을 안내해주세요.',
      );
    }
    console.error('[org-requests approve] rpc error', error);
    return apiError('INTERNAL_ERROR', '승인 처리 실패');
  }

  const result = data as { organization_id: string; slug: string };
  return apiOk({ organizationId: result.organization_id, slug: result.slug });
}
