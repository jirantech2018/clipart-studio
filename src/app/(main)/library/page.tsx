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
      </div>
      <LibraryGrid />
    </div>
  );
}
