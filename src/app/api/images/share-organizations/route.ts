// 다중 이미지 × 다중 조직 배치 공유 (P5-C Phase B-2.5).
//
// POST /api/images/share-organizations
//   body: { imageIds: string[], organizationIds: string[] }
//
// 처리 원칙:
//   - 요청자가 소유한 이미지만 공유 대상 (owned 이미지 자동 필터).
//   - 요청자가 active 멤버인 조직만 대상 (soft-deleted 조직 자동 제외).
//   - 자격 없는 (이미지, 조직) 페어는 조용히 스킵 — 오류로 보지 않음.
//   - 기존 share row 는 upsert `ignoreDuplicates` 로 조용히 건너뜀
//     (중복 오류 대신 duplicateCount 로 반환).
//
// 응답:
//   {
//     createdCount:   실제로 새로 만들어진 share row 개수
//     duplicateCount: 이미 존재하던 (image, org) 페어 개수
//     skippedCount:   자격 없어 대상에서 제외된 (image, org) 페어 개수
//                     (요청한 imageIds/orgIds 카티전 곱 기준)
//     touchedOrgIds:  실제로 새 row 가 생긴 조직 id 목록
//   }
//
// 정책 유지:
//   - 이미지 visibility 는 건드리지 않음.
//   - is_on_community 도 절대 건드리지 않음 (조직 라이브러리까지만 이동).

import { ZodError, z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

const bodySchema = z.object({
  imageIds: z.array(z.string().uuid()).min(1).max(200),
  organizationIds: z.array(z.string().uuid()).min(1).max(20),
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
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  const service = createSupabaseServiceClient();

  // 1) 요청자가 실제로 소유한 이미지 걸러내기.
  const { data: ownedRows, error: ownedError } = await service
    .from('images')
    .select('id')
    .eq('user_id', user.id)
    .in('id', body.imageIds);
  if (ownedError) {
    console.error('[share-organizations] owned query error', ownedError);
    return apiError('INTERNAL_ERROR', '이미지 확인 실패');
  }
  const ownedIds = new Set((ownedRows ?? []).map((r) => (r as { id: string }).id));
  const eligibleImageIds = body.imageIds.filter((id) => ownedIds.has(id));

  // 2) 요청자가 active 멤버인 조직 걸러내기 (soft-deleted 자동 제외).
  const { data: memberRows, error: memberError } = await service
    .from('organization_members')
    .select('organization_id, organizations!inner(id, deleted_at)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .in('organization_id', body.organizationIds)
    .is('organizations.deleted_at', null);
  if (memberError) {
    console.error('[share-organizations] member query error', memberError);
    return apiError('INTERNAL_ERROR', '조직 확인 실패');
  }
  const eligibleOrgIds = (memberRows ?? []).map(
    (r) => (r as { organization_id: string }).organization_id,
  );

  if (eligibleImageIds.length === 0 || eligibleOrgIds.length === 0) {
    return apiError('FORBIDDEN', '공유할 수 있는 이미지·조직이 없어요');
  }

  const totalRequestedPairs = body.imageIds.length * body.organizationIds.length;
  const eligiblePairsCount = eligibleImageIds.length * eligibleOrgIds.length;
  const preFilterSkipped = totalRequestedPairs - eligiblePairsCount;

  // 3) 이미 존재하는 (image, org) 조합 확인 (upsert 전에 duplicate 계산용).
  const { data: existingRows, error: existingError } = await service
    .from('image_organization_shares')
    .select('image_id, organization_id')
    .in('image_id', eligibleImageIds)
    .in('organization_id', eligibleOrgIds);
  if (existingError) {
    console.error('[share-organizations] existing query error', existingError);
    return apiError('INTERNAL_ERROR', '기존 공유 조회 실패');
  }
  const existingKey = new Set(
    (existingRows ?? []).map(
      (r) => `${(r as { image_id: string }).image_id}::${(r as { organization_id: string }).organization_id}`,
    ),
  );

  // 4) 새로 만들 (image, org) 페어 조립.
  const insertRows: Array<{ image_id: string; organization_id: string; shared_by_user_id: string }> = [];
  const touchedOrgs = new Set<string>();
  for (const imageId of eligibleImageIds) {
    for (const orgId of eligibleOrgIds) {
      if (existingKey.has(`${imageId}::${orgId}`)) continue;
      insertRows.push({
        image_id: imageId,
        organization_id: orgId,
        shared_by_user_id: user.id,
      });
      touchedOrgs.add(orgId);
    }
  }

  let createdCount = 0;
  if (insertRows.length > 0) {
    // upsert with ignoreDuplicates 로 race condition 방어 (조회~insert 사이에
    // 누군가가 같은 row 를 만들어도 오류 안 남).
    const { error: insertError } = await service
      .from('image_organization_shares')
      .upsert(insertRows, {
        onConflict: 'image_id,organization_id',
        ignoreDuplicates: true,
      });
    if (insertError) {
      console.error('[share-organizations] insert error', insertError);
      return apiError('INTERNAL_ERROR', `공유 실패: ${insertError.message}`);
    }
    createdCount = insertRows.length;
  }

  const duplicateCount = existingKey.size;
  const skippedCount = preFilterSkipped;

  // 5) 활동 로그 — 조직별로 하나씩 요약 (실제로 새로 생긴 것만).
  if (touchedOrgs.size > 0) {
    const activityRows = Array.from(touchedOrgs).map((orgId) => ({
      organization_id: orgId,
      actor_user_id: user.id,
      activity_type: 'image_shared' as const,
      metadata: {
        image_ids: eligibleImageIds.filter(
          (imgId) => !existingKey.has(`${imgId}::${orgId}`),
        ),
        via: 'batch',
      },
    }));
    void service
      .from('organization_activity_logs')
      .insert(activityRows)
      .then((res) => {
        if (res.error) {
          console.error('[share-organizations] activity log failed', res.error);
        }
      });
  }

  return apiOk(
    {
      createdCount,
      duplicateCount,
      skippedCount,
      touchedOrgIds: Array.from(touchedOrgs),
    },
    201,
  );
}
