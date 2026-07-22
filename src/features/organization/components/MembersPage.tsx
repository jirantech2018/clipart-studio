'use client';

// 멤버 + 초대 관리 화면.
// 접근 범위:
//   - 모든 조직 멤버(owner/admin/editor/viewer)가 페이지 진입 가능.
//   - editor/viewer 는 멤버 목록을 "보기"만 가능 (역할 변경·강퇴 컨트롤 미노출).
//     단, 본인은 "나가기" 버튼으로 조직에서 탈퇴 가능.
//   - 초대 폼은 모두에게 노출 (팀 협업의 자연스러운 부분).
//     단, admin 역할 초대는 관리자만 허용 (API 에서 재검증).
//   - pending 초대 목록은 관리자만 (기존 GET/DELETE API 가 admin+).
// UI 흐름:
//   상단: 조직 이름 (홈 링크)
//   섹션 1: 멤버 목록
//   섹션 2: 초대 폼 (전원) + pending 초대 목록 (관리자)

import { ArrowLeft, Check, Copy, Loader2, Trash2, UserPlus, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useOrganization } from '@/features/organization/hooks/useOrganizations';
import {
  useCreateInvite,
  useOrganizationInvites,
  useOrganizationMembers,
  useRemoveMember,
  useRevokeInvite,
  useUpdateMemberRole,
} from '@/features/organization/hooks/useOrganizationMembers';
import { cn } from '@/lib/utils';

import type { OrganizationRole } from '@/types/domain';

const ROLE_LABEL: Record<OrganizationRole, string> = {
  owner: '소유자',
  admin: '관리자',
  editor: '편집자',
  viewer: '뷰어',
};

const ROLE_DESC: Record<OrganizationRole, string> = {
  owner: '모든 권한',
  admin: '멤버·이미지·설정 관리',
  editor: '조직에 이미지 공유, 열람·다운로드',
  viewer: '열람·다운로드만',
};

export function MembersPage({ slug }: { slug: string }) {
  const { data: orgData, isLoading: orgLoading } = useOrganization(slug);
  const { isLoading: membersLoading } = useOrganizationMembers(slug);

  const org = orgData?.organization;
  const canManage = org?.myRole === 'owner' || org?.myRole === 'admin';

  if (orgLoading || membersLoading) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  }
  if (!org) {
    return <p className="text-sm text-muted-foreground">조직을 찾을 수 없어요.</p>;
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/organization/${slug}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {org.name}
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {canManage ? '멤버 관리' : '멤버'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {canManage
            ? '이 조직에 속한 사람과 대기 중인 초대를 관리해요.'
            : '이 조직에 함께 있는 사람을 확인하고, 새 멤버를 초대할 수 있어요.'}
        </p>
      </div>

      <MembersSection slug={slug} canManage={canManage} />

      <InvitesSection slug={slug} canManage={canManage} />

      {canManage && <PendingInvitesList slug={slug} />}
    </div>
  );
}

// ---------- 멤버 리스트 ----------

