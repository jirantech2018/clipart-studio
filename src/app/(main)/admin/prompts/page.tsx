// Admin-only. 프롬프트 규칙 관리 페이지.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { PromptRulesManager } from '@/features/prompt-rules/components/PromptRulesManager';
import { isAdmin } from '@/lib/admin';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AdminPromptRulesPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!isAdmin(user.email)) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">
          <Link href="/admin" className="hover:text-foreground hover:underline">
            관리자
          </Link>
          <span className="mx-1">/</span>
          <span>프롬프트 규칙</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">프롬프트 규칙 관리</h1>
        <p className="text-sm text-muted-foreground">
          이미지 생성 시 사용자 프롬프트에 자동으로 조합될 시스템 지시사항을 관리합니다.
          카테고리별로 나눠 등록하고, 필요할 때 켜고 끌 수 있어요.
        </p>
      </div>

      <PromptRulesManager />
    </div>
  );
}
