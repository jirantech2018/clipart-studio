import { redirect } from 'next/navigation';

import { MembersPage } from '@/features/organization/components/MembersPage';
import { isPersonalOrganization } from '@/lib/organization/personal-guard';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function OrganizationMembersPage({
  params,
}: {
  params: { slug: string };
}) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/organization/${params.slug}/members`);

  // MY (personal) Organization 은 owner 1인 고정. 멤버 페이지 접근 금지.
  if (await isPersonalOrganization(supabase, params.slug)) {
    redirect(`/organization/${params.slug}`);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <MembersPage slug={params.slug} />
    </div>
  );
}
