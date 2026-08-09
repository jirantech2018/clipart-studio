// Plan v0.2.7 §M3-2: 조직 라이브러리도 개인과 통일된 LibraryGrid 를 사용한다.
// organizationSlug 필터로 그 workspace 이미지만 표시 (M3-1 에서 job 저장 시
// organization_id 를 세팅했고, M2 이관으로 legacy 이미지도 backfill 됨).
//
// 기존 OrganizationLibraryGrid (다른 사람이 이 조직에 shared 한 이미지) 는
// legacy 로 유지하되 이 라우트에서는 사용하지 않는다. workspace 개념과 shared
// 개념의 관계 정리는 M3 이후 별도 스코프.

import { redirect } from 'next/navigation';

import { LibraryGrid } from '@/features/library/components/LibraryGrid';
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

  // 조직 접근 권한 검증: active member 만.
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', params.slug)
    .is('deleted_at', null)
    .maybeSingle();
  if (!orgRow) redirect('/organizations');

  const { data: membership } = await supabase
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', (orgRow as { id: string }).id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();
  if (!membership) redirect('/organizations');

  return (
    <div className="mx-auto max-w-6xl">
      {/* Plan v0.2.7 §M3-2 (C 방향): 조직 라이브러리는 3-tab (전체 / 이
          조직에서 만든 이미지 / 공유받은 이미지) 노출. */}
      <LibraryGrid organizationSlug={params.slug} showWorkspaceTabs />
    </div>
  );
}
