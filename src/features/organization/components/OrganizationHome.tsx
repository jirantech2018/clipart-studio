'use client';

// 조직 홈 페이지 — 조직 개요 헤더 + 우측 관리 배너 + 하단에 조직 라이브러리
// 콘텐츠 직접 embed.
// "조직 라이브러리 카드" 는 P5-C 후기 버전에서 제거됨 — 홈에서 바로 그리드가
// 보이게 통합. 서브페이지 /organization/[slug]/library 는 기존 링크 호환용
// 으로 유지 (동일 콘텐츠 렌더).

import { ArrowLeft, ExternalLink, Plus, Settings, Users } from 'lucide-react';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LibraryGrid } from '@/features/library/components/LibraryGrid';
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
  const isPersonal = org.type === 'personal';

  return (
    <div className="space-y-6">
      <Link
        href="/organizations"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        우리학교 워크스페이스
      </Link>

      {/* 상단: 조직 정보 (좌) + 관리 배너 (우) */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <header className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {isPersonal ? '내 작업실' : org.name}
            </h1>
            {/* Personal (MY) Organization 의 hidden slug (`personal-{user_id}`) 는
                사용자 화면에 절대 노출하지 않는다 (D-open-2). 일반 조직은 slug 를
                뱃지로 표시. */}
            {!isPersonal && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-sm text-muted-foreground">
                /{org.slug}
              </span>
            )}
          </div>
          {org.description && !isPersonal && (
            <p className="text-sm text-muted-foreground">{org.description}</p>
          )}
          {isPersonal && (
            <p className="text-sm text-muted-foreground">
              나만 사용하는 개인 워크스페이스입니다.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" /> {org.memberCount}명
            </span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-sm font-medium',
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
          {/* Primary CTA: 이 워크스페이스 컨텍스트에서 클립아트 만들기.
              MY 는 `/organization/my/generate` (URL alias), 일반은
              `/organization/{slug}/generate`. Job 생성 시 조직 컨텍스트
              (org_id) 가 자동으로 반영되어 M3 이후 조직 pool 이 소진된다. */}
          <Link
            href={isPersonal ? '/organization/my/generate' : `/organization/${org.slug}/generate`}
            className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
          >
            <Plus className="mr-1 h-4 w-4" />
            클립아트 만들기
          </Link>

          {/* Personal (MY) Organization 은 owner 1인 고정 · 초대·해체 없음.
              멤버·설정 카드를 노출하지 않는다 (M2 완료 기준 6). */}
          {!isPersonal && (
            <>
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
            </>
          )}
        </aside>
      </div>

      {/* Plan v0.2.7 §M3-2 (C 방향): 통일된 LibraryGrid + workspace 필터.
          일반 조직은 3-tab (전체/이 조직에서 만든 이미지/공유받은 이미지) 을
          노출하고, MY workspace 는 다른 조직에서 MY 로 공유될 일이 없어
          탭을 숨긴다. 기존 OrganizationLibraryGrid (share 전용 legacy) 는
          이 라우트에서 사용하지 않는다. */}
      <LibraryGrid organizationSlug={slug} showWorkspaceTabs={!isPersonal} />
    </div>
  );
}
