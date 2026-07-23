'use client';

// 조직 학교 AI 설정 훅 (P5-D-B).
// 저장·조회만. 실제 이미지 생성 파이프라인 연결은 P5-D-C.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { SchoolLevel } from '@/types/domain';

export interface OrgSchoolSettings {
  organizationId: string;
  schoolName: string;
  homepageUrl: string | null;
  schoolLevel: SchoolLevel | null;
  basePrompt: string | null;
  styleEnabled: boolean;
  updatedAt: string;
}

export interface OrgSchoolSettingsInput {
  schoolName: string;
  schoolLevel?: SchoolLevel | null;
  homepageUrl?: string;
  basePrompt?: string | null;
  styleEnabled?: boolean;
}

const settingsKey = (slug: string) => ['org-school-settings', slug] as const;

export function useOrganizationSchoolSettings(slug: string | null) {
  return useQuery({
    queryKey: slug ? settingsKey(slug) : ['org-school-settings', 'none'],
    queryFn: async (): Promise<{ settings: OrgSchoolSettings | null }> => {
      if (!slug) throw new Error('no slug');
      const res = await fetch(`/api/organizations/${slug}/school-settings`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '학교 설정 조회 실패');
      }
      const json = (await res.json()) as { data: { settings: OrgSchoolSettings | null } };
      return json.data;
    },
    enabled: !!slug,
  });
}

export function useUpdateOrganizationSchoolSettings(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: OrgSchoolSettingsInput): Promise<OrgSchoolSettings> => {
      const res = await fetch(`/api/organizations/${slug}/school-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '저장 실패');
      }
      const json = (await res.json()) as { data: { settings: OrgSchoolSettings } };
      return json.data.settings;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKey(slug) });
    },
  });
}
