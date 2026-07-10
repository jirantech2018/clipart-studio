// Design Ref: §5.4 Home Page — Community 자동 큐레이션 섹션 (인기 / 최근)
// Rendered by the server home page. Minimal card is a plain thumbnail Link so
// the home stays a lightweight surface — full metadata lives on /image/[id].

import Link from 'next/link';

import { AIGeneratedBadge } from '@/components/ui/AIGeneratedBadge';

import type { AccountType } from '@/types/domain';

export interface HomeImage {
  id: string;
  prompt: string;
  thumbnailUrl: string;
  authorType: AccountType;
  authorSchoolName: string | null;
  downloadCount: number;
  width: number;
  height: number;
}

interface HomeSectionProps {
  title: string;
  subtitle?: string;
  moreHref?: string;
  images: HomeImage[];
  emptyLabel: string;
}

export function HomeSection({
  title,
  subtitle,
  moreHref,
  images,
  emptyLabel,
}: HomeSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-0.5 text-left">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {moreHref && (
          <Link
            href={moreHref}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            더 보기 →
          </Link>
        )}
      </div>

      {images.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {emptyLabel}
        </p>
      ) : (
        <div className="columns-2 gap-3 sm:columns-3 md:columns-4 lg:columns-6">
          {images.map((image) => (
            <Link
              key={image.id}
              href={`/image/${image.id}`}
              className="group relative mb-3 block break-inside-avoid overflow-hidden rounded-md border bg-card"
              title={image.prompt}
            >
              <div
                className="relative w-full bg-muted"
                style={{ aspectRatio: `${image.width} / ${image.height}` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.thumbnailUrl}
                  alt={image.prompt}
                  className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                  loading="lazy"
                />
                <div className="absolute right-1 top-1">
                  <AIGeneratedBadge />
                </div>
              </div>
              {image.downloadCount > 0 && (
                <div className="flex items-center justify-end gap-1 p-1.5">
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    ⬇ {image.downloadCount}
                  </span>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
