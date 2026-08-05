'use client';

// Package Job 전용 Completed 화면.
//
// 목표 (Phase 3 지시서):
//   - Category 별로 성공 이미지를 그룹핑
//   - Category 그룹 순서 = 각 category 의 최소 order (기획 순서)
//   - Category 내부 정렬 = categoryOrder 오름차순 (Legacy 는 order fallback)
//   - 상단에 "전체 다운로드" CTA 1개 (기존 downloadImagesAsZip 재사용)
//   - partial (성공 + 실패 혼합) 상태에서도 성공 결과와 실패 수를 함께 노출
//
// 데이터 소스:
//   block.succeeded / block.failed 에 이미 category / categoryOrder 정보가
//   포함됨 (Phase 3 에서 CompletedImage/FailedSlot 확장). 서버 재조회 없이
//   store 만으로 그룹핑·정렬 가능. Category 정보가 없는 Legacy 이미지는
//   '기타' 그룹으로 fallback.

import { AlertTriangle, CheckCircle2, Download, Loader2, Package } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { AIGeneratedBadge } from '@/components/ui/AIGeneratedBadge';
import { downloadPackageZip } from '@/features/generation-v2/lib/downloadPackageZip';
import { packageCategoryLabel } from '@/features/generation-v2/lib/packagePlanTypes';
import { downloadImageFile } from '@/features/library/hooks/useMyImages';
import { cn } from '@/lib/utils';
import { ASPECT_RATIO_DIMENSIONS } from '@/types/domain';

import type { AspectRatio } from '@/types/domain';
import type { Block, CompletedImage, FailedSlot } from '@/lib/store/conversationStore';

interface Props {
  block: Block;
}

interface CategoryGroup {
  category: string;
  firstOrder: number;
  succeeded: CompletedImage[];
  failed: FailedSlot[];
}

const LEGACY_CATEGORY = '__legacy__';

function groupByCategory(block: Block): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>();

  function ensure(category: string | undefined, order: number): CategoryGroup {
    const key = category ?? LEGACY_CATEGORY;
    let g = groups.get(key);
    if (!g) {
      g = { category: key, firstOrder: order, succeeded: [], failed: [] };
      groups.set(key, g);
    }
    if (order < g.firstOrder) g.firstOrder = order;
    return g;
  }

  for (const img of block.succeeded) {
    ensure(img.category, img.order).succeeded.push(img);
  }
  for (const f of block.failed) {
    ensure(f.category, f.order).failed.push(f);
  }

  const list = Array.from(groups.values());
  list.sort((a, b) => a.firstOrder - b.firstOrder);
  for (const g of list) {
    g.succeeded.sort((a, b) => {
      const ao = a.categoryOrder ?? a.order;
      const bo = b.categoryOrder ?? b.order;
      return ao - bo;
    });
    g.failed.sort((a, b) => {
      const ao = a.categoryOrder ?? a.order;
      const bo = b.categoryOrder ?? b.order;
      return ao - bo;
    });
  }
  return list;
}

