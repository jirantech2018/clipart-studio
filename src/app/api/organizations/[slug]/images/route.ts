// Organization library — 조직에 공유된 이미지 목록.
//
// GET /api/organizations/[slug]/images
//   query: filter=all|unpublished|published, sort=newest|oldest, limit, offset
//   - 요청자는 조직의 active 멤버여야 함.
//   - image_organization_shares 조인. images_select_v5 정책이 shares 를 인정.
//   - shared_at 기준 페이지네이션.
//   - filter=published 는 "이 조직이 소스인 커뮤니티 공개" 만 포함
//     (grandfather NULL 소스와 타 조직 소스는 제외).
//   - 응답에 community_source_organization_id 를 함께 실어 클라이언트가
//     상태 뱃지 ("공유 라이브러리 공개 중" / "기존 공개 이미지" /
//     "다른 조직에서 공개 중") 를 그릴 수 있게 한다.

import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import { createSupabaseServerClient } from '@/services/supabase/server';
import { publicUrl } from '@/services/r2/upload';

import type { Image, ImageStatus, ImageVisibility } from '@/types/domain';

const querySchema = z.object({
  filter: z.enum(['all', 'unpublished', 'published']).default('all'),
  sort: z.enum(['newest', 'oldest']).default('newest'),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

interface ImageWithMeta extends Image {
  thumbnailUrl: string;
  tags: string[];
  categories: string[];
  sharedAt: string;
  sharedByUserId: string;
  communitySourceOrganizationId: string | null;
}

function rowToImage(share: {
  image_id: string;
  shared_at: string;
  shared_by_user_id: string;
  images: Record<string, unknown>;
}): ImageWithMeta {
  const row = share.images;
  const r2Key = row.r2_key as string;
  const thumbnailKey = (row.thumbnail_r2_key as string) ?? r2Key;
  const rawTags = (row.image_tags as Array<{ tag: string }> | null) ?? [];
  const rawCats = (row.image_categories as Array<{ category: string }> | null) ?? [];
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
    sharedAt: share.shared_at,
    sharedByUserId: share.shared_by_user_id,
    communitySourceOrganizationId:
      (row.community_source_organization_id as string) ?? null,
  };
}

export async function GET(request: Request, { params }: { params: { slug: string } }) {
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
    return apiError('VALIDATION_ERROR', '쿼리 파라미터가 올바르지 않습니다');
  }

  const { filter, sort, limit, offset } = parsed.data;

  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', params.slug)
    .is('deleted_at', null)
    .maybeSingle();
  if (!org) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  const orgId = (org as { id: string }).id;

  // 요청자가 조직의 active 멤버인지 확인 (RLS 로도 걸리지만 명확한 에러 메시지 목적).
  const { data: me } = await supabase
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();
  if (!me) return apiError('FORBIDDEN', '조직 멤버만 볼 수 있어요');

  let query = supabase
    .from('image_organization_shares')
    .select(
      'image_id, shared_at, shared_by_user_id, images!inner(*, image_tags(tag), image_categories(category))',
      { count: 'exact' },
    )
    .eq('organization_id', orgId)
    .eq('images.status', 'saved');

  if (filter === 'unpublished') {
    query = query.eq('images.is_on_community', false);
  } else if (filter === 'published') {
    // "이 조직에서 큐레이션된 공개" 만 — grandfather (source_org NULL) 나
    // 다른 조직 소스는 제외. 사용자 명세 그대로.
    query = query
      .eq('images.is_on_community', true)
      .eq('images.community_source_organization_id', orgId);
  }

  query = query
    .order('shared_at', { ascending: sort === 'oldest' })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    console.error('[org images GET] query error', error);
    return apiError('INTERNAL_ERROR', '조회 실패');
  }

  const images = (data ?? []).map((share) =>
    rowToImage(share as unknown as {
      image_id: string;
      shared_at: string;
      shared_by_user_id: string;
      images: Record<string, unknown>;
    }),
  );

  return apiOk({
    images,
    total: count ?? images.length,
    limit,
    offset,
  });
}
