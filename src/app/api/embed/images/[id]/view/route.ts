// Public 이미지 view 이벤트 기록 API — embed 카드 클릭 시 fire-and-forget.
//
// 익명 방문자도 카운트되므로 user_id NULL 로 INSERT (Migration 077 이
// column NULLABLE 처리). service_role 사용, RLS 무시.
// 응답은 { ok: true } 만. 카운트는 다음 SSR/refetch 시 반영.

export const runtime = 'nodejs';

import { apiError, apiOk } from '@/lib/api-error';
import { createSupabaseServiceClient } from '@/services/supabase/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const id = params.id;
  if (!UUID_RE.test(id)) {
    return apiError('VALIDATION_ERROR', '잘못된 요청입니다');
  }

  const service = createSupabaseServiceClient();

  // 존재하는 공개 이미지에 대해서만 카운트 (스팸/무의미 카운트 최소화).
  const { data: img } = await service
    .from('images')
    .select('id')
    .eq('id', id)
    .eq('is_on_community', true)
    .eq('status', 'saved')
    .maybeSingle();
  if (!img) {
    return apiError('NOT_FOUND', '이미지를 찾을 수 없어요');
  }

  const { error } = await service.from('download_events').insert({
    image_id: id,
    event_type: 'view',
    user_id: null,
  });
  if (error) {
    console.error('[api/embed/images/:id/view] insert failed', error);
    return apiError('INTERNAL_ERROR', '기록 실패');
  }

  return apiOk({ ok: true });
}
