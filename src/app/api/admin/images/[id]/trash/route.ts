// M5: Super Admin 이미지 휴지통 이동.
// body: { reason: 'LOW_QUALITY' | 'GENERATION_ERROR' | 'TEXT_ERROR' | 'DUPLICATE' | 'INAPPROPRIATE' | 'OTHER', memo?: string }

import { ZodError, z } from 'zod';

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

const REASON_LABEL: Record<string, string> = {
  LOW_QUALITY: '품질이 낮은 결과',
  GENERATION_ERROR: '생성 오류',
  TEXT_ERROR: '텍스트 오류',
  DUPLICATE: '중복 이미지',
  INAPPROPRIATE: '부적절한 이미지',
  OTHER: '기타',
};

const bodySchema = z.object({
  reason: z.enum([
    'LOW_QUALITY',
    'GENERATION_ERROR',
    'TEXT_ERROR',
    'DUPLICATE',
    'INAPPROPRIATE',
    'OTHER',
  ]),
  memo: z.string().trim().max(500).optional(),
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');
  if (!isAdmin(user.email)) return apiError('FORBIDDEN', '관리자만 실행할 수 있어요');

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse((await request.json().catch(() => ({}))) ?? {});
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  const service = createSupabaseServiceClient();
  const { data: image } = await service
    .from('images')
    .select('id, trash_status')
    .eq('id', params.id)
    .maybeSingle();
  if (!image) return apiError('NOT_FOUND', '이미지를 찾을 수 없어요');

  if ((image as { trash_status: string }).trash_status === 'TRASHED') {
    return apiOk({ id: params.id, trashStatus: 'TRASHED', changed: false });
  }

  const reasonLabel = REASON_LABEL[body.reason] ?? body.reason;
  const combinedReason = body.memo ? `${reasonLabel}: ${body.memo}` : reasonLabel;
  const now = new Date().toISOString();

  const { error: updErr } = await service
    .from('images')
    .update({
      trash_status: 'TRASHED',
      trashed_at: now,
      trashed_by: user.id,
      trash_reason: combinedReason,
      trash_actor_type: 'SUPER_ADMIN',
    })
    .eq('id', params.id);
  if (updErr) {
    console.error('[admin image trash] update error', updErr);
    return apiError('INTERNAL_ERROR', '휴지통 이동 실패');
  }

  await service.from('image_trash_logs').insert({
    image_id: params.id,
    action: 'TRASH',
    actor_user_id: user.id,
    actor_type: 'SUPER_ADMIN',
    reason: combinedReason,
  });

  return apiOk({ id: params.id, trashStatus: 'TRASHED', reason: combinedReason, changed: true });
}
