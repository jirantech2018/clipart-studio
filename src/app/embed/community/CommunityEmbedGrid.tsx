'use client';

// Embed 공유 라이브러리 그리드 (클라이언트).
//
// 서버 컴포넌트가 SSR 로 첫 24장을 미리 렌더링해 넘겨주고 (fast first paint),
// 이후 "더 보기" 클릭마다 /api/embed/community 로 다음 24장씩 fetch 해서 append.
// iframe 높이는 root EmbedHeightReporter 가 body 크기 변화 감지 → postMessage
// 로 부모에 자동 전달하므로 여기서는 별도 처리 없음.

import { Loader2 } from 'lucide-react';
import { useState } from 'react';

export interface EmbedCommunityImage {
  id: string;
  prompt: string;
  width: number;
  height: number;
  thumbnailUrl: string;
}

interface Props {
  initialImages: EmbedCommunityImage[];
  initialTotal: number;
  batchSize?: number;
}

export function CommunityEmbedGrid({
  initialImages,
  initialTotal,
  batchSize = 24,
}: Props) {
  const [images, setImages] = useState<EmbedCommunityImage[]>(initialImages);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = Math.max(0, total - images.length);
  const hasMore = remaining > 0;

  async function handleLoadMore() {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(batchSize),
        offset: String(images.length),
      });
      const res = await fetch(`/api/embed/community?${params}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('불러오지 못했어요');
      const json = (await res.json()) as {
        data: {
          images: EmbedCommunityImage[];
          total: number;
        };
      };
      // total 은 최신 응답 값을 신뢰 — 다른 사용자가 새로 공유한 이미지가
      // 있으면 초기값과 다를 수 있다.
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
        아직 공개된 이미지가 없어요.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {images.map((img) => (
          <a
            key={img.id}
            // 마케팅 사이트가 자체 /sub 페이지로 감싸서 iframe 으로 우리
            // embed 상세를 삽입한다 (마케팅 헤더·네비 유지 목적). 카드 클릭 시
            // 마케팅 sub 페이지로 새 창 이동, sub 페이지가 iframe src 로
            // /embed/image/[id] 를 열도록 규약.
            href={`https://clipart.schoolp.co.kr/sub?id=${img.id}`}
            target="_blank"
            rel="noopener"
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
          </a>
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-70"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                불러오는 중…
              </>
            ) : (
              <>더 보기 ({remaining}장 더)</>
            )}
          </button>
        </div>
      )}

      {!hasMore && images.length >= 24 && (
        <p className="pt-1 text-center text-xs text-muted-foreground">
          모든 이미지를 표시했어요.
        </p>
      )}

      {error && (
        <p className="text-center text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
