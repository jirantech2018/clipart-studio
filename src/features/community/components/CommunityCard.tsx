'use client';

// Design intent: pure gallery card for the workspace grid. Metadata lives on
// the detail page. Actions (download) + download count appear on hover.

import { useQueryClient } from '@tanstack/react-query';
import { Building2, Download, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { AIGeneratedBadge } from '@/components/ui/AIGeneratedBadge';
import { Button } from '@/components/ui/button';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { downloadImageFile } from '@/features/library/hooks/useMyImages';
import { useMultiSelection } from '@/lib/hooks/useMultiSelection';
import { cn } from '@/lib/utils';

import type { CommunityImage } from '@/features/community/hooks/useCommunity';

export function CommunityCard({ image }: { image: CommunityImage }) {
  const queryClient = useQueryClient();
  const [downloading, setDownloading] = useState(false);
  const selection = useMultiSelection('community');
  const selected = selection.isSelected(image.id);

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadImageFile(image.id);
      queryClient.invalidateQueries({ queryKey: ['community'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '다운로드 실패');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-lg border bg-muted shadow-sm transition-shadow',
        selected && 'ring-2 ring-primary ring-offset-2',
      )}
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

      {/* 좌상단 선택 체크박스: 미선택 시 hover/focus 로만 표시, 선택 시 항상 표시. */}
      <div
        className={cn(
          'absolute left-2 top-2 transition-opacity',
          selected
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
        )}
      >
        <SelectionCheckbox
          checked={selected}
          onCheckedChange={() => selection.toggle(image.id)}
          ariaLabel={selected ? '선택 해제' : '선택'}
        />
      </div>

      <div className="pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-1">
        <AIGeneratedBadge />
        {image.sourceOrgSlug && image.sourceOrgName && (
          <span
            className="pointer-events-auto inline-flex items-center gap-1 rounded-full bg-primary/90 px-2 py-0.5 text-[10px] font-medium text-primary-foreground shadow-sm"
            title={`${image.sourceOrgName} 에서 큐레이션됨`}
          >
            <Building2 className="h-3 w-3" aria-hidden="true" />
            {image.sourceOrgName}
          </span>
        )}
      </div>

      <div className="absolute bottom-2 right-2 flex items-center gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        {image.downloadCount > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-1 text-[11px] tabular-nums text-muted-foreground shadow-md"
            title="다운로드 횟수"
          >
            <Download className="h-3 w-3" aria-hidden="true" />
            {image.downloadCount}
          </span>
        )}
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
      </div>
    </div>
  );
}
