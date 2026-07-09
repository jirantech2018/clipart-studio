'use client';

// Design Ref: §5.4 Library card — 썸네일 + 공개 여부 + [다운로드/공개 토글]
// Policy: no delete, no pending state. All library images are permanent saved assets.
// Non-Negotiable Rule 3: AI 라벨 노출

import { Download, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { AIGeneratedBadge } from '@/components/ui/AIGeneratedBadge';
import { Button } from '@/components/ui/button';
import { requestDownload, usePublishToggle } from '@/features/library/hooks/useMyImages';

import type { LibraryImage } from '@/features/library/hooks/useMyImages';

export function LibraryCard({ image }: { image: LibraryImage }) {
  const [downloading, setDownloading] = useState(false);
  const publish = usePublishToggle();

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      const url = await requestDownload(image.id);
      const a = document.createElement('a');
      a.href = url;
      a.download = `clipart-${image.id}.png`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '다운로드 실패');
    } finally {
      setDownloading(false);
    }
  }

  async function handlePublishToggle() {
    try {
      await publish.mutateAsync({ id: image.id, isPublic: !image.isPublic });
      toast.success(!image.isPublic ? 'Community에 공개했어요' : '비공개로 전환했어요');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '변경 실패');
    }
  }

  return (
    <div className="group relative overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="relative aspect-square w-full bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.thumbnailUrl}
          alt={image.prompt}
          className="h-full w-full object-cover"
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
      </div>

      <div className="space-y-2 p-3">
        <p className="line-clamp-2 text-xs text-muted-foreground" title={image.prompt}>
          {image.prompt}
        </p>
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
            variant="ghost"
            onClick={handlePublishToggle}
            disabled={publish.isPending}
            aria-label={image.isPublic ? '비공개로 전환' : '공개로 전환'}
            title={image.isPublic ? '비공개로 전환' : 'Community에 공개'}
          >
            {publish.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : image.isPublic ? (
              <EyeOff className="h-3 w-3" />
            ) : (
              <Eye className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
