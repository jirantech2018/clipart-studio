// MY Organization 의 라이브러리. 기존 `/library` 를 대체.
//
// URL `/organization/my/library` 는 로그인 유저별 alias.
// 실제 데이터 소스는 `LibraryGrid` (개인 이미지 = owner_id 본인) 를 그대로
// 재사용. Migration 065 이후 이 이미지들은 organization_id = MY org id 로
// 재라벨되어 있지만 표시 로직은 owner 기반으로 동일 결과.

import { redirect } from 'next/navigation';

import { LibraryGrid } from '@/features/library/components/LibraryGrid';
import { resolveMyOrganization } from '@/lib/organization/resolve-personal';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function MyLibraryPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/organization/my/library');

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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">내 라이브러리</h1>
        <p className="whitespace-pre-line text-sm text-muted-foreground">
          {`내가 저장한 이미지를 모아두는 공간입니다.
찾거나 만든 이미지는 언제든 다시 사용할 수 있도록 내 라이브러리에 저장됩니다.`}
        </p>
      </div>
      <LibraryGrid organizationSlug={myOrg.slug} />
    </div>
  );
}
