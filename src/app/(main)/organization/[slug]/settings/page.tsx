import { redirect } from 'next/navigation';

import { OrganizationSettings } from '@/features/organization/components/OrganizationSettings';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function OrganizationSettingsPage({
  params,
}: {
  params: { slug: string };
}) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/organization/${params.slug}/settings`);

  return (
    <div className="mx-auto max-w-4xl">
      <OrganizationSettings slug={params.slug} />
    </div>
  );
}