export function PackageCompletedStep({ block }: Props) {
  const succeeded = block.succeeded.length;
  const failed = block.failed.length;
  const total = succeeded + failed;
  const allFailed = succeeded === 0 && failed > 0;

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  const groups = useMemo(() => groupByCategory(block), [block]);

  async function handleDownloadOne(imageId: string) {
    if (pendingId) return;
    setPendingId(imageId);
    try {
      await downloadImageFile(imageId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '다운로드에 실패했어요');
    } finally {
      setPendingId(null);
    }
  }

  async function handleDownloadAll() {
    if (downloadingAll) return;
    setDownloadingAll(true);
    try {
      await downloadPackageZip(block.succeeded);
      toast.success('전체 이미지 다운로드를 시작했어요.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ZIP 다운로드 실패');
    } finally {
      setDownloadingAll(false);
    }
  }

  return (
    <section
      className={cn(
        'space-y-4 rounded-xl border p-5',
        allFailed
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-primary/40 bg-primary/5',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {allFailed ? (
            <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
          ) : (
            <Package className="h-4 w-4 text-primary" aria-hidden="true" />
          )}
          <div className="space-y-0.5">
            <h3 className="text-base font-semibold">
              {allFailed
                ? '패키지 생성에 실패했어요'
                : `패키지 ${succeeded}장이 완성됐어요`}
            </h3>
            {!allFailed && failed > 0 && (
              <p className="text-xs text-muted-foreground">
                총 {total}장 중 {failed}장은 실패해 크레딧이 환불되었어요.
              </p>
            )}
          </div>
        </div>
        {succeeded > 0 && (
          <button
            type="button"
            onClick={handleDownloadAll}
            disabled={downloadingAll}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70',
            )}
          >
            {downloadingAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>전체 다운로드</span>
          </button>
        )}
      </header>

      {groups.length === 0 && (
        <p className="py-6 text-center text-xs text-muted-foreground">
          결과가 없어요.
        </p>
      )}

      <div className="space-y-5">
        {groups.map((group) => (
          <CategorySection
            key={group.category}
            group={group}
            pendingId={pendingId}
            onDownloadOne={handleDownloadOne}
          />
        ))}
      </div>
    </section>
  );
}

function CategorySection({
  group,
  pendingId,
  onDownloadOne,
}: {
  group: CategoryGroup;
  pendingId: string | null;
  onDownloadOne: (imageId: string) => void;
}) {
  const doneCount = group.succeeded.length;
  const failCount = group.failed.length;
  const label =
    group.category === LEGACY_CATEGORY ? '기타' : packageCategoryLabel(group.category);

  return (
    <div className="space-y-2">
      <header className="flex items-baseline gap-2">
        <h4 className="text-sm font-semibold text-foreground">{label}</h4>
        <span className="text-xs tabular-nums text-muted-foreground">
          {doneCount}
          {failCount > 0 && (
            <span className="text-destructive"> · 실패 {failCount}</span>
          )}
        </span>
      </header>

      {doneCount === 0 && failCount === 0 ? null : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {group.succeeded.map((img, idx) => (
            <ImageTile
              key={img.imageId}
              image={img}
              pending={pendingId === img.imageId}
              onDownload={() => onDownloadOne(img.imageId)}
              animationDelay={idx * 30}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ImageTile({
  image,
  pending,
  onDownload,
  animationDelay,
}: {
  image: CompletedImage;
  pending: boolean;
  onDownload: () => void;
  animationDelay: number;
}) {
  // aspectRatio 는 optional — Legacy 는 square fallback.
  const ratioKey: AspectRatio = image.aspectRatio ?? 'square';
  const dims = ASPECT_RATIO_DIMENSIONS[ratioKey];
  const aspectStyle = { aspectRatio: `${dims.width} / ${dims.height}` };

  return (
    <div
      className="group relative overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow duration-200 hover:border-primary/60 hover:shadow-md animate-fade-in-up"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <Link
        href={`/image/${image.imageId}`}
        className="relative block bg-muted"
        style={aspectStyle}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.thumbnailUrl}
          alt={image.name ?? `생성 결과 ${image.order + 1}번`}
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          loading="lazy"
        />
        <div className="absolute right-2 top-2">
          <AIGeneratedBadge />
        </div>
      </Link>
      <button
        type="button"
        onClick={onDownload}
        disabled={pending}
        aria-label="클립아트 다운로드"
        title="클립아트 다운로드"
        className={cn(
          'absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-background/95 text-primary shadow-sm backdrop-blur transition-all duration-200 hover:scale-105 hover:bg-background',
          pending && 'cursor-wait opacity-60 hover:scale-100',
        )}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
      {image.name && (
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-background/85 px-1.5 py-0.5 text-[10px] font-medium text-foreground/80 backdrop-blur">
          {image.name}
        </div>
      )}
    </div>
  );
}
