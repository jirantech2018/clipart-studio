// Public 공유 라이브러리 API — embed 페이지의 "더 보기" 버튼 전용.
//
// /api/community 는 로그인 필요라 embed 시나리오 (익명 방문자) 에 못 씀.
// 이 라우트는 service_role 로 community_images 뷰만 조회하고 그 이상은
// 노출하지 않는다 (다운로드/신고/편집 등 모든 mutation 은 여기서 불가).
//
// CORS 없음 — clipartstudio.schoolp.co.kr 자체 embed 페이지가 fetch 하므로
// same-origin. 다른 도메인에서 직접 호출은 브라우저가 차단.

export const runtime = 'nodejs';

import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServiceClient } from '@/services/supabase/server';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(['newest', 'popular']).default('newest'),
});

interface EmbedCommunityImage {
  id: string;
  prompt: string;
  width: number;
  height: number;
  thumbnailUrl: string;
  viewCount: number;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
    sort: url.searchParams.get('sort') ?? undefined,
  });
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '쿼리 파라미터가 올바르지 않습니다', {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const { limit, offset, sort } = parsed.data;

  const service = createSupabaseServiceClient();
  let query = service
    .from('community_images')
    .select(
      'id, prompt, width, height, r2_key, thumbnail_r2_key, download_count, view_count',
      { count: 'exact' },
    );

  if (sort === 'popular') {
    query = query
      .order('download_count', { ascending: false })
      .order('created_at', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  const { data, count, error } = await query.range(offset, offset + limit - 1);

  if (error) {
    console.error('[api/embed/community] query failed', error);
    return apiError('INTERNAL_ERROR', '조회 실패');
  }

  const rows = (data ?? []) as Array<{
    id: string;
    prompt: string;
    width: number | null;
    height: number | null;
    r2_key: string;
    thumbnail_r2_key: string | null;
    view_count: number | null;
  }>;

  const images: EmbedCommunityImage[] = rows.map((row) => ({
    id: row.id,
    prompt: row.prompt,
    width: row.width ?? 1024,
    height: row.height ?? 1024,
    thumbnailUrl: publicUrl(row.thumbnail_r2_key ?? row.r2_key),
    viewCount: Number(row.view_count ?? 0),
  }));

  return apiOk({
    images,
    total: count ?? images.length,
    limit,
    offset,
  });
}
