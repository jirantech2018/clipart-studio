'use client';

// Design Ref: §5.4 Community card — thumbnail + AuthorBadge + tags/categories + download
// Non-Negotiable Rule 3: AI 라벨 필수

import { useQueryClient } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { AIGeneratedBadge } from '@/components/ui/AIGeneratedBadge';
import { Button } from '@/components/ui/button';
import { AuthorBadge } from '@/features/community/components/AuthorBadge';
import { requestDownload } from '@/features/library/hooks/useMyImages';

import type { CommunityImage } from '@/features/community/hooks/useCommunity';

export function CommunityCard({ image }: { image: CommunityImage }) {
  const queryClient = useQueryClient();
  const [downloading, setDownloading] = useState(false);

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
      // Bump download_count in the UI so popular sort feels responsive.
      queryClient.invalidateQueries({ queryKey: ['community'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '다운로드 실패');
    } finally {
      setDownloading(false);
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
        </div>
      </Link>

      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <AuthorBadge
            authorType={image.authorType}
            authorSchoolName={image.authorSchoolName}
          />
          {image.downloadCount > 0 && (
            <span
              className="inline-flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground"
              title="다운로드 횟수"
            >
              <Download className="h-3 w-3" aria-hidden="true" />
              {image.downloadCount}
            </span>
          )}
        </div>
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
            {image.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleDownload}
          disabled={downloading}
          className="w-full"
        >
          {downloading ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Download className="mr-1 h-3 w-3" />
          )}
          다운로드
        </Button>
      </div>
    </div>
  );
}
