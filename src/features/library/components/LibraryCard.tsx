'use client';

// Design intent: pure gallery card. Metadata (prompt/categories/tags) lives on
// the detail page. Action buttons appear on hover so the grid stays clean.

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
    <div className="group relative aspect-square overflow-hidden rounded-lg border bg-muted shadow-sm">
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

      <div className="pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-1">
        <AIGeneratedBadge />
        {image.isPublic && (
          <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
            공개 중
          </span>
        )}
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
        <Button
          type="button"
          size="sm"
          variant={image.isPublic ? 'secondary' : 'default'}
          onClick={handlePublishToggle}
          disabled={publish.isPending}
          className="h-8 px-2 shadow-md"
        >
          {publish.isPending ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : null}
          {image.isPublic ? '비공개' : '공개'}
        </Button>
      </div>
    </div>
  );
}
