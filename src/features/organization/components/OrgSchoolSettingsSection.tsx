'use client';

// 조직 학교 AI 생성 설정 폼 (P5-D-B).
// 필드: 학교명 · 학교급 · 홈페이지 · 기본 프롬프트 · 학교 스타일 적용.
// 이 값들은 P5-D-C 에서 조직 컨텍스트 생성에 소비된다 (지금은 저장만).

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useOrganizationSchoolSettings,
  useUpdateOrganizationSchoolSettings,
} from '@/features/organization/hooks/useOrganizationSchoolSettings';
import { SCHOOL_LEVEL_LABELS } from '@/types/domain';

import type { SchoolLevel } from '@/types/domain';

const LEVELS: SchoolLevel[] = ['elementary', 'middle', 'high'];

export function OrgSchoolSettingsSection({ slug }: { slug: string }) {
  const { data, isLoading } = useOrganizationSchoolSettings(slug);
  const update = useUpdateOrganizationSchoolSettings(slug);

  const [schoolName, setSchoolName] = useState('');
  const [schoolLevel, setSchoolLevel] = useState<SchoolLevel | ''>('');
  const [homepageUrl, setHomepageUrl] = useState('');
  const [basePrompt, setBasePrompt] = useState('');
  const [styleEnabled, setStyleEnabled] = useState(true);

  useEffect(() => {
    const s = data?.settings;
    if (!s) return;
    setSchoolName(s.schoolName);
    setSchoolLevel(s.schoolLevel ?? '');
    setHomepageUrl(s.homepageUrl ?? '');
    setBasePrompt(s.basePrompt ?? '');
    setStyleEnabled(s.styleEnabled);
  }, [data?.settings]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!schoolName.trim()) {
      toast.error('학교명은 필수예요');
      return;
    }
    try {
      await update.mutateAsync({
        schoolName: schoolName.trim(),
        schoolLevel: schoolLevel ? schoolLevel : null,
        homepageUrl: homepageUrl.trim() || undefined,
        basePrompt: basePrompt.trim() || null,
        styleEnabled,
      });
      toast.success('저장했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">학교 AI 생성 설정</CardTitle>
        <p className="text-xs text-muted-foreground">
          이 조직 컨텍스트에서 이미지를 생성할 때 자동으로 적용될 정보예요.
          개인 라이브러리 생성에는 영향이 없어요.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-32 animate-pulse rounded-md bg-muted" />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="school-name">학교명</Label>
              <Input
                id="school-name"
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                required
                maxLength={100}
                disabled={update.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="school-level">학교급</Label>
              <select
                id="school-level"
                value={schoolLevel}
                onChange={(e) => setSchoolLevel(e.target.value as SchoolLevel | '')}
                disabled={update.isPending}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">선택 안 함</option>
                {LEVELS.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {SCHOOL_LEVEL_LABELS[lvl]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="school-homepage">홈페이지 URL</Label>
              <Input
                id="school-homepage"
                type="url"
                value={homepageUrl}
                onChange={(e) => setHomepageUrl(e.target.value)}
                placeholder="https://…"
                maxLength={500}
                disabled={update.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="base-prompt">기본 프롬프트</Label>
              <textarea
                id="base-prompt"
                value={basePrompt}
                onChange={(e) => setBasePrompt(e.target.value)}
                maxLength={2000}
                disabled={update.isPending}
                className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="이 조직에서 생성하는 모든 이미지에 함께 붙일 스타일 설명"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="style-enabled"
                type="checkbox"
                checked={styleEnabled}
                onChange={(e) => setStyleEnabled(e.target.checked)}
                disabled={update.isPending}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="style-enabled" className="cursor-pointer text-sm font-normal">
                학교 스타일 적용
              </Label>
            </div>
            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={update.isPending}>
                {update.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                저장
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
