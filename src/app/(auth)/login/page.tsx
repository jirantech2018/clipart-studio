import { redirect } from 'next/navigation';

import { LoginForm } from '@/features/auth/components/LoginForm';
import { createSupabaseServerClient } from '@/services/supabase/server';

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { next?: string };
}) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rawNext = searchParams?.next;
  const validatedNext =
    rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null;

  if (user) {
    // 이미 로그인 상태에서 공유 링크로 넘어온 경우엔 원래 페이지로 즉시 이동.
    redirect(validatedNext ?? '/');
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <LoginForm initialNext={validatedNext} />
    </div>
  );
}
