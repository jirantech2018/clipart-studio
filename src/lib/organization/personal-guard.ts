// Personal (MY) Organization 에 대해 특정 조작을 거부하기 위한 공용 guard.
//
// MY Organization Decision Response §MY Organization 제약 사항:
//   - 멤버 추가/이동/역할 변경 불가
//   - 조직 해체 / 소유권 이전 / 조직 탈퇴 불가
//
// UI 는 M2 에서 관련 메뉴를 숨기지만, API 는 직접 호출이 가능하므로
// 이 guard 를 route 안에서 첫 검증으로 사용한다.

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 대상 조직이 personal type 이면 true. 결정 근거는 organizations.type.
 * slug 는 사용자 URL 이 아니라 실제 DB slug 를 받는다 (route params.slug).
 */
export async function isPersonalOrganization(
  supabase: SupabaseClient,
  slug: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('organizations')
    .select('type')
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();
  return (data as { type?: string } | null)?.type === 'personal';
}
