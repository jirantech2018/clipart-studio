// Design Ref: §5.4 Library Page — filter bar + sort + card metadata (tags, categories)
// Uses PostgREST embedded resource syntax so tags/categories come back in one round-trip.

import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import { createSupabaseServerClient } from '@/services/supabase/server';
import { publicUrl } from '@/services/r2/upload';

import type { Image, ImageStatus, ImageVisibility } from '@/types/domain';

const querySchema = z.object({
  filter: z.enum(['all', 'public']).default('all'),
  sort: z.enum(['newest', 'oldest']).default('newest'),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

interface ImageWithMeta extends Image {
  thumbnailUrl: string;
  tags: string[];
  categories: string[];
  /** 이 이미지가 공유된 조직 (개인 라이브러리 카드에 라벨 표시용). */
  sharedOrgs: { slug: string; name: string }[];
}

function rowToImage(row: Record<string, unknown>): ImageWithMeta {
  const r2Key = row.r2_key as string;
  const thumbnailKey = (row.thumbnail_r2_key as string) ?? r2Key;
  const rawTags = (row.image_tags as Array<{ tag: string }> | null) ?? [];
  const rawCats = (row.image_categories as Array<{ category: string }> | null) ?? [];
  const rawShares =
    (row.image_organization_shares as Array<{
      organizations: { slug: string; name: string; deleted_at: string | null };
    }> | null) ?? [];
  const sharedOrgs = rawShares
    .map((s) => s.organizations)
    .filter((o): o is { slug: string; name: string; deleted_at: string | null } => !!o)
    .filter((o) => o.deleted_at === null)
    .map((o) => ({ slug: o.slug, name: o.name }));
  return {
    id: row.id as string,
    userId: row.user_id as string,
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
    sharedOrgs,
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
    .select(
      // image_organization_shares 도 함께 join — 각 이미지의 공유 조직을
      // 카드 라벨에 표시하기 위해. shares 는 RLS ios_select (조직 멤버 or
      // 이미지 소유자) 로 보호되지만 여기선 소유자만 SELECT 하므로 통과.
      '*, image_tags(tag), image_categories(category), image_organization_shares(organizations(slug, name, deleted_at))',
      { count: 'exact' },
    )
    .eq('user_id', user.id);

  // All library images are 'saved' by policy (no pending/discarded lifecycle).
  query = query.eq('status', 'saved');
  if (filter === 'public') query = query.eq('is_on_community', true);

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
