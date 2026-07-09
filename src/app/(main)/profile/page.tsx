import { redirect } from 'next/navigation';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SchoolProfileSection } from '@/features/profile/components/SchoolProfileSection';
import { createSupabaseServerClient } from '@/services/supabase/server';
import { ACCOUNT_TYPE_LABELS } from '@/types/domain';

import type { AccountType } from '@/types/domain';

const MONTHLY_RESET_AMOUNT = 30;

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (24 * 3_600_000));
}

export default async function ProfilePage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  const { data: schoolProfile } = await supabase
    .from('school_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  const resetIso = (profile?.credits_reset_at as string) ?? null;
  const remaining = daysUntil(resetIso);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-bold">프로필</h1>

      <Card>
        <CardHeader>
          <CardTitle>계정</CardTitle>
          <CardDescription>기본 정보 및 크레딧 현황</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="이메일" value={profile?.email ?? '—'} />
          <Row
            label="계정 유형"
            value={profile ? ACCOUNT_TYPE_LABELS[profile.account_type as AccountType] : '—'}
          />
          <Row label="크레딧" value={`🪙 ${profile?.credits ?? 0}`} />
          <Row label="다음 리셋" value={formatDate(resetIso)} />
          {remaining !== null && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              {remaining === 0 ? (
                <>오늘 리셋 예정입니다. 몇 시간 안에 +{MONTHLY_RESET_AMOUNT} 크레딧이 지급돼요.</>
              ) : (
                <>
                  <span className="font-semibold text-foreground">D-{remaining}</span> 후에 +
                  {MONTHLY_RESET_AMOUNT} 크레딧이 지급됩니다. 남은 크레딧과 함께 누적돼요.
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <SchoolProfileSection initialProfile={schoolProfile ?? null} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b pb-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
