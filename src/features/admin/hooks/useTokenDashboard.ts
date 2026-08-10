'use client';

// Plan v0.2.9 §M4-1: Admin Token Dashboard 데이터 훅.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface AdminWorkspace {
  id: string;
  slug: string;
  name: string;
  type: 'personal' | 'school' | 'general';
  ownerEmail: string | null;
  credits: number;
  totalIssued: number;
  totalUsed: number;
  monthUsed: number;
  memberCount: number;
  lastUsedAt: string | null;
  poolId: string | null;
}

export interface AdminDashboardData {
  workspaces: AdminWorkspace[];
  totals: {
    workspaces: number;
    credits: number;
    monthUsed: number;
  };
}

const DASHBOARD_KEY = ['admin', 'token-dashboard'] as const;

export function useTokenDashboard() {
  return useQuery({
    queryKey: DASHBOARD_KEY,
    queryFn: async (): Promise<AdminDashboardData> => {
      const res = await fetch('/api/admin/token-dashboard', { cache: 'no-store' });
      if (!res.ok) throw new Error('대시보드 데이터를 불러오지 못했어요');
      const json = (await res.json()) as { data: AdminDashboardData };
      return json.data;
    },
    staleTime: 5_000,
  });
}

export interface LedgerEntry {
  id: number;
  transactionId: string;
  type: 'ISSUE' | 'TRANSFER' | 'USE' | 'REFUND' | 'ADJUST' | 'MIGRATION';
  amount: number;
  memo: string | null;
  actorEmail: string | null;
  jobId: string | null;
  metadata: unknown;
  createdAt: string;
}

export function useOrgLedger(organizationId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['admin', 'ledger', organizationId ?? '__none__'],
    queryFn: async (): Promise<{ entries: LedgerEntry[]; total: number }> => {
      if (!organizationId) throw new Error('no org');
      const res = await fetch(
        `/api/admin/organizations/${organizationId}/ledger?limit=50&offset=0`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error('Ledger 이력을 불러오지 못했어요');
      const json = (await res.json()) as {
        data: { entries: LedgerEntry[]; total: number };
      };
      return json.data;
    },
    enabled: enabled && !!organizationId,
    staleTime: 3_000,
  });
}

export function useAllocateTokens() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      organizationId,
      amount,
      memo,
    }: {
      organizationId: string;
      amount: number;
      memo: string;
    }): Promise<{ balance: number; transactionId: string }> => {
      const res = await fetch(`/api/admin/organizations/${organizationId}/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, memo }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '지급 실패');
      }
      const json = (await res.json()) as {
        data: { balance: number; transactionId: string };
      };
      return json.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: DASHBOARD_KEY });
      qc.invalidateQueries({ queryKey: ['admin', 'ledger', vars.organizationId] });
    },
  });
}

export function useAdjustTokens() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      organizationId,
      delta,
      memo,
    }: {
      organizationId: string;
      delta: number;
      memo: string;
    }): Promise<{ balance: number; transactionId: string }> => {
      const res = await fetch(`/api/admin/organizations/${organizationId}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta, memo }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '조정 실패');
      }
      const json = (await res.json()) as {
        data: { balance: number; transactionId: string };
      };
      return json.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: DASHBOARD_KEY });
      qc.invalidateQueries({ queryKey: ['admin', 'ledger', vars.organizationId] });
    },
  });
}
