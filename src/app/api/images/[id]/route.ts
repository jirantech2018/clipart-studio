// Design Ref: §5.4 Library card action — [공개/비공개 토글] + 링크 공유 상태 토글
// Non-Negotiable Rule 4: Community exposure requires explicit is_public=TRUE toggle only.
//   is_shareable 은 커뮤니티 노출과 무관 — URL 을 아는 로그인 회원의 접근만 허용.
// Policy: no DELETE handler — generated images are permanent library assets.

import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import { createSupabaseServerClient } from '@/services/supabase/server';

const patchSchema = z.object({
  isPublic: z.boolean().optional(),
  isShareable: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await request.json());
  } catch {
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  const { data: image } = await supabase
    .from('images')
    .select('id, is_public, is_shareable')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!image) return apiError('NOT_FOUND', '이미지를 찾을 수 없습니다');

  const update: Record<string, unknown> = {};
  if (typeof body.isPublic === 'boolean') update.is_public = body.isPublic;
  if (typeof body.isShareable === 'boolean') update.is_shareable = body.isShareable;

  if (Object.keys(update).length === 0) {
    return apiOk({
      id: image.id,
      isPublic: image.is_public,
      isShareable: image.is_shareable,
    });
  }

  const { error: updateError } = await supabase
    .from('images')
    .update(update)
    .eq('id', params.id);

  if (updateError) return apiError('INTERNAL_ERROR', '변경 실패');

  return apiOk({
    id: params.id,
    isPublic: body.isPublic ?? image.is_public,
    isShareable: body.isShareable ?? image.is_shareable,
  });
}
