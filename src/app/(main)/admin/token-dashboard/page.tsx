// Plan v0.2.9 §M4-1: Super Admin Token Dashboard.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { TokenDashboard } from '@/features/admin/components/TokenDashboard';
import { isAdmin } from '@/lib/admin';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AdminTokenDashboardPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/admin/token-dashboard');
  if (!isAdmin(user.email)) notFound();

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">
          <Link href="/admin" className="hover:text-foreground hover:underline">
            관리자
          </Link>
          <span className="mx-1">/</span>
          <span>Token Dashboard</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">크레딧 관리</h1>
          <Link
            href="/admin/knowledge"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Knowledge CMS →
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          조직별 크레딧과 멤버 현황을 확인하고 크레딧을 관리합니다.
        </p>
      </div>

      <TokenDashboard />
    </div>
  );
}
