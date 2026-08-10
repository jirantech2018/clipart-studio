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
          <h1 className="text-2xl font-semibold tracking-tight">Token Dashboard</h1>
          <Link
            href="/admin/knowledge"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Knowledge CMS →
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Workspace 별 크레딧 잔액과 사용량을 보고, 필요한 조직에 크레딧을 지급하거나 조정합니다.
          모든 변동은 Ledger 에 append-only 로 기록됩니다.
        </p>
      </div>

      <TokenDashboard />
    </div>
  );
}
