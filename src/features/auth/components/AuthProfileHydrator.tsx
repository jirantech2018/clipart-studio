'use client';

// SSR 에서 조회한 인증 Profile 을 authStore 에 seed 하는 hydrator.
//
// 왜 필요한가:
//   지금까지 authStore.setProfile 은 프로젝트 어디에서도 호출되지 않아
//   store.profile 이 항상 null 이었다. 이 상태에서는 authStore.updateCredits
//   (스트림 완료 후 서버 실측 크레딧 반영) 가 no-op 이 되어 /generate,
//   /generate-v2 모두 새로고침 전에는 credits 가 최신화되지 않았다.
//   (main) layout 은 이미 서버에서 profile 을 조회하고 있으므로 그 값을
//   client store 에 seed 만 해주면 근본 문제가 해결된다.
//
// 상태 조합 (지시 §2 — 조회 실패와 로그아웃을 구분):
//   authenticated=false                → reset()           (미로그인)
//   authenticated=true,  profile=Profile → setProfile()   (필드 diff 있을 때만)
//   authenticated=true,  profile=null   → no-op          (profile 조회 실패 →
//                                                          기존 store 유지)
//
// 반복 실행 방지 (지시 §4):
//   currentProfile 을 useEffect dependency 로 넣지 않고 getState() 로 최신값을
//   즉시 조회 → set 후 effect 재실행 없음. dependency 는 안정적 참조들만.

import { useEffect } from 'react';

import { useAuthStore } from '@/lib/store/authStore';

import type { Profile } from '@/types/domain';

interface Props {
  /** middleware / layout 이 검증한 인증 사용자 여부. false 면 reset. */
  authenticated: boolean;
  /** SSR 매핑 완료된 도메인 profile. authenticated=true 이지만 null 이면
   *  조회 실패로 간주 (기존 store 상태 유지, 절대 reset 하지 않음). */
  profile: Profile | null;
}

function isSameProfile(a: Profile, b: Profile): boolean {
  return (
    a.id === b.id &&
    a.email === b.email &&
    a.accountType === b.accountType &&
    a.credits === b.credits &&
    a.creditsResetAt === b.creditsResetAt &&
    a.createdAt === b.createdAt
  );
}

export function AuthProfileHydrator({ authenticated, profile }: Props) {
  const setProfile = useAuthStore((s) => s.setProfile);
  const reset = useAuthStore((s) => s.reset);

  useEffect(() => {
    if (!authenticated) {
      if (useAuthStore.getState().profile !== null) reset();
      return;
    }
    if (profile === null) {
      // 인증은 유효하나 profile 조회 실패 — 기존 store 는 그대로 둔다.
      return;
    }
    const current = useAuthStore.getState().profile;
    if (current && isSameProfile(current, profile)) return;
    setProfile(profile);
  }, [authenticated, profile, setProfile, reset]);

  return null;
}
