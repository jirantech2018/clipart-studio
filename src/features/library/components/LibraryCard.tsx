'use client';

// Design intent: pure gallery card. Metadata (prompt/categories/tags) lives on
// the detail page. Action buttons appear on hover so the grid stays clean.
//
// P5-C Phase B: 커뮤니티(공유 라이브러리) 승격 UI 제거. 이 카드에서는 공개
// 액션이 사라지고, 소유자가 커뮤니티에 올리려면 이미지 상세 → "조직에 공유"
// → 조직 라이브러리에서 조직 owner 가 승격하는 흐름을 따른다.

import { Download, Loader2, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { AIGeneratedBadge } from '@/components/ui/AIGeneratedBadge';
import { Button } from '@/components/ui/button';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { downloadImageFile } from '@/features/library/hooks/useMyImages';
import { useMultiSelection } from '@/lib/hooks/useMultiSelection';
import { cn } from '@/lib/utils';

import type { LibraryImage } from '@/features/library/hooks/useMyImages';

// 공유 조직 라벨 포맷: 1곳이면 조직명, 여러 곳이면 "지란초 외 N".
// title (툴팁) 에는 전체 목록을 넣어 그리드에서 마우스 오버로 확인 가능.
function formatSharedOrgsLabel(orgs: { name: string }[]): string {
  const first = orgs[0];
  if (!first) return '';
  if (orgs.length === 1) return first.name;
  return `${first.name} 외 ${orgs.length - 1}`;
}

export function LibraryCard({ image }: { image: LibraryImage }) {
  const [downloading, setDownloading] = useState(false);
  const selection = useMultiSelection('library');
  const selected = selection.isSelected(image.id);

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
        {image.sharedOrgs && image.sharedOrgs.length > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-primary/90 px-2 py-0.5 text-[10px] font-medium text-primary-foreground shadow-sm"
            title={image.sharedOrgs.map((o) => o.name).join(', ')}
          >
            <Users className="h-3 w-3" aria-hidden="true" />
            {formatSharedOrgsLabel(image.sharedOrgs)}
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
      </div>
    </div>
  );
}
