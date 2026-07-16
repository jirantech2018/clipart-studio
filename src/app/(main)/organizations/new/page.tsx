import { redirect } from 'next/navigation';

import { OrganizationForm } from '@/features/organization/components/OrganizationForm';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function NewOrganizationPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/organizations/new');

  return <OrganizationForm />;
}
