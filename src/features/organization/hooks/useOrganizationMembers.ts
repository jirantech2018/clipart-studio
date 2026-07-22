'use client';

// Organization members + invites 훅 (P5-B).
// 각 조직 slug 별로 캐시 분리.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  InvitePreview,
  OrganizationInvite,
  OrganizationMember,
  OrganizationRole,
} from '@/types/domain';

const membersKey = (slug: string) => ['org-members', slug] as const;
const invitesKey = (slug: string) => ['org-invites', slug] as const;
const invitePreviewKey = (token: string) => ['invite-preview', token] as const;

export function useOrganizationMembers(slug: string | null) {
  return useQuery({
    queryKey: slug ? membersKey(slug) : ['org-members', 'none'],
    queryFn: async (): Promise<{ members: OrganizationMember[] }> => {
      if (!slug) throw new Error('no slug');
      const res = await fetch(`/api/organizations/${slug}/members`, { cache: 'no-store' });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '멤버 목록 조회 실패');
      }
      const json = (await res.json()) as { data: { members: OrganizationMember[] } };
      return json.data;
    },
    enabled: !!slug,
  });
}

export function useUpdateMemberRole(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: OrganizationRole }) => {
      const res = await fetch(`/api/organizations/${slug}/members/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '역할 변경 실패');
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: membersKey(slug) }),
  });
}

export function useRemoveMember(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/organizations/${slug}/members/${userId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '제거 실패');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: membersKey(slug) });
      qc.invalidateQueries({ queryKey: ['organizations'] });
    },
  });
}

export function useOrganizationInvites(slug: string | null) {
  return useQuery({
    queryKey: slug ? invitesKey(slug) : ['org-invites', 'none'],
    queryFn: async (): Promise<{ invites: OrganizationInvite[] }> => {
      if (!slug) throw new Error('no slug');
      const res = await fetch(`/api/organizations/${slug}/invites`, { cache: 'no-store' });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '초대 목록 조회 실패');
      }
      const json = (await res.json()) as { data: { invites: OrganizationInvite[] } };
      return json.data;
    },
    enabled: !!slug,
  });
}

export function useCreateInvite(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    // role 은 서버에서 항상 editor 로 강제 (역할 모델 단일화 이후). 클라이언트는
    // 굳이 role 을 지정하지 않아도 되지만, 후방 호환을 위해 optional 로 남겨둠.
    mutationFn: async (input: { email: string; role?: OrganizationRole }) => {
      const res = await fetch(`/api/organizations/${slug}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '초대 생성 실패');
      }
      const json = (await res.json()) as { data: { invite: OrganizationInvite } };
      return json.data.invite;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: invitesKey(slug) }),
  });
}

export function useRevokeInvite(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const res = await fetch(`/api/organizations/${slug}/invites/${inviteId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '초대 취소 실패');
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: invitesKey(slug) }),
  });
}

// 초대 링크 페이지 (`/invites/[token]`) 용
export function useInvitePreview(token: string | null) {
  return useQuery({
    queryKey: token ? invitePreviewKey(token) : ['invite-preview', 'none'],
    queryFn: async (): Promise<{ invite: InvitePreview }> => {
      if (!token) throw new Error('no token');
      const res = await fetch(`/api/invites/${token}`, { cache: 'no-store' });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '초대 정보를 불러오지 못했어요');
      }
      const json = (await res.json()) as { data: { invite: InvitePreview } };
      return json.data;
    },
    enabled: !!token,
    retry: false,
  });
}

export function useAcceptInvite() {
  return useMutation({
    mutationFn: async (token: string) => {
      const res = await fetch(`/api/invites/${token}/accept`, { method: 'POST' });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '수락 실패');
      }
      const json = (await res.json()) as {
        data: { organizationSlug: string; joined?: boolean; alreadyMember?: boolean };
      };
      return json.data;
    },
  });
}
