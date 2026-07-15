// Design Ref: §5.4 Image Detail Page — server auth guard, delegates to client view

import { redirect } from 'next/navigation';

import { ImageDetailView } from '@/features/library/components/ImageDetailView';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function ImageDetailPage({ params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // 비회원이 공유 링크로 들어오면 로그인 후 이 페이지로 자동 복귀.
    redirect(`/login?next=${encodeURIComponent(`/image/${params.id}`)}`);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <ImageDetailView id={params.id} />
    </div>
  );
}
