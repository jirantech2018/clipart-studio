// M5: 이미지 trash/restore 서버측 권한 판정.
//
// 규칙 (지시서 §5):
//   * 소유자 (image.user_id === userId) → USER
//   * 조직 owner/admin (organizations 안에서만) → ORG_ADMIN
//   * Super Admin → SUPER_ADMIN (별도 admin route 에서 처리)
//
// 이 헬퍼는 앞의 두 경로 (USER / ORG_ADMIN) 만 다룬다. Super Admin route 는
// 자체적으로 isAdmin() 검증 후 그냥 실행한다.

import type { SupabaseClient } from '@supabase/supabase-js';

export type TrashActorType = 'USER' | 'ORG_ADMIN' | 'SUPER_ADMIN';

export interface ImageAuthzTarget {
  user_id: string;
  organization_id: string | null;
}

/**
 * 사용자 자신의 이미지이면 USER, 조직 owner/admin 이면 ORG_ADMIN 리턴.
 * 어느 것도 아니면 null. Super Admin 케이스는 이 함수 밖 (admin route) 에서 처리.
 */
export async function resolveTrashActorType(
  service: SupabaseClient,
  target: ImageAuthzTarget,
  userId: string,
): Promise<TrashActorType | null> {
  if (target.user_id === userId) return 'USER';
  if (!target.organization_id) return null;
  const { data } = await service
    .from('organization_members')
    .select('role')
    .eq('organization_id', target.organization_id)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  const role = (data as { role: string } | null)?.role;
  if (role === 'owner' || role === 'admin') return 'ORG_ADMIN';
  return null;
}
