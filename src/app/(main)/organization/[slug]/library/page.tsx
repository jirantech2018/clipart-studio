import { redirect } from 'next/navigation';

import { OrganizationLibraryGrid } from '@/features/organization/components/OrganizationLibraryGrid';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function OrganizationLibraryPage({
  params,
}: {
  params: { slug: string };
}) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/organization/${params.slug}/library`);

  return (
    <div className="mx-auto max-w-6xl">
      <OrganizationLibraryGrid slug={params.slug} currentUserId={user.id} />
    </div>
  );
}
