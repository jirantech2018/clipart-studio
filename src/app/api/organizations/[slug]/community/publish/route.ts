// Organization curation → Community publish/unpublish (P5-C Phase A).
//
// POST   /api/organizations/[slug]/community/publish   — 배치 공개
// DELETE /api/organizations/[slug]/community/publish   — 배치 공개 해제
//
// 공통 조건:
//   - 요청자는 조직의 active owner 여야 함 (editor/viewer 는 403).
//   - 대상 이미지가 이 조직에 공유돼 있어야 함 (image_organization_shares 존재).
//
// publish:
//   - 이미 다른 조직 소스로 공개돼 있으면 소스를 이 조직으로 갱신 (재큐레이션).
//   - visibility 는 건드리지 않음 — RLS 확장(037/038) 상 조직 멤버는 이미
//     공유 관계로 접근 가능하고, 커뮤니티 노출은 별개의 게이트.
//   - 큐레이션 메타 (published_by/at/source_org) 를 함께 세팅.
//
// unpublish:
//   - 이 조직 소스로 공개된 것만 해제. 다른 조직 소스로 공개된 이미지는
//     본 API 로 해제할 수 없음 (그 조직의 owner 만 해제 가능).
//   - 038 이전 grandfather 케이스 (source_org NULL) 는 대상 밖.

import { ZodError, z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

import type { OrganizationRole } from '@/types/domain';

const bodySchema = z.object({
  imageIds: z.array(z.string().uuid()).min(1, '이미지를 하나 이상 선택해주세요').max(100),
});

async function loadContext(slug: string, userId: string) {
  const supabase = createSupabaseServerClient();
  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();
  if (!org) return { orgId: null, role: null as OrganizationRole | null };
  const orgId = (org as { id: string }).id;

  const { data: me } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  return {
    orgId,
    role: (me?.role as OrganizationRole | undefined) ?? null,
  };
}

// ---------- POST — publish ----------
export async function POST(request: Request, { params }: { params: { slug: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  const { orgId, role } = await loadContext(params.slug, user.id);
  if (!orgId) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  if (role !== 'owner') {
    return apiError('FORBIDDEN', '조직 어드민만 공유 라이브러리에 공개할 수 있어요');
  }

  // 조직에 공유된 이미지만 필터링 — 이 조직이 큐레이션 자격을 가지려면
  // shares 관계가 있어야 한다.
  const service = createSupabaseServiceClient();
  const { data: sharedRows } = await service
    .from('image_organization_shares')
    .select('image_id')
    .eq('organization_id', orgId)
    .in('image_id', body.imageIds);

  const eligibleIds = (sharedRows ?? []).map(
    (r) => (r as { image_id: string }).image_id,
  );
  if (eligibleIds.length === 0) {
    return apiError('FORBIDDEN', '이 조직에 공유된 이미지만 공개할 수 있어요');
  }

  const now = new Date().toISOString();
  const { error: updateError, count } = await service
    .from('images')
    .update(
      {
        is_on_community: true,
        community_published_by: user.id,
        community_published_at: now,
        community_source_organization_id: orgId,
      },
      { count: 'exact' },
    )
    .in('id', eligibleIds);

  if (updateError) {
    console.error('[community publish POST] update error', updateError);
    return apiError('INTERNAL_ERROR', '공개 처리 실패');
  }

  // 활동 로그 — Phase B-3 이후 전용 activity type 사용.
  await service.from('organization_activity_logs').insert({
    organization_id: orgId,
    actor_user_id: user.id,
    activity_type: 'community_published',
    metadata: {
      image_ids: eligibleIds,
      count: count ?? eligibleIds.length,
    },
  });

  return apiOk(
    {
      publishedCount: count ?? eligibleIds.length,
      skippedCount: body.imageIds.length - eligibleIds.length,
    },
    201,
  );
}

// ---------- DELETE — unpublish ----------
export async function DELETE(request: Request, { params }: { params: { slug: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  const { orgId, role } = await loadContext(params.slug, user.id);
  if (!orgId) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  if (role !== 'owner') {
    return apiError('FORBIDDEN', '조직 어드민만 공유 라이브러리에서 해제할 수 있어요');
  }

  const service = createSupabaseServiceClient();
  const { error: updateError, count } = await service
    .from('images')
    .update(
      {
        is_on_community: false,
        community_published_by: null,
        community_published_at: null,
        community_source_organization_id: null,
      },
      { count: 'exact' },
    )
    .in('id', body.imageIds)
    // 이 조직이 소스인 것만 해제 — 다른 조직에서 큐레이션한 것과
    // grandfather (source_org=NULL) 케이스는 건드리지 않음.
    .eq('community_source_organization_id', orgId);

  if (updateError) {
    console.error('[community publish DELETE] update error', updateError);
    return apiError('INTERNAL_ERROR', '해제 처리 실패');
  }

  await service.from('organization_activity_logs').insert({
    organization_id: orgId,
    actor_user_id: user.id,
    activity_type: 'community_unpublished',
    metadata: {
      image_ids: body.imageIds,
      count: count ?? 0,
    },
  });

  return apiOk({
    unpublishedCount: count ?? 0,
  });
}
