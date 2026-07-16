'use client';

// 조직 홈 페이지 — 조직 개요 + 서브페이지로 진입할 수 있는 카드들.
// P5-A: 조직 라이브러리 / 멤버 / 설정 페이지는 이후 sub-phase 에서 완성되므로
//       링크만 뿌리고 실제 페이지는 아직 없을 수 있음 (진입 시 404 가능).

import { ArrowLeft, ExternalLink, Image as ImageIcon, Settings, Users } from 'lucide-react';
import Link from 'next/link';

import { Card, CardContent } from '@/components/ui/card';
import { useOrganization } from '@/features/organization/hooks/useOrganizations';
import { cn } from '@/lib/utils';

const ROLE_LABEL: Record<string, string> = {
  owner: '소유자',
  admin: '관리자',
  editor: '편집자',
  viewer: '뷰어',
};

export function OrganizationHome({ slug }: { slug: string }) {
  const { data, isLoading, isError } = useOrganization(slug);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
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

      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{org.name}</h1>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              /{org.slug}
            </span>
          </div>
          {org.description && (
            <p className="text-sm text-muted-foreground">{org.description}</p>
          )}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
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
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link href={`/organization/${org.slug}/library`}>
          <Card className="transition-colors hover:border-primary/60 hover:bg-accent/40">
            <CardContent className="flex items-start gap-3 py-4">
              <div className="rounded-md bg-primary/10 p-2 text-primary">
                <ImageIcon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold">조직 라이브러리</div>
                <p className="text-xs text-muted-foreground">
                  멤버들이 공유한 이미지 모음
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>

        {canManage && (
          <Link href={`/organization/${org.slug}/members`}>
            <Card className="transition-colors hover:border-primary/60 hover:bg-accent/40">
              <CardContent className="flex items-start gap-3 py-4">
                <div className="rounded-md bg-primary/10 p-2 text-primary">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold">멤버 관리</div>
                  <p className="text-xs text-muted-foreground">
                    초대·역할 변경·강퇴
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        )}

        {org.myRole === 'owner' && (
          <Link href={`/organization/${org.slug}/settings`}>
            <Card className="transition-colors hover:border-primary/60 hover:bg-accent/40">
              <CardContent className="flex items-start gap-3 py-4">
                <div className="rounded-md bg-primary/10 p-2 text-primary">
                  <Settings className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold">조직 설정</div>
                  <p className="text-xs text-muted-foreground">
                    이름·소개·정책 등
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        )}
      </div>
    </div>
  );
}
