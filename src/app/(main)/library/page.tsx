// Design Ref: §5.4 Library Page — server auth guard, delegates grid to client component

import { redirect } from 'next/navigation';

import { LibraryGrid } from '@/features/library/components/LibraryGrid';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function LibraryPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">내 라이브러리</h1>
        <p className="text-sm text-muted-foreground">
          저장한 이미지들. Pending 상태는 24시간 안에 저장 안 하면 자동 삭제됩니다.
        </p>
      </div>
      <LibraryGrid />
    </div>
  );
}
