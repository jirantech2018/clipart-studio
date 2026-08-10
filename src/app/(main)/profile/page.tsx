// Account info page. P5-D-B 이후: 개인 학교 설정은 조직 학교 설정으로
// 이관되고 개인 화면에서는 참조 이미지 슬롯만 관리한다. 기존 school_profiles
// 데이터는 DB 에 legacy 로 유지 (건드리지 않음).
//
// Plan v0.2.9 §M3-3: 계정 섹션에 "내 작업실 크레딧" (MY workspace pool.balance)
// 과 소속 조직들의 "조직 크레딧" (each org pool.balance) 을 함께 표시.
// profile.credits 는 MY pool 캐시이지만 표시 정확도를 위해 pool.balance 를
// 직접 조회한다.

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ReferenceImagesSection } from '@/features/references/components/ReferenceImagesSection';
import { createSupabaseServerClient } from '@/services/supabase/server';
import { ACCOUNT_TYPE_LABELS } from '@/types/domain';

import type { AccountType, OrganizationType } from '@/types/domain';

export const dynamic = 'force-dynamic';

const MONTHLY_RESET_AMOUNT = 30;

const ORG_TYPE_LABEL: Record<OrganizationType, string> = {
  personal: '개인',
  school: '학교',
  general: '일반',
};

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

interface OrgMembership {
  id: string;
  slug: string;
  name: string;
  type: OrganizationType;
  balance: number;
}

export default async function ProfilePage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // 1) profile + memberships 병렬 조회
  const [profileResult, membershipsResult] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase
      .from('organization_members')
      .select('organizations!inner(id, slug, name, type, deleted_at)')
      .eq('user_id', user.id)
      .eq('status', 'active'),
  ]);

  const profile = profileResult.data;
  // Supabase js 는 many-to-one embed 도 배열로 타입을 유추하므로 unknown 을
  // 거쳐 cast. 실제로는 organizations 는 단일 객체.
  const memberships = (membershipsResult.data ?? []) as unknown as Array<{
    organizations: { id: string; slug: string; name: string; type: OrganizationType; deleted_at: string | null };
  }>;

  const activeOrgs = memberships
    .map((m) => m.organizations)
    .filter((o) => o && o.deleted_at === null);

  // 2) pool.balance 조회
  const orgIds = activeOrgs.map((o) => o.id);
  const balanceByOrg = new Map<string, number>();
  if (orgIds.length > 0) {
    const { data: pools } = await supabase
      .from('token_pools')
      .select('organization_id, balance')
      .in('organization_id', orgIds);
    for (const row of pools ?? []) {
      const r = row as { organization_id: string; balance: number };
      balanceByOrg.set(r.organization_id, r.balance);
    }
  }

  // MY / 일반·학교 분리
  const myOrg = activeOrgs.find((o) => o.type === 'personal') ?? null;
  const myBalance = myOrg
    ? balanceByOrg.get(myOrg.id) ?? profile?.credits ?? 0
    : profile?.credits ?? 0;

  const otherOrgs: OrgMembership[] = activeOrgs
    .filter((o) => o.type !== 'personal')
    .map((o) => ({
      id: o.id,
      slug: o.slug,
      name: o.name,
      type: o.type,
      balance: balanceByOrg.get(o.id) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));

  const resetIso = (profile?.credits_reset_at as string) ?? null;
  const remaining = daysUntil(resetIso);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-bold">개인계정 설정</h1>

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
          <Row label="내 작업실 크레딧" value={`🪙 ${myBalance.toLocaleString('ko-KR')}`} />
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

          {/* 조직 크레딧 — 소속 조직 (school/general) 별 pool.balance */}
          <div className="pt-3">
            <div className="mb-2 text-xs font-semibold text-muted-foreground">조직 크레딧</div>
            {otherOrgs.length === 0 ? (
              <p className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
                아직 소속된 조직이 없어요. 조직에 초대되면 여기에 크레딧이 표시됩니다.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {otherOrgs.map((org) => (
                  <li key={org.id}>
                    <Link
                      href={`/organization/${org.slug}`}
                      className="flex items-center justify-between gap-2 px-3 py-2 transition-colors hover:bg-muted/40"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{org.name}</span>
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {ORG_TYPE_LABEL[org.type]}
                        </span>
                      </div>
                      <span className="tabular-nums font-medium text-primary">
                        🪙 {org.balance.toLocaleString('ko-KR')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
