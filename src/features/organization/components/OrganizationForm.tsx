'use client';

// Plan M4: 조직 개설 "신청" 폼. 예전에는 즉시 organizations 를 만들었지만
// 이제는 organization_requests 로 SUBMITTED 상태의 신청만 남긴다. 승인은
// Super Admin 이 /admin/organization-requests 에서 수행하고, 승인 시점에
// 실제 organizations + owner membership + token_pool (트리거) 이 생성된다.

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCreateOrganizationRequest } from '@/features/organization/hooks/useOrganizationRequests';

function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 64);
}

export function OrganizationForm() {
  const router = useRouter();
  const submit = useCreateOrganizationRequest();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [homepageUrl, setHomepageUrl] = useState('');

  function handleNameChange(next: string) {
    setName(next);
    if (!slugTouched) {
      setSlug(normalizeSlug(next));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) {
      toast.error('이름과 URL 이름은 필수예요');
      return;
    }
    try {
      await submit.mutateAsync({
        slug,
        name: name.trim(),
        description: description.trim(),
        homepageUrl: homepageUrl.trim() || undefined,
      });
      toast.success('조직 개설 신청이 완료됐어요');
      router.push('/organizations');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '신청 실패');
    }
  }

  const busy = submit.isPending;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link
        href="/organizations"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        조직 목록으로
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>새 조직 신청</CardTitle>
          <p className="text-sm text-muted-foreground">
            학교 또는 팀에서 함께 사용할 새로운 작업 공간을 신청합니다.
            <br />
            관리자 검토 후 승인되면 조직 작업 공간이 생성됩니다.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="org-name">조직 이름</Label>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="예: 서초초등학교 정보부"
                maxLength={100}
                disabled={busy}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="org-slug">URL 이름</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">/organization/</span>
                <Input
                  id="org-slug"
                  value={slug}
                  onChange={(e) => {
                    setSlug(normalizeSlug(e.target.value));
                    setSlugTouched(true);
                  }}
                  placeholder="seocho-info"
                  disabled={busy}
                  required
                />
              </div>
              <p className="text-sm text-muted-foreground">
                조직 페이지 주소에 쓰여요. 3~64자, 소문자·숫자·하이픈만. 승인 이후에는 바꿀 수
                없어요.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="org-desc">소개 (선택)</Label>
              <Textarea
                id="org-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="어떤 조직인지 짧게 설명해주세요."
                maxLength={500}
                rows={3}
                disabled={busy}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="org-homepage">홈페이지 (선택)</Label>
              <Input
                id="org-homepage"
                type="url"
                value={homepageUrl}
                onChange={(e) => setHomepageUrl(e.target.value)}
                placeholder="https://school.example.com"
                maxLength={500}
                disabled={busy}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Link
                href="/organizations"
                className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-accent"
              >
                취소
              </Link>
              <Button type="submit" disabled={busy}>
                {busy ? '신청 중…' : '조직 개설 신청'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
