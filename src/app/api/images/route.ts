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
  // Plan v0.2.7 §M3-2: workspace 필터. 전달 시 그 organization 의 이미지만.
  // organizationSlug 로 넘겨 서버가 id 로 resolve. 미전달 시 이전 동작 (개인
  // owner 전체) 유지 — 하위호환.
  organizationSlug: z.string().min(1).max(200).optional(),
  // Plan v0.2.7 §M3-2 (C 방향): 조직 라이브러리 3-tab 분할.
  //   all     — 이 조직에서 만든 이미지 + 이 조직으로 공유받은 이미지 (기본)
  //   created — 이 조직에서 만든 이미지 (organization_id = X)
  //   shared  — 이 조직으로 공유받은 이미지 (image_organization_shares 경유,
  //             organization_id != X 로 자기 이미지 제외)
  // organizationSlug 미전달 시에는 무시.
  scope: z.enum(['all', 'created', 'shared']).default('all'),
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
    organizationSlug: url.searchParams.get('organizationSlug') ?? undefined,
  });
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '쿼리 파라미터가 올바르지 않습니다', {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const { filter, sort, limit, offset, organizationSlug, scope } = parsed.data;

  // organizationSlug 가 있으면 그 조직 id 로 필터. Membership 검증까지 하려면
  // organization_members join 필요하지만 여기는 SELECT 만이고 organizations
  // RLS 가 소속 조직만 통과시키므로 slug lookup 자체가 안전 필터로 동작.
  let organizationId: string | null = null;
  if (organizationSlug) {
    const { data: orgRow } = await supabase
      .from('organizations')
      .select('id')
      .eq('slug', organizationSlug)
      .is('deleted_at', null)
      .maybeSingle();
    if (!orgRow) {
      return apiError('NOT_FOUND', '조직을 찾을 수 없어요');
    }
    organizationId = (orgRow as { id: string }).id;
  }

  let query = supabase
    .from('images')
    .select(
      // image_organization_shares 도 함께 join — 각 이미지의 공유 조직을
      // 카드 라벨에 표시하기 위해. shares 는 RLS ios_select (조직 멤버 or
      // 이미지 소유자) 로 보호되지만 여기선 소유자만 SELECT 하므로 통과.
      '*, image_tags(tag), image_categories(category), image_organization_shares(organizations(slug, name, deleted_at))',
      { count: 'exact' },
    );

  if (organizationId) {
    // Plan v0.2.7 §M3-2 (C 방향): scope 별 워크스페이스 필터.
    //   organizations.id 는 "만든 곳" 을 나타내고, image_organization_shares
    //   는 "공유받은 곳" 을 나타낸다. 두 개념이 분리돼 있어 조합으로 3개 뷰를
    //   만든다. 자기 이미지가 아닌 공유받은 이미지만 필터하기 위해 shared 는
    //   organization_id != X 조건으로 자기 창작물을 제외한다.
    if (scope === 'created') {
      query = query.eq('organization_id', organizationId);
    } else if (scope === 'shared') {
      // 이 조직으로 공유된 image_id 목록을 먼저 조회.
      const { data: shareRows, error: shareErr } = await supabase
        .from('image_organization_shares')
        .select('image_id')
        .eq('organization_id', organizationId);
      if (shareErr) return apiError('INTERNAL_ERROR', '공유 목록 조회 실패');
      const sharedIds = (shareRows ?? []).map((r) => (r as { image_id: string }).image_id);
      if (sharedIds.length === 0) {
        return apiOk({ images: [], total: 0, limit, offset });
      }
      query = query.in('id', sharedIds).neq('organization_id', organizationId);
    } else {
      // scope === 'all': 이 조직 소속 + 이 조직으로 공유받은 것 (자기 창작
      // 여부 무관). shares 는 organization_id != X 인 이미지만 실질 추가됨
      // (같은 조직에서 만든 이미지는 이미 첫 조건에 포함).
      const { data: shareRows, error: shareErr } = await supabase
        .from('image_organization_shares')
        .select('image_id')
        .eq('organization_id', organizationId);
      if (shareErr) return apiError('INTERNAL_ERROR', '공유 목록 조회 실패');
      const sharedIds = (shareRows ?? []).map((r) => (r as { image_id: string }).image_id);
      if (sharedIds.length > 0) {
        query = query.or(
          `organization_id.eq.${organizationId},id.in.(${sharedIds.join(',')})`,
        );
      } else {
        query = query.eq('organization_id', organizationId);
      }
    }
  } else {
    // 하위호환: 개인 owner 기반 (organizationSlug 미전달 시).
    query = query.eq('user_id', user.id);
  }

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
