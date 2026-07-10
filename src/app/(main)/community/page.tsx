// Design Ref: §5.4 Community Page — server auth guard, delegates grid to client component

import { redirect } from 'next/navigation';

import { CommunityGrid } from '@/features/community/components/CommunityGrid';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function CommunityPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          워크스페이스 (공유 라이브러리)
        </h1>
        <p className="whitespace-pre-line text-sm text-muted-foreground">
          {`다른 사람들이 만든 이미지를 자유롭게 둘러보세요.
마음에 드는 이미지를 발견했다면, 비슷한 스타일로 새로운 이미지를 만들어 볼 수 있습니다.`}
        </p>
      </div>
      <CommunityGrid />
    </div>
  );
}
