// Plan M4: 신청 거절. reason 필수. SUBMITTED/REVIEWING 만 대상.

import { ZodError } from 'zod';

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';
import { rejectOrganizationRequestSchema } from '@/types/schemas';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');
  if (!isAdmin(user.email)) return apiError('FORBIDDEN', '관리자만 거절할 수 있어요');

  let body;
  try {
    body = rejectOrganizationRequestSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  const service = createSupabaseServiceClient();
  const { data: updated, error } = await service
    .from('organization_requests')
    .update({
      status: 'REJECTED',
      rejection_reason: body.reason,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    })
    .eq('id', params.id)
    .in('status', ['SUBMITTED', 'REVIEWING'])
    .select('id, status')
    .maybeSingle();

  if (error) {
    console.error('[org-requests reject] update error', error);
    return apiError('INTERNAL_ERROR', '거절 처리 실패');
  }
  if (!updated) {
    const { data: current } = await service
      .from('organization_requests')
      .select('id, status')
      .eq('id', params.id)
      .maybeSingle();
    if (!current) return apiError('NOT_FOUND', '신청을 찾을 수 없어요');
    if (current.status === 'APPROVED') {
      return apiError('CONFLICT', '이미 승인된 신청은 거절할 수 없어요');
    }
    if (current.status === 'REJECTED') {
      return apiError('CONFLICT', '이미 거절된 신청이에요');
    }
    return apiError('CONFLICT', '거절할 수 없는 상태예요');
  }
  return apiOk({ id: updated.id, status: updated.status });
}
