// Plan v0.2.8 §M3-3: Job.organization_id → Token Pool 로 매핑하는 얇은 조회.
//
// 클라이언트가 pool_id 를 넘기지 않고, 서버가 검증된 organization_id 기준으로
// pool 을 결정한다는 원칙을 강제하기 위해 조회 로직을 한 곳에 모은다.

import { createSupabaseServiceClient } from '@/services/supabase/server';

import { PoolNotFoundError } from './errors';

export async function resolvePoolByOrganization(organizationId: string): Promise<string> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from('token_pools')
    .select('id')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new PoolNotFoundError(organizationId);
  return (data as { id: string }).id;
}

/**
 * 세션 유저의 MY organization 에 대응하는 pool_id 를 조회한다. Legacy wrapper
 * (userId 기반 예약/환불) 에서 org 컨텍스트가 없는 호출을 처리하기 위한 편의
 * 함수. 신규 코드는 사용하지 않는다.
 */
export async function resolveMyPoolByUserId(userId: string): Promise<string> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from('organizations')
    .select('id')
    .eq('owner_id', userId)
    .eq('type', 'personal')
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new PoolNotFoundError();
  return resolvePoolByOrganization((data as { id: string }).id);
}
