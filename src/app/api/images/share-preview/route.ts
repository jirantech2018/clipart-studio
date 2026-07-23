// 공유 다이얼로그 pre-preview — 각 조직에 대해 "이 이미지들 중 이미 공유된
// 개수" 를 반환. 클라이언트는 이걸로 "지란지교테크 · 새로 공유 3개" 라벨을
// 실시간으로 그린다.
//
// POST /api/images/share-preview
//   body: { imageIds: string[] }
//   - 요청자가 속한 active 조직 전체에 대해 계산.
//   - 소유하지 않은 이미지는 자동 제외 (공유 API 정책과 동일).
//
// 응답:
//   {
//     eligibleImageCount: number   // 실제 소유한 이미지 개수
//     perOrg: [{ organizationId, existingCount }]
//   }

import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

const bodySchema = z.object({
  imageIds: z.array(z.string().uuid()).min(1).max(200),
});

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  const service = createSupabaseServiceClient();

  const { data: ownedRows } = await service
    .from('images')
    .select('id')
    .eq('user_id', user.id)
    .in('id', body.imageIds);
  const eligibleImageIds = (ownedRows ?? []).map((r) => (r as { id: string }).id);

  if (eligibleImageIds.length === 0) {
    return apiOk({ eligibleImageCount: 0, perOrg: [] });
  }

  // 내가 owner/editor 등 active 멤버인 조직 (soft-deleted 자동 제외).
  const { data: memberRows } = await service
    .from('organization_members')
    .select('organization_id, organizations!inner(deleted_at)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .is('organizations.deleted_at', null);
  const memberOrgIds = (memberRows ?? []).map(
    (r) => (r as { organization_id: string }).organization_id,
  );

  if (memberOrgIds.length === 0) {
    return apiOk({ eligibleImageCount: eligibleImageIds.length, perOrg: [] });
  }

  // (image, org) 페어 중 이미 존재하는 것 조회 후 조직별 집계.
  const { data: existingRows } = await service
    .from('image_organization_shares')
    .select('organization_id')
    .in('image_id', eligibleImageIds)
    .in('organization_id', memberOrgIds);

  const perOrgCount = new Map<string, number>();
  for (const orgId of memberOrgIds) perOrgCount.set(orgId, 0);
  for (const row of existingRows ?? []) {
    const orgId = (row as { organization_id: string }).organization_id;
    perOrgCount.set(orgId, (perOrgCount.get(orgId) ?? 0) + 1);
  }

  return apiOk({
    eligibleImageCount: eligibleImageIds.length,
    perOrg: Array.from(perOrgCount.entries()).map(([organizationId, existingCount]) => ({
      organizationId,
      existingCount,
    })),
  });
}
