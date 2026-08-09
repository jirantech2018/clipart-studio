// MY Organization 의 클립아트 만들기. 기존 `/generate-v2` 를 대체.
//
// GenerateV2Client 는 기존 조직 컨텍스트를 orgSlug 로 받는 구조를 이미
// 갖고 있으므로 그대로 재사용 (아무 orgSlug 도 넘기지 않으면 개인 컨텍스트).
//
// URL query `?parent=<image_id>` 는 chaining (i2i) 진입점으로 기존과 동일하게 유지.

import { redirect } from 'next/navigation';

import { GenerateV2Client } from '@/features/generation-v2/components/GenerateV2Client';
import { resolveMyOrganization } from '@/lib/organization/resolve-personal';
import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { parent?: string };
}

export default async function MyGeneratePage({ searchParams }: Props) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/organization/my/generate');

  const myOrg = await resolveMyOrganization(supabase, user.id);
  if (!myOrg) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 rounded-md border p-6 text-sm">
        <h1 className="text-base font-semibold">
          내 워크스페이스가 아직 준비되지 않았어요
        </h1>
        <p className="text-muted-foreground">
          잠시 후 다시 시도해주세요. 계속 문제가 발생하면 관리자에게 문의해주세요.
        </p>
      </div>
    );
  }

  const parentId = searchParams.parent?.trim() || null;

  // Plan v0.2.8 §M3-3: 화면에 표시되는 크레딧 = 실제로 차감되는 pool.balance.
  // MY workspace 의 token_pool.balance 를 직접 조회 (profiles.credits 는 RPC
  // 가 sync 해두는 캐시이지만, 표시-차감 대응을 위해 pool 을 SoT 로 사용).
  const [poolResult, parentResult] = await Promise.all([
    supabase
      .from('token_pools')
      .select('balance')
      .eq('organization_id', myOrg.id)
      .maybeSingle(),
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

  const workspaceCredits =
    (poolResult.data as { balance: number } | null)?.balance ?? 0;

  return (
    <GenerateV2Client
      initialCredits={workspaceCredits}
      parent={parent}
      orgSlug={myOrg.slug}
      myOrgSlug={myOrg.slug}
    />
  );
}
