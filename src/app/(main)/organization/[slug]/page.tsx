import { redirect } from 'next/navigation';

import { OrganizationHome } from '@/features/organization/components/OrganizationHome';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function OrganizationHomePage({
  params,
}: {
  params: { slug: string };
}) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/organization/${params.slug}`);

  return (
    <div className="mx-auto max-w-6xl">
      <OrganizationHome slug={params.slug} currentUserId={user.id} />
    </div>
  );
}
