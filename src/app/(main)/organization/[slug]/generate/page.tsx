// 일반 Organization 컨텍스트 클립아트 만들기. GenerateV2Client 를 그대로
// 재사용하되, 여기서는 조직 컨텍스트 (orgSlug) 를 명시적으로 초기 seed 로
// 전달한다.
//
// 조직 컨텍스트가 활성이면 Job 생성 시 org_id 가 세팅되어 조직 Token Pool
// 에서 크레딧이 소진된다. Personal Pool 소진 아님.

import { redirect } from 'next/navigation';

import { GenerateV2Client } from '@/features/generation-v2/components/GenerateV2Client';
import { resolveMyOrganization } from '@/lib/organization/resolve-personal';
import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

interface Props {
  params: { slug: string };
  searchParams: { parent?: string };
}

export default async function OrganizationGeneratePage({ params, searchParams }: Props) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/organization/${params.slug}/generate`);

  // 조직 접근 권한 검증: active member 만.
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('id, slug, type')
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

  const parentId = searchParams.parent?.trim() || null;

  const [profileResult, parentResult] = await Promise.all([
    supabase.from('profiles').select('credits').eq('id', user.id).single(),
    parentId
      ? supabase
          .from('images')
          .select('id, prompt, r2_key, thumbnail_r2_key')
          .eq('id', parentId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const parentRow = parentResult.data as {
    id: string;
    prompt: string;
    r2_key: string;
    thumbnail_r2_key: string | null;
  } | null;

  const parent = parentRow
    ? {
        id: parentRow.id,
        prompt: parentRow.prompt,
        thumbnailUrl: publicUrl(parentRow.thumbnail_r2_key ?? parentRow.r2_key),
      }
    : null;

  // 세션 유저의 MY organizationSlug — legacy conversation backfill 용.
  const myOrg = await resolveMyOrganization(supabase, user.id);
  if (!myOrg) redirect('/organizations');

  return (
    <GenerateV2Client
      initialCredits={profileResult.data?.credits ?? 0}
      parent={parent}
      orgSlug={params.slug}
      myOrgSlug={myOrg.slug}
    />
  );
}
