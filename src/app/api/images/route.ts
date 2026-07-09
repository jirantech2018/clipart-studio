// Design Ref: §5.4 Library Page — filter bar (전체/저장됨/Pending/공개중), sort (최신/오래된)
// Plan SC: FR-08 saved library, FR-11 pending 24h TTL badge

import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import { createSupabaseServerClient } from '@/services/supabase/server';
import { publicUrl } from '@/services/r2/upload';

import type { Image, ImageStatus } from '@/types/domain';

const querySchema = z.object({
  filter: z.enum(['all', 'public']).default('all'),
  sort: z.enum(['newest', 'oldest']).default('newest'),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

interface ImageWithThumb extends Image {
  thumbnailUrl: string;
}

function rowToImage(row: Record<string, unknown>): ImageWithThumb {
  const r2Key = row.r2_key as string;
  const thumbnailKey = (row.thumbnail_r2_key as string) ?? r2Key;
  return {
    id: row.id as string,
    userId: row.user_id as string,
    prompt: row.prompt as string,
    negativePrompt: (row.negative_prompt as string) ?? null,
    model: row.model as Image['model'],
    seed: (row.seed as number) ?? null,
    r2Key,
    thumbnailR2Key: (row.thumbnail_r2_key as string) ?? null,
    isPublic: row.is_public as boolean,
    isUpscaled: row.is_upscaled as boolean,
    upscaledFromId: (row.upscaled_from_id as string) ?? null,
    parentImageId: (row.parent_image_id as string) ?? null,
    batchId: (row.batch_id as string) ?? null,
    generationMode: row.generation_mode as Image['generationMode'],
    referenceImageId: (row.reference_image_id as string) ?? null,
    schoolProfileApplied: row.school_profile_applied as boolean,
    status: row.status as ImageStatus,
    pendingExpiresAt: (row.pending_expires_at as string) ?? null,
    createdAt: row.created_at as string,
    thumbnailUrl: publicUrl(thumbnailKey),
  };
}

export async function GET(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    filter: url.searchParams.get('filter') ?? undefined,
    sort: url.searchParams.get('sort') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '쿼리 파라미터가 올바르지 않습니다', {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const { filter, sort, limit, offset } = parsed.data;
  let query = supabase
    .from('images')
    .select('*', { count: 'exact' })
    .eq('user_id', user.id);

  // All library images are 'saved' by policy (no pending/discarded lifecycle).
  query = query.eq('status', 'saved');
  if (filter === 'public') query = query.eq('is_public', true);
  // 'all' — no additional filter beyond owner-scoped saved images

  query = query
    .order('created_at', { ascending: sort === 'oldest' })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) return apiError('INTERNAL_ERROR', '조회 실패');

  const images = (data ?? []).map(rowToImage);
  return apiOk({
    images,
    total: count ?? images.length,
    limit,
    offset,
  });
}
