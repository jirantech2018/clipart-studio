// Auth guard + delegate to client component.

import { redirect } from 'next/navigation';

import { OrganizationList } from '@/features/organization/components/OrganizationList';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function OrganizationsPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/organizations');

  return (
    <div className="mx-auto max-w-4xl">
      <OrganizationList />
    </div>
  );
}
