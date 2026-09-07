// MY organization 컨텍스트 학습지 만들기 페이지 (Phase 1 M1).
// /organization/my/learning
//
// Personal workspace 를 자동 해석해 /organization/[slug]/learning 과 동일 클라이언트
// 컴포넌트로 렌더한다.

import { redirect } from 'next/navigation';

import { LearningPageClient } from '@/features/learning-helper/components/LearningPageClient';
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

  return (
    <LearningPageClient
      orgSlug={myOrg.slug}
      orgName="내 워크스페이스"
      initialCredits={initialCredits}
    />
  );
}
