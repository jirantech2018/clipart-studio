// School Profile settings surface. Split out from /profile so calling this
// "학교설정" doesn't overlap with the account info page.

import { redirect } from 'next/navigation';

import { SchoolProfileSection } from '@/features/profile/components/SchoolProfileSection';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: schoolProfile } = await supabase
    .from('school_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-bold">학교설정</h1>
      <SchoolProfileSection initialProfile={schoolProfile ?? null} />
    </div>
  );
}
