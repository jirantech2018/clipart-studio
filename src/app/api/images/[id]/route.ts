// Design Ref: §5.4 Library card action — visibility 토글 + Community 승격
// Non-Negotiable Rule 4: Community exposure requires explicit is_on_community=TRUE only.
//   visibility 는 접근 범위, is_on_community 는 /community 페이지 노출 여부. 두 값은 독립.
// Policy: no DELETE handler — generated images are permanent library assets.

import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import { createSupabaseServerClient } from '@/services/supabase/server';

import type { ImageVisibility } from '@/types/domain';

const visibilityEnum = z.enum(['private', 'organization', 'authenticated', 'public']);

const patchSchema = z.object({
  visibility: visibilityEnum.optional(),
  isOnCommunity: z.boolean().optional(),
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
    .select('id, visibility, is_on_community')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!image) return apiError('NOT_FOUND', '이미지를 찾을 수 없습니다');

  const currentVisibility = image.visibility as ImageVisibility;
  const currentOnCommunity = image.is_on_community as boolean;
  const nextVisibility = body.visibility ?? currentVisibility;
  const nextOnCommunity = body.isOnCommunity ?? currentOnCommunity;

  // 정합성 검증: Community 노출은 visibility >= authenticated 일 때만 허용.
  if (
    nextOnCommunity &&
    nextVisibility !== 'authenticated' &&
    nextVisibility !== 'public'
  ) {
    return apiError(
      'VALIDATION_ERROR',
      'Community 노출은 visibility 가 authenticated 이상일 때만 가능해요',
    );
  }

  const update: Record<string, unknown> = {};
  if (typeof body.visibility === 'string') update.visibility = body.visibility;
  if (typeof body.isOnCommunity === 'boolean') update.is_on_community = body.isOnCommunity;

  if (Object.keys(update).length === 0) {
    return apiOk({
      id: image.id,
      visibility: currentVisibility,
      isOnCommunity: currentOnCommunity,
    });
  }

  // Migrate phase 임시 dual-write (Contract 실행 후 자동으로 무효화됨)
  //
  // community_images 뷰가 아직 옛 컬럼도 조건에 포함해서 (033b: `is_public =
  // TRUE OR is_on_community = TRUE`), 옛 이미지의 is_public 이 TRUE 상태로
  // 남아있으면 새 앱이 is_on_community 를 FALSE 로 내려도 뷰가 여전히 노출한다.
  // 앱이 계산한 다음 상태를 기준으로 legacy 두 컬럼도 동기화해서 이 gap 을 없앤다.
  update.is_public =
    nextOnCommunity && (nextVisibility === 'authenticated' || nextVisibility === 'public');
  update.is_shareable =
    nextVisibility === 'authenticated' || nextVisibility === 'public';

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
    isOnCommunity: nextOnCommunity,
  });
}
