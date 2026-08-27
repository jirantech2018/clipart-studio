// Embed 검색 결과 페이지.
//
// 마케팅 사이트의 /search?q=<q> 페이지가 iframe 으로 이 페이지를 넣어 검색
// 결과를 표시. 상단 검색창은 EmbedCommunityHeader 와 동일 스타일로 여기서도
// 유지 (다시 검색 가능).
//
// Fallback:
//   - q 가 비었거나 placeholder (`{...}`) 이거나 결과가 0건이면 최근 공유
//     라이브러리 이미지를 자동으로 노출해 방문자가 항상 유용한 콘텐츠를 본다.
//   - 이는 마케팅 사이트가 iframe src 의 {q} 치환을 놓친 상태에서도
//     "검색 결과 없음" 만 표시되는 사각지대를 방지한다.

import { Search } from 'lucide-react';

import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServiceClient } from '@/services/supabase/server';

import { SearchEmbedGrid, type EmbedSearchImage } from './SearchEmbedGrid';

export const dynamic = 'force-dynamic';

const INITIAL_BATCH = 24;
const LOAD_MORE_BATCH = 24;
const FALLBACK_BATCH = 60;

/** 마케팅 사이트가 템플릿 치환을 놓쳤을 때 그대로 넘어오는 placeholder 감지. */
function isPlaceholderQuery(q: string): boolean {
  if (!q) return true;
  if (q.startsWith('{') && q.endsWith('}')) return true;
  if (q.includes('여기에') || q.includes('삽입')) return true;
  return false;
}

interface Loaded {
  images: EmbedSearchImage[];
  total: number;
}

async function loadSearchResults(q: string): Promise<Loaded> {
  const service = createSupabaseServiceClient();

  const [ftsRes, tagRes, catRes] = await Promise.all([
    service
      .from('images')
      .select('id')
      .eq('status', 'saved')
      .eq('is_on_community', true)
      .textSearch('search_vector', q, { type: 'websearch', config: 'simple' })
      .limit(500),
    service.from('image_tags').select('image_id').eq('tag', q).limit(500),
    service
      .from('image_categories')
      .select('image_id')
      .eq('category', q)
      .limit(500),
  ]);

  const candidateIds = new Set<string>();
  for (const row of ftsRes.data ?? []) candidateIds.add(row.id as string);
  for (const row of tagRes.data ?? []) candidateIds.add(row.image_id as string);
  for (const row of catRes.data ?? []) candidateIds.add(row.image_id as string);

  if (candidateIds.size === 0) return { images: [], total: 0 };

  const ids = Array.from(candidateIds);
  const { data, count } = await service
    .from('images')
    .select('id, prompt, width, height, r2_key, thumbnail_r2_key', {
      count: 'exact',
    })
    .in('id', ids)
    .eq('status', 'saved')
    .eq('is_on_community', true)
    .order('created_at', { ascending: false })
    .range(0, INITIAL_BATCH - 1);

  const pageIds = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  const viewCounts = await computeViewCounts(pageIds);
  const images = shapeImages(data, viewCounts);
  return { images, total: count ?? images.length };
}

async function loadFallbackLibrary(): Promise<Loaded> {
  const service = createSupabaseServiceClient();
  const { data, count } = await service
    .from('community_images')
    .select(
      'id, prompt, width, height, r2_key, thumbnail_r2_key, view_count',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(0, FALLBACK_BATCH - 1);
  // community_images 뷰가 view_count 를 직접 제공하므로 viewCountMap 불필요.
  const images = shapeImages(data);
  return { images, total: count ?? images.length };
}

function shapeImages(
  rows: unknown,
  viewCountMap?: Map<string, number>,
): EmbedSearchImage[] {
  return ((rows ?? []) as Array<{
    id: string;
    prompt: string;
    width: number | null;
    height: number | null;
    r2_key: string;
    thumbnail_r2_key: string | null;
    view_count?: number | null;
  }>).map((row) => ({
    id: row.id,
    prompt: row.prompt,
    width: row.width ?? 1024,
    height: row.height ?? 1024,
    thumbnailUrl: publicUrl(row.thumbnail_r2_key ?? row.r2_key),
    viewCount:
      viewCountMap?.get(row.id) ?? Number(row.view_count ?? 0),
  }));
}

// SSR 이 images 테이블에서 조회한 결과에 대해 별도로 download_events(view) 집계.
async function computeViewCounts(ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const service = createSupabaseServiceClient();
  const { data } = await service
    .from('download_events')
    .select('image_id')
    .eq('event_type', 'view')
    .in('image_id', ids);
  for (const ev of (data ?? []) as { image_id: string }[]) {
    map.set(ev.image_id, (map.get(ev.image_id) ?? 0) + 1);
  }
  return map;
}

export default async function EmbedSearchPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const rawQuery = (searchParams.q ?? '').trim();

  // 유효한 검색어면 search API 흐름, 아니면 fallback 라이브러리.
  const useFallback = isPlaceholderQuery(rawQuery);

  let images: EmbedSearchImage[] = [];
  let total = 0;
  let displayQuery = ''; // 상단 form 의 초깃값 · SearchEmbedGrid 의 헤딩용

  if (!useFallback) {
    const searchLoaded = await loadSearchResults(rawQuery);
    if (searchLoaded.total > 0) {
      images = searchLoaded.images;
      total = searchLoaded.total;
      displayQuery = rawQuery;
    } else {
      // 유효한 검색어였지만 결과 0건 → fallback 라이브러리로 대체.
      const fallback = await loadFallbackLibrary();
      images = fallback.images;
      total = fallback.total;
      displayQuery = rawQuery; // 검색어는 form 에 유지해 사용자가 다시 시도 가능
    }
  } else {
    const fallback = await loadFallbackLibrary();
    images = fallback.images;
    total = fallback.total;
    displayQuery = '';
  }

  const hasResults = !useFallback && rawQuery && images.length > 0 && displayQuery === rawQuery && total > 0;
  const noHitsForValidQuery = !useFallback && rawQuery && !hasResults;

  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <SearchForm defaultValue={displayQuery} />

      {noHitsForValidQuery && (
        <p className="rounded-md border bg-background/60 p-4 text-sm text-muted-foreground">
          <strong className="text-foreground">“{rawQuery}”</strong> 검색 결과가 없어요.
          다른 검색어로 시도해보세요. 아래는 최근 공유된 클립아트입니다.
        </p>
      )}

      <SearchEmbedGrid
        query={hasResults ? rawQuery : ''}
        initialImages={images}
        initialTotal={total}
        batchSize={LOAD_MORE_BATCH}
      />
    </div>
  );
}

// 다시 검색 form. GET 으로 같은 페이지 재요청 → SSR 재렌더.
function SearchForm({ defaultValue }: { defaultValue: string }) {
  return (
    <form
      method="get"
      action="/embed/search"
      className="w-full max-w-xl"
    >
      <label className="relative block">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2"
          style={{ color: '#373d8e' }}
          aria-hidden="true"
        />
        <input
          type="search"
          name="q"
          defaultValue={defaultValue}
          placeholder="찾고 싶은 이미지를 검색해보세요"
          className="h-14 w-full rounded-full bg-background pl-12 pr-4 text-base placeholder:text-muted-foreground focus:outline-none"
          style={{ border: '3px solid #373d8e' }}
        />
      </label>
    </form>
  );
}
