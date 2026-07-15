// Admin-only. 관리자 진입 페이지. 두 가지 시스템 진입점:
//   - 상단: Knowledge CMS (Phase A 이후 신규, 파이프라인 이관은 Phase C 예정)
//   - 하단: 기존 프롬프트 규칙 관리 (파이프라인이 현재 사용 중)

import { ArrowRight, ImageIcon } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Card, CardContent } from '@/components/ui/card';
import { PromptRulesManager } from '@/features/prompt-rules/components/PromptRulesManager';
import { isAdmin } from '@/lib/admin';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!isAdmin(user.email)) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">관리자</h1>
        <p className="text-sm text-muted-foreground">
          이미지 생성 파이프라인이 참고할 지식과 규칙을 관리합니다.
        </p>
      </div>

      <Link href="/admin/knowledge" className="block">
        <Card className="border-primary/40 bg-primary/5 transition-colors hover:border-primary hover:bg-primary/10">
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-md bg-primary/10 p-2 text-primary">
              <ImageIcon className="h-5 w-5" />
            </div>
            <div className="flex-1 space-y-0.5">
              <div className="text-sm font-semibold">Image Knowledge CMS →</div>
              <p className="text-xs text-muted-foreground">
                한국 학교 고유의 사물/공간을 텍스트 설명 + 참고 이미지로 등록.
                Positive 이미지는 이미지 생성 API 에 함께 전달됩니다. (파이프라인 이관은 Phase C 예정)
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </CardContent>
        </Card>
      </Link>

      <div className="space-y-2 pt-2">
        <h2 className="text-lg font-semibold tracking-tight">프롬프트 규칙 (현재 사용 중)</h2>
        <p className="text-xs text-muted-foreground">
          Knowledge CMS 파이프라인 이관 전까지는 아래 규칙이 실제 이미지 생성에 자동 조합됩니다.
        </p>
      </div>

      <PromptRulesManager />
    </div>
  );
}
