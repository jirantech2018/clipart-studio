'use client';

// Design Ref: §5.4 Library card — 썸네일 + 공개 여부 + [다운로드/공개 토글]
// Policy: no delete, no pending state. All library images are permanent saved assets.
// Non-Negotiable Rule 3: AI 라벨 노출

import { Download, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { AIGeneratedBadge } from '@/components/ui/AIGeneratedBadge';
import { Button } from '@/components/ui/button';
import { downloadImageFile, usePublishToggle } from '@/features/library/hooks/useMyImages';

import type { LibraryImage } from '@/features/library/hooks/useMyImages';

export function LibraryCard({ image }: { image: LibraryImage }) {
  const [downloading, setDownloading] = useState(false);
  const publish = usePublishToggle();

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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '변경 실패');
    }
  }

  return (
    <div className="group relative overflow-hidden rounded-lg border bg-card shadow-sm">
      <Link
        href={`/image/${image.id}`}
        aria-label="상세 보기"
        className="relative block aspect-square w-full bg-muted"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.thumbnailUrl}
          alt={image.prompt}
          className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
          loading="lazy"
        />
        <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
          <AIGeneratedBadge />
          {image.isPublic && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
              공개 중
            </span>
          )}
        </div>
      </Link>

      <div className="space-y-2 p-3">
        <p className="line-clamp-2 text-xs text-muted-foreground" title={image.prompt}>
          {image.prompt}
        </p>
        {image.categories.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {image.categories.map((cat) => (
              <span
                key={cat}
                className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
              >
                {cat}
              </span>
            ))}
          </div>
        )}
        {image.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {image.tags.slice(0, 5).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
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
            size="sm"
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
        </div>
      </div>
    </div>
  );
}
