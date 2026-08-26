// Public 검색 API — embed 검색 결과 페이지 전용.
//
// /api/search 는 로그인 필요 + scope 분기 (내/공유/전체). embed 는 익명 방문자
// 대상이라 공개(is_on_community=true)만 검색하고, 로그인 없이 service_role 로
// 조회한다. Full-text + tag/category 매칭 로직은 서비스 검색과 동일.

export const runtime = 'nodejs';

import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServiceClient } from '@/services/supabase/server';

const querySchema = z.object({
  q: z.string().trim().min(1, '검색어를 입력해주세요').max(100),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

interface EmbedSearchImage {
  id: string;
  prompt: string;
  width: number;
  height: number;
  thumbnailUrl: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get('q') ?? '',
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '검색어를 확인해주세요', {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const { q, limit, offset } = parsed.data;
  const service = createSupabaseServiceClient();

  // 세 소스에서 candidate id 수집 (병렬).
  const [ftsRes, tagRes, catRes] = await Promise.all([
    service
      .from('images')
      .select('id')
      .eq('status', 'saved')
      .eq('is_on_community', true)
      .textSearch('search_vector', q, { type: 'websearch', config: 'simple' })
      .limit(500),
    service
      .from('image_tags')
      .select('image_id')
      .eq('tag', q)
      .limit(500),
    service
      .from('image_categories')
      .select('image_id')
      .eq('category', q)
      .limit(500),
  ]);

  const candidateIds = new Set<string>();
  for (const row of ftsRes.data ?? []) candidateIds.add(row.id as string);
  for (const row of tagRes.data ?? []) candidateIds.add(row.image_id as string);
  for (const row of catRes.data ?? []) candidateIds.add(row.image_id as string);

  if (candidateIds.size === 0) {
    return apiOk({ images: [], total: 0, limit, offset, query: q });
  }

  const ids = Array.from(candidateIds);
  const { data, count, error } = await service
    .from('images')
    .select('id, prompt, width, height, r2_key, thumbnail_r2_key', {
      count: 'exact',
    })
    .in('id', ids)
    .eq('status', 'saved')
    .eq('is_on_community', true)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('[api/embed/search] query failed', error);
    return apiError('INTERNAL_ERROR', '검색 실패');
  }

  const images: EmbedSearchImage[] = ((data ?? []) as Array<{
    id: string;
    prompt: string;
    width: number | null;
    height: number | null;
    r2_key: string;
    thumbnail_r2_key: string | null;
  }>).map((row) => ({
    id: row.id,
    prompt: row.prompt,
    width: row.width ?? 1024,
    height: row.height ?? 1024,
    thumbnailUrl: publicUrl(row.thumbnail_r2_key ?? row.r2_key),
  }));

  return apiOk({
    images,
    total: count ?? images.length,
    limit,
    offset,
    query: q,
  });
}
