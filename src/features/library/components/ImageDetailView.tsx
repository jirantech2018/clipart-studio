'use client';

// Design Ref: §5.4 Image Detail Page — full image + metadata + actions
// Non-Negotiable Rule 3: AIGeneratedBadge required.

import { ArrowLeft, Download, Link2, Loader2, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { AIGeneratedBadge } from '@/components/ui/AIGeneratedBadge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LineageTree } from '@/features/library/components/LineageTree';
import {
  downloadImageFile,
  usePublishToggle,
  useShareableToggle,
} from '@/features/library/hooks/useMyImages';
import { useImageDetail } from '@/features/library/hooks/useImageDetail';
import { cn } from '@/lib/utils';

export function ImageDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useImageDetail(id);
  const publish = usePublishToggle();
  const shareable = useShareableToggle();
  const [downloading, setDownloading] = useState(false);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          불러오는 중…
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
          이미지를 불러오지 못했어요.
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            다시 시도
          </Button>
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            이전으로
          </Button>
        </CardContent>
      </Card>
    );
  }

  const image = data;

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadImageFile(image.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '다운로드 실패');
    } finally {
      setDownloading(false);
    }
  }

  async function handlePublishToggle() {
    try {
      await publish.mutateAsync({ id: image.id, isPublic: !image.isPublic });
      toast.success(!image.isPublic ? '워크스페이스에 공개했어요' : '비공개로 전환했어요');
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '변경 실패');
    }
  }

  async function handleCopyLink() {
    // 소유자가 링크를 처음 복사할 때 이미지가 아직 공유 상태가 아니면,
    // 링크를 실제로 유효하게 만들기 위해 is_shareable 을 자동으로 켠다.
    // (커뮤니티 노출 = is_public 은 건드리지 않음 — 링크 공유와 별개.)
    if (image.isOwner && !image.isShareable && !image.isPublic) {
      try {
        await shareable.mutateAsync({ id: image.id, isShareable: true });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '링크 공유 설정 실패');
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('링크를 복사했어요');
    } catch {
      toast.error('링크 복사에 실패했어요. 브라우저 주소창을 사용해주세요.');
    }
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => router.back()}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        이전
      </button>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="relative overflow-hidden rounded-xl border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.fullUrl}
            alt={image.prompt}
            className="h-auto w-full object-contain"
          />
          <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
            <AIGeneratedBadge />
            {image.isPublic && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
                공개 중
              </span>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <section className="space-y-1">
            <h2 className="text-lg font-semibold">만들고 싶었던 내용</h2>
            <p className="text-sm text-muted-foreground">{image.prompt}</p>
          </section>

          {image.categories.length > 0 && (
            <section className="space-y-1">
              <h3 className="text-sm font-medium">분류</h3>
              <div className="flex flex-wrap gap-1">
                {image.categories.map((c) => (
                  <span
                    key={c}
                    className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </section>
          )}

          {image.tags.length > 0 && (
            <section className="space-y-1">
              <h3 className="text-sm font-medium">관련 키워드</h3>
              <div className="flex flex-wrap gap-1">
                {image.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-1 text-xs text-muted-foreground">
            <div>
              생성일:{' '}
              {new Date(image.createdAt).toLocaleString('ko-KR', {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </div>
            <details className="pt-1">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                세부정보
              </summary>
              <div className="mt-1 space-y-0.5 pl-1 text-[11px]">
                <div>모델: {image.model}</div>
                {image.seed !== null && <div>Seed: {image.seed}</div>}
              </div>
            </details>
          </section>

          <div className="space-y-2 pt-2">
            <Link
              href={`/generate?parent=${image.id}`}
              className={cn(buttonVariants({ size: 'default' }), 'w-full')}
            >
              <Sparkles className="mr-1 h-4 w-4" />이 이미지로 다시 만들기
            </Link>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleDownload}
                disabled={downloading}
                className="flex-1"
              >
                {downloading ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Download className="mr-1 h-3 w-3" />
                )}
                다운로드
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleCopyLink}
                disabled={shareable.isPending}
                title="이미지 페이지 링크 복사"
                aria-label="링크 복사"
              >
                {shareable.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Link2 className="h-3 w-3" />
                )}
              </Button>
              {image.isOwner && (
                <Button
                  type="button"
                  variant={image.isPublic ? 'secondary' : 'outline'}
                  onClick={handlePublishToggle}
                  disabled={publish.isPending}
                  title={image.isPublic ? '비공개로 전환' : '워크스페이스에 공개'}
                >
                  {publish.isPending ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : null}
                  {image.isPublic ? '비공개' : '공개'}
                </Button>
              )}
            </div>
          </div>
        </aside>
      </div>

      <LineageTree imageId={image.id} />
    </div>
  );
}
