// Design Ref: §5.4 Home — CTA + Community 자동 큐레이션 (인기 + 최근).
// Server component: fetch the two lists in parallel from community_images view.

import Link from 'next/link';
import { Suspense } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { HomeSection } from '@/features/community/components/HomeSection';
import { TutorialOverlay } from '@/features/onboarding/components/TutorialOverlay';
import { SearchBar } from '@/features/search/components/SearchBar';
import { publicUrl } from '@/services/r2/upload';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

import type { HomeImage } from '@/features/community/components/HomeSection';
import type { AccountType } from '@/types/domain';

export const dynamic = 'force-dynamic';

const HOME_LIMIT = 12;

function rowToHomeImage(row: Record<string, unknown>): HomeImage {
  const r2Key = row.r2_key as string;
  const thumbnailKey = (row.thumbnail_r2_key as string) ?? r2Key;
  return {
    id: row.id as string,
    prompt: row.prompt as string,
    thumbnailUrl: publicUrl(thumbnailKey),
    authorType: row.author_type as AccountType,
    authorSchoolName: (row.author_school_name as string) ?? null,
    downloadCount: Number(row.download_count ?? 0),
    width: (row.width as number) ?? 1024,
    height: (row.height as number) ?? 1024,
  };
}

const HOME_SELECT = 'id, prompt, r2_key, thumbnail_r2_key, author_type, author_school_name, download_count, width, height, created_at';

export default async function HomePage() {
  const supabase = createSupabaseServerClient();
  const [popularRes, recentRes] = await Promise.all([
    supabase
      .from('community_images')
      .select(HOME_SELECT)
      .order('download_count', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(HOME_LIMIT),
    supabase
      .from('community_images')
      .select(HOME_SELECT)
      .order('created_at', { ascending: false })
      .limit(HOME_LIMIT),
  ]);

  const popular = (popularRes.data ?? []).map(rowToHomeImage);
  const recent = (recentRes.data ?? []).map(rowToHomeImage);

  // 히어로 상단 배경 — 관리자가 /admin/knowledge 에 등록한 positive 대표
  // 이미지 중 랜덤 하나. Knowledge 테이블은 관리자 전용이라 RLS 상 anon /
  // authenticated 로 조회 불가하므로 service_role 로 우회. force-dynamic 이라
  // 새로고침마다 다른 이미지가 뽑힌다.
  const service = createSupabaseServiceClient();
  const { data: enabledKnowledge } = await service
    .from('knowledge')
    .select('id')
    .eq('enabled', true);
  const enabledIds = ((enabledKnowledge ?? []) as { id: string }[]).map((r) => r.id);
  let heroBackground: string | null = null;
  if (enabledIds.length > 0) {
    const { data: bgCandidates } = await service
      .from('knowledge_images')
      .select('r2_key')
      .eq('reference_type', 'positive')
      .eq('is_primary', true)
      .in('knowledge_id', enabledIds)
      .limit(30);
    const rows = (bgCandidates ?? []) as { r2_key: string }[];
    const pick = rows[Math.floor(Math.random() * rows.length)];
    if (pick) heroBackground = publicUrl(pick.r2_key);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <TutorialOverlay />
      <section className="space-y-6">
        {/* 상단 배너: 관리자 knowledge 이미지 배경 + 카피 overlay.
            배경 이미지가 없으면 (초기 knowledge 미등록 상태) muted 배경으로
            자연스럽게 폴백. */}
        <div className="relative isolate overflow-hidden rounded-xl bg-muted">
          {heroBackground && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={heroBackground}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          {/* 텍스트 가독성 확보용 오버레이 — 배경 있을 때는 살짝 어둡게,
              배경 없을 때는 그라디언트만. */}
          <div
            aria-hidden="true"
            className={
              heroBackground
                ? 'absolute inset-0 bg-gradient-to-b from-background/70 via-background/60 to-background/90'
                : 'absolute inset-0 bg-gradient-to-b from-background/40 to-background/80'
            }
          />
          <div className="relative space-y-3 px-6 py-14 text-center md:py-20">
            <h1 className="text-4xl font-bold tracking-tight drop-shadow-sm">
              학교에서 필요한 클립아트를 쉽고 빠르게 만들어 보세요.
            </h1>
            <p className="whitespace-pre-line text-lg text-foreground/80">
              {`원하는 이미지를 검색하고, 없다면 AI로 새롭게 만들 수 있습니다.
만든 이미지는 내 라이브러리에 저장되어 언제든 다시 사용할 수 있습니다.`}
            </p>
          </div>
        </div>

        {/* 좌: 검색 · 우: CTA. 배경 배너 아래에 별도 행. */}
        <div className="grid items-center gap-4 md:grid-cols-2">
          <Suspense fallback={null}>
            <SearchBar className="w-full" />
          </Suspense>
          <div className="flex flex-wrap items-center justify-center gap-2 md:justify-end">
            <Link href="/generate" className={buttonVariants({ size: 'lg' })}>
              AI로 이미지 만들기
            </Link>
            <Link
              href="/library"
              className={buttonVariants({ variant: 'outline', size: 'lg' })}
            >
              내 라이브러리 열기
            </Link>
          </div>
        </div>
      </section>

      <HomeSection
        title="인기 이미지"
        subtitle="공유 라이브러리에서 많이 다운로드된 이미지"
        moreHref="/community?sort=popular"
        images={popular}
        emptyLabel="아직 공개된 이미지가 없어요. 공유 라이브러리 공개를 켜면 여기 노출됩니다."
      />

      <HomeSection
        title="최근 공개된 이미지"
        subtitle="다른 사용자들이 방금 공개한 이미지"
        moreHref="/community"
        images={recent}
        emptyLabel="최근 공개된 이미지가 아직 없어요."
      />
    </div>
  );
}
