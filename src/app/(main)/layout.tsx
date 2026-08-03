import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AppHeader } from '@/components/layout/AppHeader';
import { TopProgressBar } from '@/components/layout/TopProgressBar';
import { AuthProfileHydrator } from '@/features/auth/components/AuthProfileHydrator';
import { isAdmin } from '@/lib/admin';
import { createSupabaseServerClient } from '@/services/supabase/server';

import type { AccountType, Profile } from '@/types/domain';
import type { PropsWithChildren } from 'react';

// Session cookies change on every request — never cache this layout
export const dynamic = 'force-dynamic';

export default async function MainLayout({ children }: PropsWithChildren) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // 비로그인 사용자가 (main) 하위 페이지에 접근하면 로그인 페이지로 유도하되,
    // 현재 요청 경로를 next 로 담아 로그인 완료 후 원래 페이지로 복귀시킨다.
    // pathname 은 middleware 가 세팅한 x-pathname 헤더로 얻는다.
    const pathname = headers().get('x-pathname');
    const target =
      pathname && pathname.startsWith('/') && !pathname.startsWith('//') && pathname !== '/login'
        ? `/login?next=${encodeURIComponent(pathname)}`
        : '/login';
    redirect(target);
  }

  // profile 조회는 실패 가능 (일시적 supabase 오류). error 와 정상 미존재를
  // 구분해 Hydrator 에 그대로 전달한다 (지시 §2).
  //   error !== null           → 조회 실패로 간주, mappedProfile=null 로 넘겨
  //                              hydrator 가 기존 store 를 유지하도록 함
  //   data === null            → 레코드 없음. 이 시점의 정책은 기존 그대로
  //                              (credits=0 fallback). Hydrator 도 seed 하지 않음
  //   data !== null            → snake_case → 도메인 camelCase 매핑 후 seed
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, email, account_type, credits, credits_reset_at, created_at')
    .eq('id', user.id)
    .single();

  const mappedProfile: Profile | null =
    !profileError && profile
      ? {
          id: profile.id as string,
          email: profile.email as string,
          accountType: profile.account_type as AccountType,
          credits: profile.credits as number,
          creditsResetAt: (profile.credits_reset_at as string | null) ?? null,
          createdAt: profile.created_at as string,
        }
      : null;

  return (
    <div className="flex min-h-screen flex-col">
      <AuthProfileHydrator authenticated={true} profile={mappedProfile} />
      <AppHeader
        credits={profile?.credits ?? 0}
        creditsResetAt={profile?.credits_reset_at ?? null}
        isAdmin={isAdmin(user.email)}
      />
      <TopProgressBar />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
