// Streams the actual image bytes from R2 through this Route Handler.
// Doing this server-side sidesteps R2 CORS restrictions (public buckets don't
// send Access-Control-Allow-Origin by default) and guarantees that the browser
// treats the response as a file download via Content-Disposition: attachment.
// Also logs the download_events row for the reuse-rate KPI.

export const runtime = 'nodejs';
export const maxDuration = 30;

import { apiError } from '@/lib/api-error';
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
    .select('id, user_id, r2_key, status, is_public, model')
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

  // Log the download event (best-effort; a failure here shouldn't block the download).
  const service = createSupabaseServiceClient();
  await service
    .from('download_events')
    .insert({
      user_id: user.id,
      image_id: image.id,
      event_type: 'download',
    })
    .then((result) => {
      if (result.error) {
        console.error('[download] download_events insert failed', result.error);
      }
    });

  // Fetch the actual bytes from R2. Server-to-server: no CORS involved.
  const r2Key = image.r2_key as string;
  const upstreamUrl = publicUrl(r2Key);
  const upstream = await fetch(upstreamUrl);
  if (!upstream.ok || !upstream.body) {
    return apiError('INTERNAL_ERROR', '이미지 파일을 가져오지 못했어요', {
      status: upstream.status,
    });
  }

  const ext = r2Key.split('.').pop()?.toLowerCase() ?? 'png';
  const contentType =
    upstream.headers.get('content-type') ??
    (ext === 'webp' ? 'image/webp' : 'image/png');
  const contentLength = upstream.headers.get('content-length');

  const filename = `clipart-${image.id}.${ext === 'webp' ? 'webp' : 'png'}`;

  const headers = new Headers({
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
  });
  if (contentLength) headers.set('Content-Length', contentLength);

  return new Response(upstream.body, { status: 200, headers });
}
