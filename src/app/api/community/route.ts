// Design Ref: §5.4 Community Page — public feed with author metadata and filters.
// Sort: 'newest' (default) — 'popular' is added in Step 5-3 via download_events.
// Category filter: exact match on image_categories.

import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServerClient } from '@/services/supabase/server';

import type { AccountType } from '@/types/domain';

const querySchema = z.object({
  category: z.string().trim().min(1).max(30).optional(),
  sort: z.enum(['newest', 'popular']).default('newest'),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

interface CommunityImage {
  id: string;
  userId: string;
  prompt: string;
  model: string;
  seed: number | null;
  parentImageId: string | null;
  generationMode: string;
  schoolProfileApplied: boolean;
  createdAt: string;
  thumbnailUrl: string;
  tags: string[];
  categories: string[];
  authorType: AccountType;
  authorSchoolName: string | null;
  downloadCount: number;
}

function rowToImage(row: Record<string, unknown>): CommunityImage {
  const r2Key = row.r2_key as string;
  const thumbnailKey = (row.thumbnail_r2_key as string) ?? r2Key;
  const rawTags = (row.image_tags as Array<{ tag: string }> | null) ?? [];
  const rawCats = (row.image_categories as Array<{ category: string }> | null) ?? [];
  return {
    id: row.id as string,
    userId: row.user_id as string,
    prompt: row.prompt as string,
    model: row.model as string,
    seed: (row.seed as number) ?? null,
    parentImageId: (row.parent_image_id as string) ?? null,
    generationMode: row.generation_mode as string,
    schoolProfileApplied: row.school_profile_applied as boolean,
    createdAt: row.created_at as string,
    thumbnailUrl: publicUrl(thumbnailKey),
    tags: rawTags.map((t) => t.tag),
    categories: rawCats.map((c) => c.category),
    authorType: row.author_type as AccountType,
    authorSchoolName: (row.author_school_name as string) ?? null,
    downloadCount: Number(row.download_count ?? 0),
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
    category: url.searchParams.get('category') ?? undefined,
    sort: url.searchParams.get('sort') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '쿼리 파라미터가 올바르지 않습니다', {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const { category, sort, limit, offset } = parsed.data;

  // Category filter is applied as a pre-pass: pull image_ids for the category,
  // then restrict the main query. Empty match short-circuits to empty result.
  let categoryIds: string[] | null = null;
  if (category) {
    const { data: catRows } = await supabase
      .from('image_categories')
      .select('image_id')
      .eq('category', category)
      .limit(1000);
    categoryIds = (catRows ?? []).map((r) => r.image_id as string);
    if (categoryIds.length === 0) {
      return apiOk({ images: [], total: 0, limit, offset, category, sort });
    }
  }

  let query = supabase
    .from('community_images')
    .select('*, image_tags(tag), image_categories(category)', { count: 'exact' });

  if (categoryIds) query = query.in('id', categoryIds);

  if (sort === 'popular') {
    // Migration 021 adds download_count to the view; ties break on freshness.
    query = query
      .order('download_count', { ascending: false })
      .order('created_at', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) {
    return apiError('INTERNAL_ERROR', '조회 실패', { details: error.message });
  }

  const images = (data ?? []).map(rowToImage);
  return apiOk({
    images,
    total: count ?? images.length,
    limit,
    offset,
    category: category ?? null,
    sort,
  });
}
