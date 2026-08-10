'use client';

// Admin app_settings 훅. 지금은 initialSignupCredits 하나만 노출.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const KEY = ['admin', 'app-settings'] as const;

export interface AppSettings {
  initialSignupCredits: number;
}

export function useAppSettings() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<{ settings: AppSettings }> => {
      const res = await fetch('/api/admin/app-settings', { cache: 'no-store' });
      if (!res.ok) throw new Error('설정을 불러오지 못했어요');
      const json = (await res.json()) as { data: { settings: AppSettings } };
      return json.data;
    },
    staleTime: 30_000,
  });
}

export function useUpdateAppSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<AppSettings>): Promise<AppSettings> => {
      const res = await fetch('/api/admin/app-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '저장 실패');
      }
      const json = (await res.json()) as { data: { settings: AppSettings } };
      return json.data.settings;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}
