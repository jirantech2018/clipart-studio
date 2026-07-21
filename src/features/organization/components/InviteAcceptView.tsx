'use client';

// 초대 링크 진입 시 표시. 로그인 필수 (서버에서 이미 리다이렉트).
// 초대의 상태에 따라 4가지 UX 분기:
//   1) 정상 (수락 가능)         → "수락" 버튼
//   2) 이미 멤버                → 조직 홈으로 안내
//   3) 이메일 불일치            → 로그인 이메일 안내 + 재로그인 유도
//   4) 만료 or 취소             → 재발송 안내

import { AlertCircle, ArrowRight, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useAcceptInvite,
  useInvitePreview,
} from '@/features/organization/hooks/useOrganizationMembers';

import type { OrganizationRole } from '@/types/domain';

const ROLE_LABEL: Record<OrganizationRole, string> = {
  owner: '소유자',
  admin: '관리자',
  editor: '편집자',
  viewer: '뷰어',
};

export function InviteAcceptView({
  token,
  currentUserEmail,
}: {
  token: string;
  currentUserEmail: string;
}) {
  const router = useRouter();
  const { data, isLoading, isError, error } = useInvitePreview(token);
  const accept = useAcceptInvite();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          초대 정보를 불러오는 중…
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
          <XCircle className="h-8 w-8 text-destructive" />
          <p>{error instanceof Error ? error.message : '초대를 불러오지 못했어요'}</p>
          <Link href="/organizations" className="text-primary underline">
            내 조직으로 이동
          </Link>
        </CardContent>
      </Card>
    );
  }

  const inv = data.invite;

  async function handleAccept() {
    try {
      const res = await accept.mutateAsync(token);
      toast.success(res.alreadyMember ? '이미 멤버였어요' : '조직에 가입했어요');
      router.push(`/organization/${res.organizationSlug}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '수락 실패');
    }
  }

  // 우선순위: emailMismatch → expired → alreadyMember → 정상.
  //   이메일 불일치를 가장 먼저 판정해야 한다 — 로그인한 사용자가 이미 조직 멤버라도
  //   초대는 다른 사람 앞으로 발송된 것이면 그 사실을 먼저 안내해야 정확한 UX.

  // 이메일 불일치 케이스 (초대 대상자가 아닌 사람이 링크를 열었음)
  if (inv.emailMismatch) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="h-5 w-5 text-amber-600" />
            이 초대는 다른 사람 앞으로 발송됐어요
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            초대 대상: <strong>{inv.targetEmail}</strong>
          </p>
          <p>
            현재 로그인 계정: <span className="font-medium">{currentUserEmail}</span>
          </p>
          <p className="pt-2 text-xs text-muted-foreground">
            초대받은 분에게 이 링크를 전달하거나, 대상 이메일로 로그인 후 다시 열어주세요.
          </p>
        </CardContent>
      </Card>
    );
  }

  // 이미 멤버 케이스 (로그인 = 초대 대상인데 이미 그 조직 소속)
  if (inv.alreadyMember) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            이미 멤버예요
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            <strong>{inv.organizationName}</strong> 에는 이미 참여하고 있어요.
          </p>
          <Link
            href={`/organization/${inv.organizationSlug}`}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            조직으로 이동 <ArrowRight className="h-3 w-3" />
          </Link>
        </CardContent>
      </Card>
    );
  }

  // 만료 케이스
  if (inv.expired) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <XCircle className="h-5 w-5 text-destructive" />
            만료된 초대예요
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            이 초대 링크는 {new Date(inv.expiresAt).toLocaleString('ko-KR')} 에 만료됐어요.
          </p>
          <p className="text-xs text-muted-foreground">
            조직 관리자에게 재발송을 요청해주세요.
          </p>
        </CardContent>
      </Card>
    );
  }

  // 정상 케이스 — 수락 버튼
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">조직 초대</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <div className="text-xl font-semibold">{inv.organizationName}</div>
          <p className="text-xs text-muted-foreground">/{inv.organizationSlug}</p>
        </div>

        <div className="space-y-1 text-sm">
          <div>
            역할: <strong>{ROLE_LABEL[inv.role]}</strong>
          </div>
          {inv.inviterEmail && (
            <div className="text-muted-foreground">
              초대자: {inv.inviterEmail}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            만료: {new Date(inv.expiresAt).toLocaleString('ko-KR')}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link
            href="/organizations"
            className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-accent"
          >
            나중에
          </Link>
          <Button type="button" onClick={handleAccept} disabled={accept.isPending}>
            {accept.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            수락하고 참여
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
