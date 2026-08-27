'use client';

// Embed 공유 라이브러리 그리드 (클라이언트).
//
// 서버 컴포넌트가 SSR 로 첫 60장을 미리 렌더링해 넘겨주고 (fast first paint),
// 이후 "더 보기" 클릭마다 /api/embed/community 로 다음 24장씩 fetch 해서 append.
// sort (newest/popular) 가 상위에서 바뀌면 첫 페이지부터 다시 fetch.
// iframe 높이는 root EmbedHeightReporter 가 body 크기 변화 감지 → postMessage
// 로 부모에 자동 전달하므로 여기서는 별도 처리 없음.

import { Heart, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type EmbedCommunitySort = 'newest' | 'popular';

export interface EmbedCommunityImage {
  id: string;
  prompt: string;
  width: number;
  height: number;
  thumbnailUrl: string;
  viewCount: number;
}

// 이미지 카드 클릭 시 fire-and-forget 으로 view 이벤트 기록. 새 창 열림
// 자체를 막지 않도록 preventDefault 안 함. 실패는 조용히 무시.
function reportView(id: string): void {
  try {
    fetch(`/api/embed/images/${id}/view`, {
      method: 'POST',
      keepalive: true,
    });
  } catch {
    // 익명 카운트라 실패해도 사용자 UX 영향 없음.
  }
}

interface Props {
  initialImages: EmbedCommunityImage[];
  initialTotal: number;
  initialSort?: EmbedCommunitySort;
  sort: EmbedCommunitySort;
  batchSize?: number;
}

export function CommunityEmbedGrid({
  initialImages,
  initialTotal,
  initialSort = 'newest',
  sort,
  batchSize = 24,
}: Props) {
  const [images, setImages] = useState<EmbedCommunityImage[]>(initialImages);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = Math.max(0, total - images.length);
  const hasMore = remaining > 0;

  // sort 변경 시 첫 페이지부터 다시 fetch. 초기 SSR 결과와 sort 가 같으면
  // 리셋 없이 그대로 사용.
  const initialSortRef = useRef(initialSort);
  useEffect(() => {
    if (sort === initialSortRef.current) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          limit: '60',
          offset: '0',
          sort,
        });
        const res = await fetch(`/api/embed/community?${params}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error('불러오지 못했어요');
        const json = (await res.json()) as {
          data: { images: EmbedCommunityImage[]; total: number };
        };
        if (cancelled) return;
        setImages(json.data.images);
        setTotal(json.data.total);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '불러오지 못했어요');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sort]);

  async function handleLoadMore() {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(batchSize),
        offset: String(images.length),
        sort,
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

  if (images.length === 0 && !loading) {
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
            onClick={() => reportView(img.id)}
            onAuxClick={(e) => {
              // 마우스 middle-click / cmd/ctrl+click 도 새 탭 열림 → 카운트.
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
            {/* 우측 상단 클릭수 뱃지 — 항상 노출, tabular-nums 로 정렬 안정. */}
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
              <>우리학교 선생님들이 직접 만든 클립아트 더보기 →</>
            )}
          </button>
        </div>
      )}

      {!hasMore && images.length >= 24 && (
        <p className="pt-2 text-center text-sm text-muted-foreground">
          모든 이미지를 표시했어요.
        </p>
      )}

      {error && (
        <p className="text-center text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
