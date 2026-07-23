// Account info page. School Profile lives on /settings now.

import { ArrowRight, School } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createSupabaseServerClient } from '@/services/supabase/server';
import { ACCOUNT_TYPE_LABELS } from '@/types/domain';

import type { AccountType } from '@/types/domain';

export const dynamic = 'force-dynamic';

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

  const resetIso = (profile?.credits_reset_at as string) ?? null;
  const remaining = daysUntil(resetIso);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-bold">계정정보</h1>

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

      {/* P5-D-B: 개인 AI 설정 진입점. 조직 컨텍스트와 별도로 관리되며 개인
          라이브러리 생성에만 적용된다. */}
      <Link href="/settings" className="block">
        <Card className="transition-colors hover:border-primary/60 hover:bg-accent/40">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-md bg-primary/10 p-2 text-primary">
                  <School className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base">개인 AI · 참조 이미지 설정</CardTitle>
                  <CardDescription>
                    개인 라이브러리에서 생성할 때 자동 적용되는 학교 프로필과 참조 이미지.
                  </CardDescription>
                </div>
              </div>
              <ArrowRight
                className="mt-2 h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              조직 컨텍스트에서 생성할 때는 이 값 대신 각 조직의 설정이 적용됩니다.
            </p>
          </CardContent>
        </Card>
      </Link>
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
