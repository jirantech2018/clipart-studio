// M5 Super Admin Image Review 페이지.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ImageReviewPanel } from '@/features/admin/components/ImageReviewPanel';
import { isAdmin } from '@/lib/admin';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AdminImageReviewPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/admin/image-review');
  if (!isAdmin(user.email)) notFound();

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">
          <Link href="/admin" className="hover:text-foreground hover:underline">
            관리자
          </Link>
          <span className="mx-1">/</span>
          <span>이미지 리뷰</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">이미지 리뷰</h1>
        <p className="text-sm text-muted-foreground">
          모든 Workspace 에서 생성된 이미지를 한곳에서 확인합니다. 품질이 낮은 이미지를
          휴지통으로 이동해 라이브러리에서 숨기거나, 다시 복원할 수 있습니다. 실제
          이미지 파일과 DB row 는 삭제되지 않습니다.
        </p>
      </div>

      <ImageReviewPanel />
    </div>
  );
}
