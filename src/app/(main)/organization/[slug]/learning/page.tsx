// 조직 컨텍스트 학습지 만들기 페이지 (Phase 1 M1).
// /organization/[slug]/learning
//
// M1: 1학년 국어 · 객관식/개별활동지 · 학생용 PDF 다운로드까지 골든 패스.

import { redirect } from 'next/navigation';

import { LearningPageClientV2 } from '@/features/learning-helper/components/LearningPageClientV2';
import { loadSupportMatrix } from '@/features/learning-helper/lib/support-matrix';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

interface Props {
  params: { slug: string };
}

export default async function OrganizationLearningPage({ params }: Props) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/organization/${params.slug}/learning`);

  // 조직 접근 권한 검증: active member 만.
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('id, slug, name')
    .eq('slug', params.slug)
    .is('deleted_at', null)
    .maybeSingle();
  if (!orgRow) redirect('/organizations');
  const org = orgRow as { id: string; slug: string; name: string };

  const { data: membership } = await supabase
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', org.id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();
  if (!membership) redirect('/organizations');

  // 워크스페이스 크레딧.
  const { data: poolRow } = await supabase
    .from('token_pools')
    .select('balance')
    .eq('organization_id', org.id)
    .maybeSingle();
  const initialCredits = (poolRow as { balance: number } | null)?.balance ?? 0;

  const supportMatrix = await loadSupportMatrix();

  return (
    <LearningPageClientV2
      orgSlug={org.slug}
      orgName={org.name}
      initialCredits={initialCredits}
      supportMatrix={supportMatrix}
      userEmail={user.email ?? null}
    />
  );
}
