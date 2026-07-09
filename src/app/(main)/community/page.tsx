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
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Community</h1>
        <p className="text-sm text-muted-foreground">
          다른 사용자가 공개한 이미지를 둘러보고, 마음에 드는 이미지를 참조로 새로 만들 수도 있어요.
        </p>
      </div>
      <CommunityGrid />
    </div>
  );
}
