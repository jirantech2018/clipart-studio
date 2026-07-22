// Organization image shares — 조직 라이브러리에 내 이미지 얹기/내리기.
//
// POST /api/organizations/[slug]/shares
//   body: { imageIds: string[] }
//   - 요청자는 각 이미지의 소유자여야 함 (RLS ios_insert_editor 로 재검증).
//   - 요청자는 조직의 active 멤버여야 함.
//   - PK (image_id, organization_id) 라 이미 공유된 것은 upsert 로 무해.
//   - visibility 는 건드리지 않음 — image_select_v5 RLS 가 shares 를 별도로
//     인정하기 때문에 private 이미지도 공유 즉시 조직 멤버가 볼 수 있음.

import { ZodError, z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

const shareBodySchema = z.object({
  imageIds: z.array(z.string().uuid()).min(1, '이미지를 하나 이상 선택해주세요').max(100),
});

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  let body;
  try {
    body = shareBodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', params.slug)
    .is('deleted_at', null)
    .maybeSingle();
  if (!org) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  const orgId = (org as { id: string }).id;

  // 요청자가 이 조직의 active 멤버인지 확인.
  const { data: me } = await supabase
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();
  if (!me) return apiError('FORBIDDEN', '조직 멤버만 이미지를 공유할 수 있어요');

  // 이미지 소유권 확인 — 소유하지 않은 이미지는 조용히 스킵.
  const service = createSupabaseServiceClient();
  const { data: ownedRows } = await service
    .from('images')
    .select('id')
    .eq('user_id', user.id)
    .in('id', body.imageIds);

  const ownedIds = (ownedRows ?? []).map((r) => (r as { id: string }).id);
  if (ownedIds.length === 0) {
    return apiError('FORBIDDEN', '공유할 수 있는 이미지가 없어요');
  }

  const rows = ownedIds.map((imageId) => ({
    image_id: imageId,
    organization_id: orgId,
    shared_by_user_id: user.id,
  }));

  // upsert — 이미 공유된 조합이면 무해하게 넘어감.
  const { error: insertError } = await supabase
    .from('image_organization_shares')
    .upsert(rows, { onConflict: 'image_id,organization_id', ignoreDuplicates: true });

  if (insertError) {
    console.error('[shares POST] insert error', insertError);
    return apiError('INTERNAL_ERROR', '공유 실패');
  }

  // 활동 로그 (조직당 하나로 요약)
  await service.from('organization_activity_logs').insert({
    organization_id: orgId,
    actor_user_id: user.id,
    activity_type: 'image_shared',
    metadata: { image_ids: ownedIds, count: ownedIds.length },
  });

  return apiOk({ sharedCount: ownedIds.length, skippedCount: body.imageIds.length - ownedIds.length }, 201);
}
