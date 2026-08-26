// Embed 이미지 상세 페이지.
//
// clipart.schoolp.co.kr 가 iframe 안에서 이 이미지 상세를 표시. 로그인 없이
// 조회 가능하되 (is_on_community=true 이미지만), 액션 (다시 만들기·다운로드·
// 링크 복사) 은 모두 새 창으로 서비스 로그인 페이지를 열어 다음 단계로 유도.

import { Download, Link2, Sparkles } from 'lucide-react';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServiceClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

const SERVICE_ORIGIN = 'https://clipartstudio.schoolp.co.kr';

interface EmbedImage {
  id: string;
  prompt: string;
  width: number;
  height: number;
  fullUrl: string;
  categories: string[];
  tags: string[];
}

export default async function EmbedImageDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const service = createSupabaseServiceClient();
  const { data: row } = await service
    .from('images')
    .select(
      'id, prompt, width, height, r2_key, thumbnail_r2_key, is_on_community, trash_status, image_tags(tag), image_categories(category)',
    )
    .eq('id', params.id)
    .maybeSingle();

  // 공개 이미지 (is_on_community=true) 이면서 휴지통 아닌 것만 노출.
  if (
    !row ||
    (row as { is_on_community?: boolean }).is_on_community !== true ||
    (row as { trash_status?: string }).trash_status !== 'ACTIVE'
  ) {
    notFound();
  }

  const r = row as {
    id: string;
    prompt: string;
    width: number | null;
    height: number | null;
    r2_key: string;
    thumbnail_r2_key: string | null;
    image_tags: Array<{ tag: string }> | null;
    image_categories: Array<{ category: string }> | null;
  };

  const image: EmbedImage = {
    id: r.id,
    prompt: r.prompt,
    width: r.width ?? 1024,
    height: r.height ?? 1024,
    fullUrl: publicUrl(r.r2_key),
    categories: (r.image_categories ?? []).map((c) => c.category),
    tags: (r.image_tags ?? []).map((t) => t.tag),
  };

  // 액션별 로그인 후 이동 경로. 모든 액션이 새 창으로 로그인 → 성공 시 서비스
  // 사이트의 대응 위치로 이동.
  const loginUrl = (next: string) =>
    `${SERVICE_ORIGIN}/login?next=${encodeURIComponent(next)}`;
  const remakeUrl = loginUrl(`/organization/my/generate?parent=${image.id}`);
  const detailUrl = loginUrl(`/image/${image.id}`);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-3">
        <Link
          href="/embed/community"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← 공유 라이브러리
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,320px)_1fr]">
        {/* 좌측: metadata + 액션 */}
        <aside className="space-y-4">
          <section className="space-y-2 rounded-md border p-4">
            <h3 className="text-sm font-semibold text-primary">
              만들고 싶었던 내용
            </h3>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {image.prompt}
            </p>
          </section>

          {image.categories.length > 0 && (
            <section className="space-y-2 rounded-md border p-4">
              <h3 className="text-sm font-semibold text-primary">분류</h3>
              <p className="text-sm text-muted-foreground">
                {image.categories.join(', ')}
              </p>
            </section>
          )}

          {image.tags.length > 0 && (
            <section className="space-y-2 rounded-md border p-4">
              <h3 className="text-sm font-semibold text-primary">관련 키워드</h3>
              <div className="flex flex-wrap gap-1.5">
                {image.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-sm text-primary"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-2 rounded-md border p-4">
            <h3 className="text-sm font-semibold text-primary">더 활용하기</h3>
            <a
              href={remakeUrl}
              target="_blank"
              rel="noopener"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              이 이미지로 다시 만들기
            </a>
            <a
              href={detailUrl}
              target="_blank"
              rel="noopener"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              다운로드
            </a>
            <a
              href={detailUrl}
              target="_blank"
              rel="noopener"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              <Link2 className="h-4 w-4" aria-hidden="true" />
              이미지 페이지 링크 복사
            </a>
            <p className="pt-1 text-xs text-muted-foreground">
              로그인 후 이용할 수 있어요.
            </p>
          </section>
        </aside>

        {/* 우측: 이미지 */}
        <div>
          <div
            className="overflow-hidden rounded-lg border bg-muted"
            style={{ aspectRatio: `${image.width} / ${image.height}` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.fullUrl}
              alt={image.prompt}
              className="h-full w-full object-contain"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