function MembersSection({ slug, canManage }: { slug: string; canManage: boolean }) {
  const { data } = useOrganizationMembers(slug);
  const updateRole = useUpdateMemberRole(slug);
  const remove = useRemoveMember(slug);

  const members = data?.members ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">멤버 {members.length}명</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {members.map((m) => {
          // owner 이거나 관리자가 아닌 뷰어에게는 역할을 "읽기 전용 뱃지" 로 보여준다.
          const showRoleSelect = canManage && m.role !== 'owner';
          // 강퇴 버튼은 관리자만 (단, 본인은 언제나 "나가기" 가능. owner 는 API 에서 차단).
          const showRemoveButton = (canManage || m.isMe) && m.role !== 'owner';

          return (
            <div
              key={m.userId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{m.email}</span>
                  {m.isMe && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      나
                    </span>
                  )}
                  {m.status === 'suspended' && (
                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive">
                      정지됨
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {m.role === 'owner' ? (
                  <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">
                    소유자
                  </span>
                ) : showRoleSelect ? (
                  <select
                    value={m.role}
                    onChange={async (e) => {
                      const next = e.target.value as OrganizationRole;
                      try {
                        await updateRole.mutateAsync({ userId: m.userId, role: next });
                        toast.success(`${ROLE_LABEL[next]} 로 변경했어요`);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : '변경 실패');
                      }
                    }}
                    disabled={updateRole.isPending}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    title={ROLE_DESC[m.role]}
                  >
                    <option value="admin">관리자</option>
                    <option value="editor">편집자</option>
                    <option value="viewer">뷰어</option>
                  </select>
                ) : (
                  <span
                    className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
                    title={ROLE_DESC[m.role]}
                  >
                    {ROLE_LABEL[m.role]}
                  </span>
                )}
                {showRemoveButton && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      if (!confirm(m.isMe ? '이 조직에서 나가시겠어요?' : `${m.email} 을(를) 강퇴할까요?`)) return;
                      try {
                        await remove.mutateAsync(m.userId);
                        toast.success(m.isMe ? '조직에서 나왔어요' : '강퇴했어요');
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : '실패');
                      }
                    }}
                    disabled={remove.isPending}
                    aria-label={m.isMe ? '나가기' : '강퇴'}
                    title={m.isMe ? '나가기' : '강퇴'}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ---------- 초대 폼 ----------

function InvitesSection({ slug, canManage }: { slug: string; canManage: boolean }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrganizationRole>('editor');
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const create = useCreateInvite(slug);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      const invite = await create.mutateAsync({ email: email.trim().toLowerCase(), role });
      setLastInviteUrl(invite.inviteUrl);
      setEmail('');
      toast.success('초대 링크가 만들어졌어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '초대 실패');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">새로 초대</CardTitle>
        <p className="text-xs text-muted-foreground">
          이메일 발송은 아직 없어요. 링크를 만들고 원하는 방법(카톡·이메일 등)으로 직접 전달해주세요.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1 space-y-1.5">
            <Label htmlFor="invite-email">이메일</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@school.co.kr"
              required
              disabled={create.isPending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-role">역할</Label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as OrganizationRole)}
              disabled={create.isPending}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {/* editor/viewer 는 admin 역할로 초대할 수 없음 (권한 상향 방지) */}
              {canManage && <option value="admin">관리자</option>}
              <option value="editor">편집자</option>
              <option value="viewer">뷰어</option>
            </select>
          </div>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <UserPlus className="mr-1 h-3.5 w-3.5" />}
            초대 링크 만들기
          </Button>
        </form>

        {lastInviteUrl && (
          <div className="mt-4 space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
            <p className="text-xs font-medium text-primary">초대 링크가 준비됐어요 (7일 유효)</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-background px-2 py-1 text-xs">
                {lastInviteUrl}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(lastInviteUrl);
                    toast.success('링크를 복사했어요');
                  } catch {
                    toast.error('복사 실패. 위 텍스트를 직접 선택해주세요.');
                  }
                }}
              >
                <Copy className="mr-1 h-3 w-3" /> 복사
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              받는 사람은 이 링크를 열고 초대에 명시된 이메일로 로그인해야 수락할 수 있어요.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- pending 초대 목록 ----------

function PendingInvitesList({ slug }: { slug: string }) {
  const { data } = useOrganizationInvites(slug);
  const revoke = useRevokeInvite(slug);

  const invites = data?.invites ?? [];
  if (invites.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">대기 중인 초대 {invites.length}개</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {invites.map((inv) => {
          const expired = new Date(inv.expiresAt) < new Date();
          return (
            <div
              key={inv.id}
              className={cn(
                'flex flex-wrap items-center justify-between gap-2 rounded-md border p-3',
                expired && 'opacity-60',
              )}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{inv.email}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    {ROLE_LABEL[inv.role]}
                  </span>
                  {expired && (
                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive">
                      만료
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  만료: {new Date(inv.expiresAt).toLocaleString('ko-KR')}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(inv.inviteUrl);
                      toast.success('링크를 복사했어요');
                    } catch {
                      toast.error('복사 실패');
                    }
                  }}
                  title="링크 복사"
                  aria-label="링크 복사"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    if (!confirm(`${inv.email} 초대를 취소할까요?`)) return;
                    try {
                      await revoke.mutateAsync(inv.id);
                      toast.success('취소했어요');
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : '실패');
                    }
                  }}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  title="초대 취소"
                  aria-label="초대 취소"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
        <p className="pt-1 text-[10px] text-muted-foreground">
          <Check className="mr-1 inline h-3 w-3" />
          같은 이메일로 다시 초대하면 링크가 갱신됩니다.
        </p>
      </CardContent>
    </Card>
  );
}
