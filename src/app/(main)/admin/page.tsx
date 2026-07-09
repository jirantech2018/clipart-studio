// Admin-only page. Non-admins get 404'd via notFound() so the page's existence
// isn't advertised to random authenticated users.

import { notFound, redirect } from 'next/navigation';

import { AdminSettingsForm } from '@/features/admin/components/AdminSettingsForm';
import { isAdmin } from '@/lib/admin';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!isAdmin(user.email)) notFound();

  const service = createSupabaseServiceClient();
  const { data } = await service
    .from('admin_settings')
    .select('system_prompt, updated_at')
    .eq('id', 1)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">관리자 · 학습 공간</h1>
        <p className="text-sm text-muted-foreground">
          여기서 설정한 지시는 모든 사용자의 이미지 생성에 자동으로 반영됩니다.
        </p>
      </div>
      <AdminSettingsForm
        initialPrompt={(data?.system_prompt as string) ?? ''}
        initialUpdatedAt={(data?.updated_at as string) ?? null}
      />
    </div>
  );
}
