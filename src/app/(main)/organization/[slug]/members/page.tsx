import { redirect } from 'next/navigation';

import { MembersPage } from '@/features/organization/components/MembersPage';
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

  return (
    <div className="mx-auto max-w-4xl">
      <MembersPage slug={params.slug} />
    </div>
  );
}
