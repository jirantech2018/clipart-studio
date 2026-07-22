'use client';

// 조직 라이브러리용 이미지 카드. LibraryCard 와 유사하지만 소유자 전용 액션
// (공개 토글) 대신 조직 컨텍스트에 맞는 액션(내리기) 을 노출.

import { Download, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { AIGeneratedBadge } from '@/components/ui/AIGeneratedBadge';
import { Button } from '@/components/ui/button';
import { downloadImageFile } from '@/features/library/hooks/useMyImages';
import { useUnshareImage } from '@/features/organization/hooks/useOrganizationShares';

import type { OrganizationImage } from '@/features/organization/hooks/useOrganizationShares';

export function OrganizationImageCard({
  slug,
  image,
  canUnshare,
}: {
  slug: string;
  image: OrganizationImage;
  canUnshare: boolean;
}) {
  const [downloading, setDownloading] = useState(false);
  const unshare = useUnshareImage();

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

  async function handleUnshare() {
    if (!confirm('이 이미지를 조직 라이브러리에서 내릴까요? (원본은 그대로 유지됩니다)')) return;
    try {
      await unshare.mutateAsync({ slug, imageId: image.id });
      toast.success('조직에서 내렸어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '내리기 실패');
    }
  }

  return (
    <div
      className="group relative overflow-hidden rounded-lg border bg-muted shadow-sm transition-shadow"
      style={{ aspectRatio: `${image.width} / ${image.height}` }}
    >
      <Link
        href={`/image/${image.id}`}
        className="block h-full w-full"
        title={image.prompt}
        aria-label={image.prompt}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.thumbnailUrl}
          alt={image.prompt}
          className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
          loading="lazy"
        />
      </Link>

      <div className="pointer-events-none absolute right-2 top-2">
        <AIGeneratedBadge />
      </div>

      <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={handleDownload}
          disabled={downloading}
          className="h-8 px-2 shadow-md"
        >
          {downloading ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Download className="mr-1 h-3 w-3" />
          )}
          다운로드
        </Button>
        {canUnshare && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleUnshare}
            disabled={unshare.isPending}
            className="h-8 px-2 shadow-md text-destructive hover:bg-destructive/10 hover:text-destructive"
            title="조직에서 내리기"
            aria-label="조직에서 내리기"
          >
            {unshare.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <X className="h-3 w-3" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
