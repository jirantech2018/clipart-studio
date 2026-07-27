// 홈 히어로 배너 이미지 단건 — 삭제만 지원 (관리자 전용).

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
    .select('r2_key')
    .eq('id', params.id)
    .maybeSingle();

  if (!row) return apiError('NOT_FOUND', '이미지를 찾을 수 없습니다');

  const { error } = await service
    .from('home_hero_images')
    .delete()
    .eq('id', params.id);

  if (error) {
    console.error('[admin/home-hero-images DELETE]', error);
    return apiError('INTERNAL_ERROR', '이미지 삭제 실패');
  }

  await deleteObject((row as { r2_key: string }).r2_key).catch((err) => {
    console.error('[admin/home-hero-images DELETE] R2 cleanup failed', err);
  });

  return apiOk({ id: params.id });
}
