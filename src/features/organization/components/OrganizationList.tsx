'use client';

// 내가 속한 조직 목록 카드 리스트. 각 카드에 이름·설명·멤버 수·내 역할 뱃지.
//
// MY (personal) Organization 은 상단 우측 "내 작업실" 배너로 별도 배치되어
// 항상 눈에 띄는 위치에 있고, grid 에는 school/general 조직만 렌더된다.

import { ArrowRight, Coins, Home, Plus, Users } from 'lucide-react';
import Link from 'next/link';

import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useMyOrganizations } from '@/features/organization/hooks/useOrganizations';
import { cn } from '@/lib/utils';

import type { OrganizationWithMyRole } from '@/types/domain';

// 역할 모델 단일화: owner = "어드민", 그 외 전부 "멤버".
const ROLE_LABEL: Record<string, string> = {
  owner: '어드민',
  admin: '멤버',
  editor: '멤버',
  viewer: '멤버',
};

export function OrganizationList() {
  const { data, isLoading, isError, refetch } = useMyOrganizations();

  const orgs = data?.organizations ?? [];
  const personalOrg = orgs.find((o) => o.type === 'personal') ?? null;
  const otherOrgs = orgs.filter((o) => o.type !== 'personal');

  return (
    <div className="space-y-6">
      {/* 상단: 좌측 제목/설명·새 조직, 우측 '내 작업실' 배너 */}
      <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-start">
        <div className="space-y-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">우리학교 워크스페이스</h1>
            <p className="text-sm text-muted-foreground">
              여러 사람이 같은 이미지 자산을 함께 쓰는 공간이에요.
            </p>
          </div>
          <Link href="/organizations/new" className={buttonVariants({ size: 'sm' })}>
            <Plus className="mr-1 h-4 w-4" /> 새 조직
          </Link>
        </div>

        {personalOrg && <MyWorkspaceBanner org={personalOrg} />}
      </div>

      {/* 하단: 학교/일반 조직 카드 grid */}
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
            조직 목록을 불러오지 못했어요.
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              다시 시도
            </Button>
          </CardContent>
        </Card>
      ) : otherOrgs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
            <p>아직 소속된 조직이 없어요.</p>
            <p className="text-xs">
              직접 만들거나, 다른 사람이 초대해준 링크를 열면 여기에 나타나요.
            </p>
            <Link href="/organizations/new" className={buttonVariants({ size: 'sm' })}>
              첫 조직 만들기
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {otherOrgs.map((org) => (
            <Link key={org.id} href={`/organization/${org.slug}`}>
              <Card className="transition-colors hover:border-primary/60 hover:bg-accent/40">
                <CardContent className="space-y-2 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-base font-semibold">{org.name}</h2>
                      <p className="text-xs text-muted-foreground">/{org.slug}</p>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-sm font-medium',
                        org.myRole === 'owner'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground',
                      )}
                    >
                      {ROLE_LABEL[org.myRole] ?? org.myRole}
                    </span>
                  </div>
                  {org.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {org.description}
                    </p>
                  )}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" />
                    {org.memberCount}명
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function MyWorkspaceBanner({ org }: { org: OrganizationWithMyRole }) {
  return (
    <Link
      href="/organization/my"
      aria-label="내 작업실로 이동"
      className={cn(
        'group inline-flex min-w-[240px] items-center gap-3 rounded-xl border p-3 transition-shadow',
        'bg-gradient-to-br from-primary/10 via-primary/5 to-transparent hover:shadow-md',
      )}
    >
      <div className="rounded-lg bg-primary/15 p-2 text-primary">
        <Home className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-foreground">내 작업실</div>
        <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Coins className="h-3 w-3 text-amber-500" aria-hidden="true" />
          <span className="tabular-nums font-medium text-foreground">
            {org.credits.toLocaleString('ko-KR')}
          </span>
          <span>크레딧</span>
        </div>
      </div>
      <ArrowRight
        className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}
