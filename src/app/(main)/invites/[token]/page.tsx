// 초대 수락 페이지. 로그인 필수 — 비로그인이면 로그인 후 이 페이지로 복귀.

import { redirect } from 'next/navigation';

import { InviteAcceptView } from '@/features/organization/components/InviteAcceptView';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function InviteAcceptPage({
  params,
}: {
  params: { token: string };
}) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/invites/${params.token}`)}`);
  }

  return (
    <div className="mx-auto max-w-xl py-8">
      <InviteAcceptView token={params.token} currentUserEmail={user.email ?? ''} />
    </div>
  );
}
