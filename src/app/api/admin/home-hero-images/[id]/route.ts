// 홈 히어로 배너 이미지 단건 — 삭제만 지원 (관리자 전용).
//
// 두 방식이 공존하므로 R2 파일 삭제는 조건부:
//   source_image_id 세팅됨 (큐레이션) → home_hero_images row 만 지우고
//     R2 파일은 원본 이미지가 계속 사용 중이므로 절대 삭제하지 않는다.
//   source_image_id NULL (파일 업로드) → 배너 전용으로 올린 파일이라
//     row 삭제와 함께 R2 파일도 정리.

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import { deleteObject } from '@/services/r2/upload';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

async function requireAdmin() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: apiError('UNAUTHORIZED', '로그인이 필요합니다') } as const;
  }
  if (!isAdmin(user.email)) {
    return { error: apiError('FORBIDDEN', '관리자 전용 페이지입니다') } as const;
  }
  return { user } as const;
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireAdmin();
  if ('error' in gate) return gate.error;

  const service = createSupabaseServiceClient();

  const { data: row } = await service
    .from('home_hero_images')
    .select('r2_key, source_image_id')
    .eq('id', params.id)
    .maybeSingle();

  if (!row) return apiError('NOT_FOUND', '이미지를 찾을 수 없습니다');

  const banner = row as { r2_key: string; source_image_id: string | null };

  const { error } = await service
    .from('home_hero_images')
    .delete()
    .eq('id', params.id);

  if (error) {
    console.error('[admin/home-hero-images DELETE]', error);
    return apiError('INTERNAL_ERROR', '배너 해제 실패');
  }

  // 큐레이션 방식이면 R2 파일은 원본 이미지의 것 → 절대 지우면 안 됨.
  // 업로드 방식일 때만 R2 정리.
  if (!banner.source_image_id) {
    await deleteObject(banner.r2_key).catch((err) => {
      console.error('[admin/home-hero-images DELETE] R2 cleanup failed', err);
    });
  }

  return apiOk({ id: params.id });
}
