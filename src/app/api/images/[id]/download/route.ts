// Design Ref: §4.2 POST /api/images/:id/download — logs event, returns public URL
// Plan SC: KPI reuse-rate depends on download_events. Non-owner public images can also be downloaded.
// Uses service client for download_events insert (dl_insert has no policy — service-role only).

import { apiError, apiOk } from '@/lib/api-error';
import { publicUrl } from '@/services/r2/upload';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  // RLS ensures we only see own images or is_public=TRUE ones.
  const { data: image } = await supabase
    .from('images')
    .select('id, user_id, r2_key, status, is_public')
    .eq('id', params.id)
    .maybeSingle();

  if (!image) return apiError('NOT_FOUND', '이미지를 찾을 수 없습니다');

  const isOwner = image.user_id === user.id;
  if (!isOwner && !image.is_public) {
    return apiError('FORBIDDEN', '이 이미지는 다운로드할 수 없습니다');
  }
  if (isOwner && image.status !== 'saved') {
    return apiError('VALIDATION_ERROR', '저장된 이미지만 다운로드할 수 있습니다', {
      currentStatus: image.status,
    });
  }

  const service = createSupabaseServiceClient();
  await service.from('download_events').insert({
    user_id: user.id,
    image_id: image.id,
    event_type: 'download',
  });

  return apiOk({
    downloadUrl: publicUrl(image.r2_key),
    imageId: image.id,
  });
}
