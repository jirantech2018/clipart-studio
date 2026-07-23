// Account info page. P5-D-B 이후: 개인 학교 설정은 조직 학교 설정으로
// 이관되고 개인 화면에서는 참조 이미지 슬롯만 관리한다. 기존 school_profiles
// 데이터는 DB 에 legacy 로 유지 (건드리지 않음).

import { redirect } from 'next/navigation';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ReferenceImagesSection } from '@/features/references/components/ReferenceImagesSection';
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

      {/* 개인 참조 이미지 슬롯 — 개인 컨텍스트 생성 시 소비된다. 조직 컨텍스트
          생성에는 자동으로 섞이지 않는다 (P5-D-C 파이프라인에서 컨텍스트 분기). */}
      <ReferenceImagesSection />
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
