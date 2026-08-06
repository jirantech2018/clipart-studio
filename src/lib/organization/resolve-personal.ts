// MY Organization ("내 워크스페이스") 를 세션 유저 기준으로 찾아 반환.
//
// URL `/organization/my/*` alias 는 middleware / handler 에서 이 helper 로
// 실제 organization row (hidden slug: `personal-{user_id...}`) 를 resolve
// 한다. 조회 기준은 slug 문자열이 아니라 `owner_id + type='personal'`
// (사용자 지시 D-open-2).
//
// 결과가 null 이면 Migration 062-064 가 아직 배포되지 않았거나, 그 배포
// 후 이 유저에 대한 provision 이 어떤 이유로 실패한 상태. 호출자는
// UI 상 "MY 워크스페이스가 아직 준비되지 않았어요" 로 안내한다.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface MyOrganizationRef {
  id: string;
  slug: string;
}

/**
 * 세션 유저의 MY organization 조회.
 * @param supabase server client (createSupabaseServerClient 결과)
 * @param userId 세션 유저 id
 */
export async function resolveMyOrganization(
  supabase: SupabaseClient,
  userId: string,
): Promise<MyOrganizationRef | null> {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, slug')
    .eq('owner_id', userId)
    .eq('type', 'personal')
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    console.error('[resolveMyOrganization] query failed', error);
    return null;
  }
  if (!data) return null;
  return {
    id: (data as { id: string }).id,
    slug: (data as { slug: string }).slug,
  };
}
