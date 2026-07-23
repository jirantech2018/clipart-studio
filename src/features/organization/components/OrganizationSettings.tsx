'use client';

// 조직 설정 페이지 — "학교 AI 생성 설정 = 조직 기본 정보" 통합 (P5-D-B fix).
// 학교명 = 조직명, 학교 홈페이지 = 조직 홈페이지 이므로 두 개 카드로 나누지
// 않고 하나의 폼으로 관리. 참조 이미지 슬롯은 아래에 별도 섹션.

import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OrganizationActivityLogSection } from '@/features/organization/components/OrganizationActivityLogSection';
import { OrgReferenceImagesSection } from '@/features/organization/components/OrgReferenceImagesSection';
import {
  useDeleteOrganization,
  useOrganization,
  useUpdateOrganization,
} from '@/features/organization/hooks/useOrganizations';
import { cn } from '@/lib/utils';
import { SCHOOL_LEVEL_LABELS, SCHOOL_LEVEL_ORDER } from '@/types/domain';

import type { SchoolLevel } from '@/types/domain';

export function OrganizationSettings({ slug }: { slug: string }) {
  const router = useRouter();
  const { data, isLoading } = useOrganization(slug);
  const update = useUpdateOrganization();
  const del = useDeleteOrganization();

  const [name, setName] = useState('');
  const [schoolLevel, setSchoolLevel] = useState<SchoolLevel | ''>('');
  const [basePrompt, setBasePrompt] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const org = data?.organization;

  useEffect(() => {
    if (!org) return;
    setName(org.name);
    setSchoolLevel(org.schoolLevel ?? '');
    setBasePrompt(org.basePrompt ?? '');
  }, [
    org?.name,
    org?.schoolLevel,
    org?.basePrompt,
  ]);

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

  const isMember = !!org.myRole;
  const isOwner = org.myRole === 'owner';
  const canViewActivity = org.myRole === 'owner' || org.myRole === 'admin';
  if (!isMember) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          이 조직의 멤버만 설정을 볼 수 있어요.
        </CardContent>
      </Card>
    );
  }

  async function handleDelete() {
    if (!org) return;
    try {
      await del.mutateAsync(slug);
      toast.success('조직을 삭제했어요');
      router.push('/organizations');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!org) return;
    if (!name.trim()) {
      toast.error('학교명은 필수예요');
      return;
    }
    try {
      await update.mutateAsync({
        slug,
        patch: {
          name: name.trim(),
          schoolLevel: schoolLevel ? schoolLevel : null,
          basePrompt: basePrompt.trim() || null,
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
          여기 저장한 값은 이 조직에서 이미지를 생성할 때 자동으로 적용돼요.
        </p>
      </div>

      {/* 통합 기본 정보 — 학교 AI 생성 설정 = 조직 기본 정보 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">기본 정보 · 학교 AI 생성 설정</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 학교명 + URL 2단 (좁은 화면에서는 자동으로 세로 배치).
                URL 은 조직 슬러그로 편집 불가. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="org-name">학교명 (조직명)</Label>
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
            </div>

            {/* 학교급 버튼 그룹 — 개인 /settings 학교설정 화면과 동일한 UX */}
            <div className="space-y-1.5">
              <Label>학교급</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {SCHOOL_LEVEL_ORDER.map((lvl) => {
                  const selected = schoolLevel === lvl;
                  return (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setSchoolLevel(selected ? '' : lvl)}
                      disabled={update.isPending}
                      aria-pressed={selected}
                      className={cn(
                        'inline-flex h-9 items-center justify-center rounded-md border px-3 text-xs font-medium transition-colors',
                        selected
                          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                          : 'border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
                        update.isPending && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      {SCHOOL_LEVEL_LABELS[lvl]}
                    </button>
                  );
                })}
              </div>
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
            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={update.isPending}>
                {update.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                저장
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* 조직용 참조 이미지 슬롯 — 모든 조직 멤버가 편집 가능. */}
      <OrgReferenceImagesSection slug={slug} canEdit={isMember} />

      {/* 활동 로그 — owner/admin 만 노출. RLS 도 동일 조건. */}
      <OrganizationActivityLogSection slug={slug} canView={canViewActivity} />

      {/* 위험 영역 — 소유자만 노출. 조직 삭제는 soft delete (deleted_at 세팅) 로
          진행되며 30일 유예 후 배치가 하드 삭제할 예정. slug 를 정확히 입력해야
          버튼이 활성화되어 실수로 눌리지 않도록 방지. */}
      {isOwner && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              위험 영역
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">조직 삭제</p>
              <p className="text-xs text-muted-foreground">
                조직을 삭제하면 모든 멤버가 이 조직에 더 이상 접근할 수 없어요.
                조직의 참조 이미지·기본 프롬프트도 함께 회수됩니다. 조직 컨텍스트로
                이미 생성한 이미지는 각 멤버의 개인 라이브러리에 그대로 남아요.
              </p>
            </div>

            {!confirmOpen ? (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setConfirmOpen(true)}
                >
                  조직 삭제
                </Button>
              </div>
            ) : (
              <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-xs text-destructive">
                  정말 삭제하려면 아래에 <span className="font-mono font-semibold">{org.slug}</span>{' '}
                  를 그대로 입력해주세요.
                </p>
                <Input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={org.slug}
                  disabled={del.isPending}
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setConfirmOpen(false);
                      setConfirmText('');
                    }}
                    disabled={del.isPending}
                  >
                    취소
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={confirmText !== org.slug || del.isPending}
                    onClick={handleDelete}
                  >
                    {del.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                    삭제 확정
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
