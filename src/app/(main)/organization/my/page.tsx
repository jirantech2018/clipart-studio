// MY Organization 홈. `/organization/my` 는 URL alias 이므로 static segment
// 페이지로 두어 `[slug]/page.tsx` 보다 우선하게 한다.
// 실제 slug (hidden `personal-{user_id}`) 는 서버에서 resolve 후 그 값으로
// OrganizationHome 을 렌더한다. 사용자 URL 은 `/organization/my` 로 유지.

import { redirect } from 'next/navigation';

import { OrganizationHome } from '@/features/organization/components/OrganizationHome';
import { resolveMyOrganization } from '@/lib/organization/resolve-personal';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function MyOrganizationHomePage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/organization/my');

  const myOrg = await resolveMyOrganization(supabase, user.id);
  if (!myOrg) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 rounded-md border p-6 text-sm">
        <h1 className="text-base font-semibold">
          내 워크스페이스가 아직 준비되지 않았어요
        </h1>
        <p className="text-muted-foreground">
          잠시 후 다시 시도해주세요. 계속 문제가 발생하면 관리자에게 문의해주세요.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <OrganizationHome slug={myOrg.slug} currentUserId={user.id} />
    </div>
  );
}
