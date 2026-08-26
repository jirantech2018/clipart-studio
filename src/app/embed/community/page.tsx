// Embed 공유 라이브러리 페이지.
//
// clipart.schoolp.co.kr (마케팅 사이트) 가 iframe 으로 넣기 위한 페이지.
// 로그인 없이 조회. service_role 로 community_images 뷰의 첫 24장을 SSR 로
// 미리 렌더링해 fast first paint 를 만들고, 이후 "더 보기" 는 클라이언트
// 컴포넌트가 /api/embed/community 로 24장씩 append.
//
// 실시간성: force-dynamic 이라 iframe 이 다시 로드될 때마다 최신 데이터.

import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServiceClient } from '@/services/supabase/server';

import {
  CommunityEmbedGrid,
  type EmbedCommunityImage,
} from './CommunityEmbedGrid';

export const dynamic = 'force-dynamic';

const INITIAL_BATCH = 24;

export default async function EmbedCommunityPage() {
  const service = createSupabaseServiceClient();
  const { data, count } = await service
    .from('community_images')
    .select('id, prompt, width, height, r2_key, thumbnail_r2_key', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(0, INITIAL_BATCH - 1);

  const initialImages: EmbedCommunityImage[] = ((data ?? []) as Array<{
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

  const initialTotal = count ?? initialImages.length;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-col gap-1 md:flex-row md:items-baseline md:gap-3">
        <h2 className="shrink-0 text-xl font-semibold tracking-tight">
          공유 라이브러리
        </h2>
        <p className="text-sm text-muted-foreground">
          우리학교 클립아트스튜디오에서 공개된 이미지를 둘러보세요.
        </p>
      </header>

      <CommunityEmbedGrid
        initialImages={initialImages}
        initialTotal={initialTotal}
        batchSize={INITIAL_BATCH}
      />

      <footer className="pt-2 text-center">
        <a
          href="https://clipartstudio.schoolp.co.kr/"
          target="_blank"
          rel="noopener"
          className="inline-flex items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          우리학교 클립아트스튜디오 바로가기 →
        </a>
      </footer>
    </div>
  );
}
