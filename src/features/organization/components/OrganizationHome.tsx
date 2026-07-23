'use client';

// 조직 홈 페이지 — 조직 개요 헤더 + 우측 관리 배너 + 하단에 조직 라이브러리
// 콘텐츠 직접 embed.
// "조직 라이브러리 카드" 는 P5-C 후기 버전에서 제거됨 — 홈에서 바로 그리드가
// 보이게 통합. 서브페이지 /organization/[slug]/library 는 기존 링크 호환용
// 으로 유지 (동일 콘텐츠 렌더).

import { ArrowLeft, ExternalLink, Settings, Users } from 'lucide-react';
import Link from 'next/link';

import { Card, CardContent } from '@/components/ui/card';
import { OrganizationLibraryGrid } from '@/features/organization/components/OrganizationLibraryGrid';
import { useOrganization } from '@/features/organization/hooks/useOrganizations';
import { cn } from '@/lib/utils';

// 역할 모델 단일화: owner = "어드민", 그 외 전부 "멤버".
const ROLE_LABEL: Record<string, string> = {
  owner: '어드민',
  admin: '멤버',
  editor: '멤버',
  viewer: '멤버',
};

export function OrganizationHome({
  slug,
  currentUserId,
}: {
  slug: string;
  currentUserId: string;
}) {
  const { data, isLoading, isError } = useOrganization(slug);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          조직을 불러오지 못했어요. 접근 권한이 없거나 삭제된 조직일 수 있어요.
        </CardContent>
      </Card>
    );
  }

  const org = data.organization;
  const canManage = org.myRole === 'owner' || org.myRole === 'admin';

  return (
    <div className="space-y-6">
      <Link
        href="/organizations"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        내 조직
      </Link>

      {/* 상단: 조직 정보 (좌) + 관리 배너 (우) */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <header className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{org.name}</h1>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              /{org.slug}
            </span>
          </div>
          {org.description && (
            <p className="text-sm text-muted-foreground">{org.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" /> {org.memberCount}명
            </span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium',
                org.myRole === 'owner'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground',
              )}
            >
              내 역할: {ROLE_LABEL[org.myRole] ?? org.myRole}
            </span>
            {org.homepageUrl && (
              <a
                href={org.homepageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" /> 홈페이지
              </a>
            )}
          </div>
        </header>

        <aside className="flex flex-col gap-2 sm:flex-row lg:flex-col lg:w-64">
          <Link href={`/organization/${org.slug}/members`} className="flex-1">
            <Card className="transition-colors hover:border-primary/60 hover:bg-accent/40">
              <CardContent className="flex items-start gap-3 py-3">
                <div className="rounded-md bg-primary/10 p-2 text-primary">
                  <Users className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    {canManage ? '멤버 관리' : '멤버'}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {canManage ? '초대·역할 변경·강퇴' : '멤버 목록·초대'}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>

          {org.myRole === 'owner' && (
            <Link href={`/organization/${org.slug}/settings`} className="flex-1">
              <Card className="transition-colors hover:border-primary/60 hover:bg-accent/40">
                <CardContent className="flex items-start gap-3 py-3">
                  <div className="rounded-md bg-primary/10 p-2 text-primary">
                    <Settings className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">조직 설정</div>
                    <p className="text-xs text-muted-foreground">
                      이름·소개·정책 등
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )}
        </aside>
      </div>

      {/* 조직 라이브러리 직접 embed — 뒤로가기·조직명 헤더는 위에 이미 있으니 숨김 */}
      <OrganizationLibraryGrid
        slug={slug}
        currentUserId={currentUserId}
        hideOrgHeader
      />
    </div>
  );
}
