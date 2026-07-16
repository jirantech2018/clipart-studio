'use client';

// 내가 속한 조직 목록 카드 리스트. 각 카드에 이름·설명·멤버 수·내 역할 뱃지.

import { Plus, Users } from 'lucide-react';
import Link from 'next/link';

import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useMyOrganizations } from '@/features/organization/hooks/useOrganizations';
import { cn } from '@/lib/utils';

const ROLE_LABEL: Record<string, string> = {
  owner: '소유자',
  admin: '관리자',
  editor: '편집자',
  viewer: '뷰어',
};

export function OrganizationList() {
  const { data, isLoading, isError, refetch } = useMyOrganizations();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">내 조직</h1>
          <p className="text-sm text-muted-foreground">
            여러 사람이 같은 이미지 자산을 함께 쓰는 공간이에요.
          </p>
        </div>
        <Link href="/organizations/new" className={buttonVariants({ size: 'sm' })}>
          <Plus className="mr-1 h-4 w-4" /> 새 조직
        </Link>
      </div>

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
      ) : data && data.organizations.length === 0 ? (
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
          {data?.organizations.map((org) => (
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
                        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
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
