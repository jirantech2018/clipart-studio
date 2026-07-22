// Design Ref: §5.4 Library card action — visibility 토글.
//
// P5-C Phase A 이후: 개인 라이브러리에서 직접 is_on_community 를 조작하는
// 경로를 폐쇄. 공유 라이브러리(Community) 승격은 조직 라이브러리에서 조직
// owner 가 배치 API 로만 처리한다.
//   → POST   /api/organizations/[slug]/community/publish
//   → DELETE /api/organizations/[slug]/community/publish
//
// 이 PATCH 는 visibility 만 다룬다. isOnCommunity 요청은 403 으로 거절.

import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import { createSupabaseServerClient } from '@/services/supabase/server';

import type { ImageVisibility } from '@/types/domain';

const visibilityEnum = z.enum(['private', 'organization', 'authenticated', 'public']);

// visibility 만 허용. isOnCommunity 는 스키마에서 제외해 클라이언트가
// 실수로 보내도 조용히 무시되지 않고 명시적으로 거절되도록 아래에서 재검사.
const patchSchema = z.object({
  visibility: visibilityEnum.optional(),
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const rawBody = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // 개인의 커뮤니티 직접 공개 경로 차단 — 명시적 에러로 안내.
  if ('isOnCommunity' in rawBody) {
    return apiError(
      'FORBIDDEN',
      '공유 라이브러리 공개는 조직 라이브러리에서 조직 어드민이 진행해요',
    );
  }

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(rawBody);
  } catch {
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  const { data: image } = await supabase
    .from('images')
    .select('id, visibility, is_on_community')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!image) return apiError('NOT_FOUND', '이미지를 찾을 수 없습니다');

  const currentVisibility = image.visibility as ImageVisibility;
  const currentOnCommunity = image.is_on_community as boolean;
  const nextVisibility = body.visibility ?? currentVisibility;

  const update: Record<string, unknown> = {};
  if (typeof body.visibility === 'string') update.visibility = body.visibility;

  if (Object.keys(update).length === 0) {
    return apiOk({
      id: image.id,
      visibility: currentVisibility,
      isOnCommunity: currentOnCommunity,
    });
  }

  const { error: updateError } = await supabase
    .from('images')
    .update(update)
    .eq('id', params.id);

  if (updateError) {
    console.error('[images PATCH] update failed', updateError);
    return apiError('INTERNAL_ERROR', '변경 실패');
  }

  return apiOk({
    id: params.id,
    visibility: nextVisibility,
    isOnCommunity: currentOnCommunity,
  });
}
