// Embed 공유 라이브러리 페이지.
//
// clipart.schoolp.co.kr (마케팅 사이트) 가 iframe 으로 넣기 위한 페이지.
// 로그인 없이 조회. service_role 로 community_images 뷰를 최대 30장 조회 후
// 자체 카드 그리드를 렌더. 각 카드는 /embed/image/[id] 로 이동해서 iframe
// 안에서 상세 뷰를 계속 이어갈 수 있게 한다.

import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServiceClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';
export const revalidate = 60; // 1분 캐시 (마케팅 사이트 부담 최소화)

interface EmbedCommunityImage {
  id: string;
  prompt: string;
  width: number;
  height: number;
  thumbnailUrl: string;
}

export default async function EmbedCommunityPage() {
  const service = createSupabaseServiceClient();
  const { data } = await service
    .from('community_images')
    .select('id, prompt, width, height, r2_key, thumbnail_r2_key')
    .order('created_at', { ascending: false })
    .limit(30);

  const images: EmbedCommunityImage[] = ((data ?? []) as Array<{
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

      {images.length === 0 ? (
        <p className="rounded-md border bg-background/60 p-6 text-center text-sm text-muted-foreground">
          아직 공개된 이미지가 없어요.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {images.map((img) => (
            <a
              key={img.id}
              href={`/embed/image/${img.id}`}
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
      )}

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
