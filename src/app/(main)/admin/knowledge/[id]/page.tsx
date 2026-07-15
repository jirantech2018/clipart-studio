// Admin-only. Knowledge 상세 편집 (메타 + 이미지) 페이지.

import { notFound, redirect } from 'next/navigation';

import { KnowledgeDetailView } from '@/features/knowledge/components/KnowledgeDetailView';
import { isAdmin } from '@/lib/admin';
import { createSupabaseServerClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

interface Props {
  params: { id: string };
}

export default async function AdminKnowledgeDetailPage({ params }: Props) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!isAdmin(user.email)) notFound();

  return (
    <div className="mx-auto max-w-6xl">
      <KnowledgeDetailView id={params.id} />
    </div>
  );
}
