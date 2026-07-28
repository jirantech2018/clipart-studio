// 홈 히어로 배너 카탈로그 단건 — "설정 해제"만 지원.
//
// 이 화면에서는 원본 이미지를 지우는 개념이 존재하지 않는다.
// home_hero_images row 만 제거 (= 홈 배너에서 내리기) 하고 R2 파일은
// 어떤 경우에도 손대지 않는다.
//   - 큐레이션 방식 : r2_key 는 원본 이미지가 계속 참조 중
//   - 업로드 방식   : 향후 재사용 가능하도록 orphan 파일로 남겨둠
//     (필요 시 별도 R2 정리 배치에서 처리)

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
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
    .select('id')
    .eq('id', params.id)
    .maybeSingle();

  if (!row) return apiError('NOT_FOUND', '배너를 찾을 수 없습니다');

  const { error } = await service
    .from('home_hero_images')
    .delete()
    .eq('id', params.id);

  if (error) {
    console.error('[admin/home-hero-images DELETE]', error);
    return apiError('INTERNAL_ERROR', '배너 해제 실패');
  }

  return apiOk({ id: params.id });
}
