import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AppHeader } from '@/components/layout/AppHeader';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { isAdmin } from '@/lib/admin';
import { createSupabaseServerClient } from '@/services/supabase/server';

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

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, account_type, credits, credits_reset_at, created_at')
    .eq('id', user.id)
    .single();

  const { data: schoolProfile } = await supabase
    .from('school_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader
        credits={profile?.credits ?? 0}
        creditsResetAt={profile?.credits_reset_at ?? null}
      />
      <div className="flex flex-1">
        <AppSidebar hasSchoolProfile={!!schoolProfile} isAdmin={isAdmin(user.email)} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
