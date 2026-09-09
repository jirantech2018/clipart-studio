// MY organization 컨텍스트 학습지 만들기 페이지 (Phase 2 UI).
// /organization/my/learning

import { redirect } from 'next/navigation';

import { LearningPageClientV2 } from '@/features/learning-helper/components/LearningPageClientV2';
import { loadSupportMatrix } from '@/features/learning-helper/lib/support-matrix';
import { resolveMyOrganization } from '@/lib/organization/resolve-personal';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function MyLearningPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/organization/my/learning');

  const myOrg = await resolveMyOrganization(supabase, user.id);
  if (!myOrg) redirect('/organizations');

  const { data: poolRow } = await supabase
    .from('token_pools')
    .select('balance')
    .eq('organization_id', myOrg.id)
    .maybeSingle();
  const initialCredits = (poolRow as { balance: number } | null)?.balance ?? 0;

  const supportMatrix = await loadSupportMatrix();

  return (
    <LearningPageClientV2
      orgSlug={myOrg.slug}
      orgName="내 워크스페이스"
      initialCredits={initialCredits}
      supportMatrix={supportMatrix}
      userEmail={user.email ?? null}
    />
  );
}
