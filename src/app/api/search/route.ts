// Design Ref: §5.4 Search Result Page + §3.3 tsvector FTS
// Scope: 'mine' (내 라이브러리) | 'community' (is_on_community=TRUE) | 'all' (union)
// Matching strategy: collect candidate image_ids from three sources
//   (a) prompt full-text search    (b) exact tag hit    (c) exact category hit
// Union the ids, then fetch full rows with embeds in one round-trip.
// Official Collection scope will be added after Step 4 seeding.

import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServerClient } from '@/services/supabase/server';

import type { AccountType, Image, ImageStatus, ImageVisibility } from '@/types/domain';

const querySchema = z.object({
  q: z.string().trim().min(1, '검색어를 입력해주세요').max(100),
  scope: z.enum(['mine', 'community', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

interface SearchImage extends Image {
  thumbnailUrl: string;
  tags: string[];
  categories: string[];
  isMine: boolean;
  authorType: AccountType;
  authorSchoolName: string | null;
}

function rowToImage(
  row: Record<string, unknown>,
  currentUserId: string,
  authorMap: Map<string, { authorType: AccountType; authorSchoolName: string | null }>,
): SearchImage {
  const r2Key = row.r2_key as string;
  const thumbnailKey = (row.thumbnail_r2_key as string) ?? r2Key;
  const rawTags = (row.image_tags as Array<{ tag: string }> | null) ?? [];
  const rawCats = (row.image_categories as Array<{ category: string }> | null) ?? [];
  const ownerId = row.user_id as string;
  const author = authorMap.get(ownerId) ?? {
    authorType: 'general' as AccountType,
    authorSchoolName: null,
  };
  return {
    id: row.id as string,
    userId: ownerId,
    prompt: row.prompt as string,
    negativePrompt: (row.negative_prompt as string) ?? null,
    model: row.model as Image['model'],
    seed: (row.seed as number) ?? null,
    r2Key,
    thumbnailR2Key: (row.thumbnail_r2_key as string) ?? null,
    visibility: row.visibility as ImageVisibility,
    isOnCommunity: row.is_on_community as boolean,
    isUpscaled: row.is_upscaled as boolean,
    upscaledFromId: (row.upscaled_from_id as string) ?? null,
    parentImageId: (row.parent_image_id as string) ?? null,
    batchId: (row.batch_id as string) ?? null,
    generationMode: row.generation_mode as Image['generationMode'],
    referenceImageId: (row.reference_image_id as string) ?? null,
    schoolProfileApplied: row.school_profile_applied as boolean,
    status: row.status as ImageStatus,
    pendingExpiresAt: (row.pending_expires_at as string) ?? null,
    width: (row.width as number) ?? 1024,
    height: (row.height as number) ?? 1024,
    createdAt: row.created_at as string,
    thumbnailUrl: publicUrl(thumbnailKey),
    tags: rawTags.map((t) => t.tag),
    categories: rawCats.map((c) => c.category),
    isMine: ownerId === currentUserId,
    authorType: author.authorType,
    authorSchoolName: author.authorSchoolName,
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
    q: url.searchParams.get('q') ?? '',
    scope: url.searchParams.get('scope') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '검색어를 확인해주세요', {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const { q, scope, limit, offset } = parsed.data;

  // Collect candidate ids from three independent sources in parallel.
  const [ftsRes, tagRes, catRes] = await Promise.all([
    supabase
      .from('images')
      .select('id')
      .eq('status', 'saved')
      .textSearch('search_vector', q, { type: 'websearch', config: 'simple' })
      .limit(500),
    supabase.from('image_tags').select('image_id').eq('tag', q).limit(500),
    supabase.from('image_categories').select('image_id').eq('category', q).limit(500),
  ]);

  const candidateIds = new Set<string>();
  for (const row of ftsRes.data ?? []) candidateIds.add(row.id as string);
  for (const row of tagRes.data ?? []) candidateIds.add(row.image_id as string);
  for (const row of catRes.data ?? []) candidateIds.add(row.image_id as string);

  if (candidateIds.size === 0) {
    return apiOk({ images: [], total: 0, limit, offset, query: q, scope });
  }

  const ids = Array.from(candidateIds);

  let query = supabase
    .from('images')
    .select('*, image_tags(tag), image_categories(category)', { count: 'exact' })
    .in('id', ids)
    .eq('status', 'saved');

  if (scope === 'mine') {
    query = query.eq('user_id', user.id);
  } else if (scope === 'community') {
    query = query.eq('is_on_community', true);
  } else {
    // 'all' — 내 것 + Community 노출된 이미지
    query = query.or(`user_id.eq.${user.id},is_on_community.eq.true`);
  }

  query = query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) {
    return apiError('INTERNAL_ERROR', '검색 실패', { details: error.message });
  }

  // Batch-fetch author metadata for all distinct user_ids in the result page.
  // Two parallel queries; both scoped by ids so payloads stay small.
  const rows = data ?? [];
  const authorIds = Array.from(new Set(rows.map((r) => r.user_id as string)));
  const authorMap = new Map<
    string,
    { authorType: AccountType; authorSchoolName: string | null }
  >();
  if (authorIds.length > 0) {
    const [profRes, spRes] = await Promise.all([
      supabase.from('profiles').select('id, account_type').in('id', authorIds),
      supabase.from('school_profiles').select('user_id, school_name').in('user_id', authorIds),
    ]);
    const schoolByUser = new Map<string, string | null>();
    for (const row of spRes.data ?? []) {
      schoolByUser.set(row.user_id as string, (row.school_name as string) ?? null);
    }
    for (const row of profRes.data ?? []) {
      const id = row.id as string;
      authorMap.set(id, {
        authorType: row.account_type as AccountType,
        authorSchoolName: schoolByUser.get(id) ?? null,
      });
    }
  }

  const images = rows.map((row) => rowToImage(row, user.id, authorMap));
  return apiOk({
    images,
    total: count ?? images.length,
    limit,
    offset,
    query: q,
    scope,
  });
}
