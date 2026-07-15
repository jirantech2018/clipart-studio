// Admin-only. Knowledge CMS 목록 페이지.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { KnowledgeListManager } from '@/features/knowledge/components/KnowledgeListManager';
import { KnowledgePreview } from '@/features/knowledge/components/KnowledgePreview';
import { isAdmin } from '@/lib/admin';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AdminKnowledgePage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!isAdmin(user.email)) notFound();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">
          <Link href="/admin" className="hover:text-foreground hover:underline">
            관리자
          </Link>
          <span className="mx-1">/</span>
          <span>Knowledge</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Image Knowledge CMS</h1>
        <p className="text-sm text-muted-foreground">
          AI 이미지 모델이 잘 이해하지 못하는 대한민국 학교 고유의 사물/공간/구조를 텍스트 설명과 참고 이미지로 등록합니다.
          Positive 이미지는 실제 이미지 생성 요청에 참고 자료로 전달되고, Negative 이미지는 관리자 비교와 금지 조건 작성 참고용으로만 사용됩니다.
        </p>
      </div>

      <KnowledgePreview />

      <KnowledgeListManager />
    </div>
  );
}
