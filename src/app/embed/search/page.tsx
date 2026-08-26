// Embed 검색 결과 페이지.
//
// 마케팅 사이트의 /search?q=<q> 페이지가 iframe 으로 이 페이지를 넣어 검색
// 결과를 표시. 상단 검색창은 EmbedCommunityHeader 와 동일 스타일로 여기서도
// 유지 (다시 검색 가능). 태그 마퀴는 검색 결과 페이지 성격상 생략, 대신
// "← 공유 라이브러리 로 돌아가기" 링크만 노출.

import { Search } from 'lucide-react';

import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServiceClient } from '@/services/supabase/server';

import { SearchEmbedGrid, type EmbedSearchImage } from './SearchEmbedGrid';

export const dynamic = 'force-dynamic';

const INITIAL_BATCH = 24;
const LOAD_MORE_BATCH = 24;

export default async function EmbedSearchPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const query = (searchParams.q ?? '').trim();

  if (!query) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <SearchForm defaultValue="" />
        <p className="rounded-md border bg-background/60 p-6 text-center text-sm text-muted-foreground">
          검색어를 입력해주세요.
        </p>
      </div>
    );
  }

  const service = createSupabaseServiceClient();

  // 세 소스에서 candidate id 수집.
  const [ftsRes, tagRes, catRes] = await Promise.all([
    service
      .from('images')
      .select('id')
      .eq('status', 'saved')
      .eq('is_on_community', true)
      .textSearch('search_vector', query, { type: 'websearch', config: 'simple' })
      .limit(500),
    service.from('image_tags').select('image_id').eq('tag', query).limit(500),
    service
      .from('image_categories')
      .select('image_id')
      .eq('category', query)
      .limit(500),
  ]);

  const candidateIds = new Set<string>();
  for (const row of ftsRes.data ?? []) candidateIds.add(row.id as string);
  for (const row of tagRes.data ?? []) candidateIds.add(row.image_id as string);
  for (const row of catRes.data ?? []) candidateIds.add(row.image_id as string);

  let initialImages: EmbedSearchImage[] = [];
  let initialTotal = 0;

  if (candidateIds.size > 0) {
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

    initialImages = ((data ?? []) as Array<{
      id: string;
      prompt: string;
      width: number | null;
      height: number | null;
      r2_key: string;
      thumbnail_r2_key: string | null;
    }>).map((row) => ({
      id: row.id,
      prompt: row.prompt,
      width: row.width ?? 1024,
      height: row.height ?? 1024,
      thumbnailUrl: publicUrl(row.thumbnail_r2_key ?? row.r2_key),
    }));
    initialTotal = count ?? initialImages.length;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <SearchForm defaultValue={query} />
      <SearchEmbedGrid
        query={query}
        initialImages={initialImages}
        initialTotal={initialTotal}
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
      className="mx-auto w-full max-w-xl"
    >
      <label className="relative block">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          name="q"
          defaultValue={defaultValue}
          placeholder="찾고 싶은 이미지를 검색해보세요"
          className="h-10 w-full rounded-full border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
    </form>
  );
}
