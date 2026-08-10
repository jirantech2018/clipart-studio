'use client';

// 내가 속한 조직 목록 카드 리스트. 각 카드에 이름·설명·멤버 수·내 역할 뱃지.
//
// MY (personal) Organization 은 상단 우측 "내 작업실" 배너로 별도 배치되어
// 항상 눈에 띄는 위치에 있고, grid 에는 school/general 조직만 렌더된다.
//
// M4 Approval Flow: 조직 개설 신청 (SUBMITTED / REVIEWING / REJECTED) 도 이
// 화면 상단에 상태 배너로 함께 표시된다. APPROVED 는 실제 organizations 로
// 카드에 반영되므로 목록 API 가 반환하지 않음.

import { AlertCircle, ArrowRight, Coins, Home, Plus, Users } from 'lucide-react';
import Link from 'next/link';

import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useMyOrganizations } from '@/features/organization/hooks/useOrganizations';
import { useMyOrganizationRequests } from '@/features/organization/hooks/useOrganizationRequests';
import { cn } from '@/lib/utils';

import type { OrganizationRequest, OrganizationWithMyRole } from '@/types/domain';

// 역할 모델 단일화: owner = "어드민", 그 외 전부 "멤버".
const ROLE_LABEL: Record<string, string> = {
  owner: '어드민',
  admin: '멤버',
  editor: '멤버',
  viewer: '멤버',
};

export function OrganizationList() {
  const { data, isLoading, isError, refetch } = useMyOrganizations();
  const requestsQuery = useMyOrganizationRequests();

  const orgs = data?.organizations ?? [];
  const personalOrg = orgs.find((o) => o.type === 'personal') ?? null;
  const otherOrgs = orgs.filter((o) => o.type !== 'personal');
  const requests = requestsQuery.data?.requests ?? [];

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

      {/* 진행 중인 조직 개설 신청 배너 (SUBMITTED / REVIEWING / REJECTED) */}
      {requests.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">진행 중인 조직 신청</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {requests.map((req) => (
              <RequestStatusCard key={req.id} req={req} />
            ))}
          </div>
        </div>
      )}

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

function RequestStatusCard({ req }: { req: OrganizationRequest }) {
  // 상태 별 문구·색·진행 표시 (3단계 stepper: 신청 · 검토 · 승인).
  const isSubmitted = req.status === 'SUBMITTED';
  const isReviewing = req.status === 'REVIEWING';
  const isRejected = req.status === 'REJECTED';

  const statusBadge = isRejected
    ? { text: '승인되지 않음', cls: 'bg-destructive/10 text-destructive' }
    : isReviewing
      ? { text: '검토 중', cls: 'bg-amber-100 text-amber-700' }
      : { text: '신청 완료', cls: 'bg-sky-100 text-sky-700' };

  return (
    <Card className={cn('border', isRejected && 'border-destructive/40')}>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">{req.organizationName}</h3>
            <p className="text-xs text-muted-foreground">/{req.desiredSlug}</p>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
              statusBadge.cls,
            )}
          >
            {statusBadge.text}
          </span>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-2 text-xs">
          <Step label="신청" state="done" />
          <StepConnector done={isReviewing || isRejected} />
          <Step
            label="검토"
            state={isReviewing ? 'active' : isRejected ? 'done' : 'todo'}
          />
          <StepConnector done={isRejected} />
          <Step label="승인" state={isRejected ? 'rejected' : 'todo'} />
        </div>

        {isSubmitted && (
          <p className="text-xs text-muted-foreground">관리자가 신청 내용을 확인할 예정입니다.</p>
        )}
        {isReviewing && (
          <p className="text-xs text-muted-foreground">신청 내용을 관리자가 검토하고 있습니다.</p>
        )}
        {isRejected && req.rejectionReason && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
            <div className="mb-1 inline-flex items-center gap-1 font-medium text-destructive">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              거절 사유
            </div>
            <p className="whitespace-pre-wrap text-foreground/80">{req.rejectionReason}</p>
            <div className="mt-2">
              <Link
                href="/organizations/new"
                className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))}
              >
                다시 신청
              </Link>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Step({
  label,
  state,
}: {
  label: string;
  state: 'done' | 'active' | 'todo' | 'rejected';
}) {
  const dotCls =
    state === 'done'
      ? 'bg-primary text-primary-foreground'
      : state === 'active'
        ? 'bg-amber-500 text-white'
        : state === 'rejected'
          ? 'bg-destructive text-white'
          : 'bg-muted text-muted-foreground';
  const glyph = state === 'done' ? '✓' : state === 'rejected' ? '×' : '●';
  return (
    <div className="inline-flex items-center gap-1">
      <span
        className={cn(
          'inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold',
          dotCls,
        )}
        aria-hidden="true"
      >
        {glyph}
      </span>
      <span
        className={cn(
          state === 'todo' ? 'text-muted-foreground' : 'text-foreground',
          state === 'active' && 'font-medium',
        )}
      >
        {label}
      </span>
    </div>
  );
}

function StepConnector({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn('h-px flex-1 min-w-[8px]', done ? 'bg-primary/50' : 'bg-muted-foreground/30')}
    />
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
