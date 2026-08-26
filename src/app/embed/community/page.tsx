// Embed 공유 라이브러리 페이지.
//
// clipart.schoolp.co.kr (마케팅 사이트) 가 iframe 으로 넣기 위한 페이지.
// 로그인 없이 조회. 서버가 초기 60장 + 마퀴용 태그 리스트를 SSR 로 계산하고,
// client wrapper (EmbedCommunitySection) 가 sort state + 검색창 + 태그 마퀴
// + 더 보기 를 담당.
//
// 실시간성: force-dynamic 이라 iframe 이 다시 로드될 때마다 최신 데이터.

import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServiceClient } from '@/services/supabase/server';

import { EmbedCommunitySection } from './EmbedCommunitySection';
import type { EmbedCommunityImage } from './CommunityEmbedGrid';

export const dynamic = 'force-dynamic';

// 첫 SSR 로 노출하는 이미지 개수. lazy loading 이 걸려 있어 화면 밖 이미지는
// 스크롤에 맞춰 지연 로드되므로 60 이라도 first paint 는 여전히 빠르다.
const INITIAL_BATCH = 60;
// "더 보기" 클릭 시 한 번에 추가 로드하는 이미지 개수.
const LOAD_MORE_BATCH = 24;
// 태그 마퀴 후보 이미지 상한 (서비스 홈과 동일 정책).
const TAG_SOURCE_LIMIT = 500;
// 태그 마퀴에 노출할 최대 태그 수 (셔플 후 상한).
const TAG_DISPLAY_LIMIT = 60;

export default async function EmbedCommunityPage() {
  const service = createSupabaseServiceClient();

  // 초기 이미지 60장 (최신순) + 총 개수.
  const imagesQuery = service
    .from('community_images')
    .select('id, prompt, width, height, r2_key, thumbnail_r2_key', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(0, INITIAL_BATCH - 1);

  // 태그 마퀴 후보 — 최근 공유된 이미지들의 태그 union.
  const tagIdsQuery = service
    .from('community_images')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(TAG_SOURCE_LIMIT);

  const [imagesResult, tagIdsResult] = await Promise.all([
    imagesQuery,
    tagIdsQuery,
  ]);

  const initialImages: EmbedCommunityImage[] = ((imagesResult.data ?? []) as Array<{
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
  const initialTotal = imagesResult.count ?? initialImages.length;

  // 태그 조회 — 이미지 id 셋으로 image_tags 를 join 하지 않고 IN 필터.
  const publicIds = ((tagIdsResult.data ?? []) as { id: string }[]).map((r) => r.id);
  let tags: string[] = [];
  if (publicIds.length > 0) {
    const { data: tagRows } = await service
      .from('image_tags')
      .select('tag')
      .in('image_id', publicIds);
    const tagSet = new Set<string>();
    for (const r of (tagRows ?? []) as { tag: string }[]) {
      if (r.tag) tagSet.add(r.tag);
    }
    tags = Array.from(tagSet)
      .sort(() => Math.random() - 0.5)
      .slice(0, TAG_DISPLAY_LIMIT);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <EmbedCommunitySection
        initialImages={initialImages}
        initialTotal={initialTotal}
        tags={tags}
        loadMoreBatch={LOAD_MORE_BATCH}
      />
    </div>
  );
}
