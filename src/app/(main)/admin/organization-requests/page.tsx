// Plan M4: Super Admin 조직 개설 신청 관리 페이지.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { OrganizationRequestsPanel } from '@/features/admin/components/OrganizationRequestsPanel';
import { isAdmin } from '@/lib/admin';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AdminOrganizationRequestsPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/admin/organization-requests');
  if (!isAdmin(user.email)) notFound();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">
          <Link href="/admin" className="hover:text-foreground hover:underline">
            관리자
          </Link>
          <span className="mx-1">/</span>
          <span>조직 개설 신청</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">조직 개설 신청</h1>
        <p className="text-sm text-muted-foreground">
          사용자가 신청한 조직 개설 요청을 검토합니다. 승인 시 실제 워크스페이스와 owner 멤버십,
          Token Pool 이 원자적으로 생성됩니다.
        </p>
      </div>

      <OrganizationRequestsPanel />
    </div>
  );
}
