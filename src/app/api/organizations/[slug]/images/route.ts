// Organization library — 조직에 공유된 이미지 목록.
//
// GET /api/organizations/[slug]/images
//   query: filter=all, sort=newest|oldest, limit, offset
//   - 요청자는 조직의 active 멤버여야 함.
//   - image_organization_shares 조인. images_select_v5 정책이 shares 를 인정.
//   - shared_at 기준 페이지네이션 (조직에 언제 얹혔는지가 조직 라이브러리의
//     "새 순" 기준으로 자연스럽다).

import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import { createSupabaseServerClient } from '@/services/supabase/server';
import { publicUrl } from '@/services/r2/upload';

import type { Image, ImageStatus, ImageVisibility } from '@/types/domain';

const querySchema = z.object({
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
    sort: url.searchParams.get('sort') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '쿼리 파라미터가 올바르지 않습니다');
  }

  const { sort, limit, offset } = parsed.data;

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

  const { data, error, count } = await supabase
    .from('image_organization_shares')
    .select(
      'image_id, shared_at, shared_by_user_id, images!inner(*, image_tags(tag), image_categories(category))',
      { count: 'exact' },
    )
    .eq('organization_id', orgId)
    .eq('images.status', 'saved')
    .order('shared_at', { ascending: sort === 'oldest' })
    .range(offset, offset + limit - 1);

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
