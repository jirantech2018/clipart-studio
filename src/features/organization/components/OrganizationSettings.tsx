'use client';

// 조직 설정 페이지 (P5-D-A).
// 이번 단계에는 기본 정보 편집만 노출 — 학교 AI 생성 설정 (P5-D-B) · 활동
// 로그 · 위험 영역 (P5-D-C) 은 아래 placeholder 섹션으로 형체만 보여준다.
// Owner 아닌 사람이 URL 로 진입하면 서버 API 가 403 을 반환.

import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OrgLogoUploader } from '@/features/organization/components/OrgLogoUploader';
import { OrgReferenceImagesSection } from '@/features/organization/components/OrgReferenceImagesSection';
import { OrgSchoolSettingsSection } from '@/features/organization/components/OrgSchoolSettingsSection';
import {
  useOrganization,
  useUpdateOrganization,
} from '@/features/organization/hooks/useOrganizations';

export function OrganizationSettings({ slug }: { slug: string }) {
  const { data, isLoading } = useOrganization(slug);
  const update = useUpdateOrganization();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [homepageUrl, setHomepageUrl] = useState('');
  const org = data?.organization;

  useEffect(() => {
    if (!org) return;
    setName(org.name);
    setDescription(org.description ?? '');
    setHomepageUrl(org.homepageUrl ?? '');
  }, [org?.name, org?.description, org?.homepageUrl]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (!org) {
    return <p className="text-sm text-muted-foreground">조직을 찾을 수 없어요.</p>;
  }

  const isOwner = org.myRole === 'owner';
  if (!isOwner) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          조직 어드민만 설정을 볼 수 있어요.
        </CardContent>
      </Card>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!org) return;
    if (!name.trim()) {
      toast.error('조직 이름은 필수예요');
      return;
    }
    try {
      await update.mutateAsync({
        slug,
        patch: {
          name: name.trim(),
          description: description.trim(),
          homepageUrl: homepageUrl.trim() || null,
          // avatarUrl 은 로고 업로드 컴포넌트가 별도로 관리하므로 여기서는 미포함.
        },
      });
      toast.success('저장했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패');
    }
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
        <h1 className="text-2xl font-semibold tracking-tight">조직 설정</h1>
        <p className="text-sm text-muted-foreground">
          어드민만 이 페이지를 볼 수 있어요.
        </p>
      </div>

      {/* 기본 정보 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">기본 정보</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="org-name">조직명</Label>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={100}
                disabled={update.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-slug">URL</Label>
              <Input
                id="org-slug"
                value={`/${org.slug}`}
                readOnly
                disabled
                className="text-muted-foreground"
              />
              <p className="text-[11px] text-muted-foreground">
                슬러그 변경은 이번 단계에서 지원하지 않아요.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-description">설명</Label>
              <textarea
                id="org-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                disabled={update.isPending}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="조직 소개를 짧게 적어주세요"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-homepage">홈페이지 URL</Label>
              <Input
                id="org-homepage"
                type="url"
                value={homepageUrl}
                onChange={(e) => setHomepageUrl(e.target.value)}
                placeholder="https://…"
                maxLength={500}
                disabled={update.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label>로고 이미지</Label>
              <OrgLogoUploader slug={slug} currentUrl={org.avatarUrl} />
            </div>
            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={update.isPending}>
                {update.isPending && (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                )}
                저장
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <OrgSchoolSettingsSection slug={slug} />

      <OrgReferenceImagesSection slug={slug} canEdit={isOwner} />

      {/* 활동 로그 — P5-D-C 에서 채워짐 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base text-muted-foreground">활동 로그</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            초대 · 멤버 변경 · 조직 공유 · 커뮤니티 공개/해제 이력이 P5-D-C 에서
            여기 표시됩니다.
          </p>
        </CardContent>
      </Card>

      {/* 위험 영역 — P5-D-C 에서 조직 삭제 UI 통합 */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base text-destructive">위험 영역</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            조직 삭제는 P5-D-C 에서 여기 통합됩니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
