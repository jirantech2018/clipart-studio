'use client';

// Embed 검색 결과 그리드 — SSR 첫 24장 + "더 보기" 24장씩 append.

import { Heart, Loader2 } from 'lucide-react';
import { useState } from 'react';

export interface EmbedSearchImage {
  id: string;
  prompt: string;
  width: number;
  height: number;
  thumbnailUrl: string;
  viewCount: number;
}

function reportView(id: string): void {
  try {
    fetch(`/api/embed/images/${id}/view`, {
      method: 'POST',
      keepalive: true,
    });
  } catch {
    // 익명 카운트 실패는 조용히 무시.
  }
}

interface Props {
  query: string;
  initialImages: EmbedSearchImage[];
  initialTotal: number;
  batchSize?: number;
}

export function SearchEmbedGrid({
  query,
  initialImages,
  initialTotal,
  batchSize = 24,
}: Props) {
  const [images, setImages] = useState<EmbedSearchImage[]>(initialImages);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = Math.max(0, total - images.length);
  // query 가 없는 fallback 표시 (공유 라이브러리 최근 60장) 에서는 "더 보기"
  // 를 노출하지 않는다 — 검색 API 가 아니라 다른 소스라 페이지네이션 대상 X.
  const hasMore = remaining > 0 && Boolean(query);

  async function handleLoadMore() {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        q: query,
        limit: String(batchSize),
        offset: String(images.length),
      });
      const res = await fetch(`/api/embed/search?${params}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('불러오지 못했어요');
      const json = (await res.json()) as {
        data: { images: EmbedSearchImage[]; total: number };
      };
      setImages((prev) => [...prev, ...json.data.images]);
      setTotal(json.data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '불러오지 못했어요');
    } finally {
      setLoading(false);
    }
  }

  if (images.length === 0) {
    return (
      <p className="rounded-md border bg-background/60 p-6 text-center text-sm text-muted-foreground">
        검색 결과가 없어요. 다른 검색어로 시도해보세요.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {query && (
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">“{query}”</strong> 검색 결과 {total}건
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {images.map((img) => (
          <a
            key={img.id}
            href={`https://clipart.schoolp.co.kr/sub?id=${img.id}`}
            target="_blank"
            rel="noopener"
            onClick={() => reportView(img.id)}
            onAuxClick={(e) => {
              if (e.button === 1) reportView(img.id);
            }}
            className="group relative block overflow-hidden rounded-lg border bg-muted shadow-sm transition-shadow hover:shadow-md"
            style={{ aspectRatio: `${img.width} / ${img.height}` }}
            title={img.prompt}
            aria-label={img.prompt}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.thumbnailUrl}
              alt={img.prompt}
              loading="lazy"
              className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
            />
            <span
              className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white shadow-sm backdrop-blur-sm"
              title={`${img.viewCount}회 조회`}
            >
              <Heart className="h-3 w-3" aria-hidden="true" />
              {img.viewCount}
            </span>
          </a>
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-center pt-4">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loading}
            className="inline-flex items-center gap-2 bg-transparent text-lg font-semibold text-primary transition-opacity hover:opacity-80 disabled:cursor-wait disabled:opacity-70"
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                불러오는 중…
              </>
            ) : (
              <>더보기 →</>
            )}
          </button>
        </div>
      )}

      {error && (
        <p className="text-center text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
