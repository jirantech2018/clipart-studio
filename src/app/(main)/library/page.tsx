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
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">내 라이브러리</h1>
        <p className="whitespace-pre-line text-sm text-muted-foreground">
          {`내가 저장한 이미지를 모아두는 공간입니다.
찾거나 만든 이미지는 언제든 다시 사용할 수 있도록 내 라이브러리에 저장됩니다.`}
        </p>
      </div>
      <LibraryGrid />
    </div>
  );
}
