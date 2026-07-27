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

  // 히어로 상단 배경 — 관리자가 /admin/knowledge 화면의 "홈 배너 배경 이미지"
  // 섹션에 등록한 전용 카탈로그(home_hero_images) 에서 랜덤 하나. RLS 로 anon /
  // authenticated 모두 차단되어 있으므로 service_role 로 조회.
  // force-dynamic 이라 새로고침마다 다른 이미지가 뽑힌다.
  const service = createSupabaseServiceClient();
  let heroBackground: string | null = null;
  const { data: bgCandidates } = await service
    .from('home_hero_images')
    .select('r2_key')
    .eq('enabled', true)
    .limit(30);
  const rows = (bgCandidates ?? []) as { r2_key: string }[];
  const pick = rows[Math.floor(Math.random() * rows.length)];
  if (pick) heroBackground = publicUrl(pick.r2_key);

  return (
    <div>
      <TutorialOverlay />
      {/* 히어로 배너 — 화면 전체 폭 + 헤더 뒤까지 확장. main 이 p-6 이고
          AppHeader 가 sticky h-14 라서, -mx-6 로 좌우 padding 을 없애고
          -mt-20 (헤더 3.5rem + main 상단 1.5rem = 5rem) 만큼 위로 밀어
          배너 상단이 반투명 헤더 뒤로 흘러들어간다.
          오버레이(흰레이어) 는 완전히 없앴고, 텍스트 가독성은 강한
          drop-shadow 로 보완. */}
      <section className="relative isolate -mx-6 -mt-20 overflow-hidden bg-muted">
        {heroBackground && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroBackground}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <div className="relative mx-auto max-w-6xl space-y-3 px-6 pb-14 pt-28 text-center md:pb-24 md:pt-36">
          <h1 className="text-4xl font-bold tracking-tight text-white [text-shadow:0_2px_12px_rgba(0,0,0,0.55)]">
            학교에서 필요한 클립아트를 쉽고 빠르게 만들어 보세요.
          </h1>
          <p className="whitespace-pre-line text-lg text-white/95 [text-shadow:0_2px_10px_rgba(0,0,0,0.5)]">
            {`원하는 이미지를 검색하고, 없다면 AI로 새롭게 만들 수 있습니다.
만든 이미지는 내 라이브러리에 저장되어 언제든 다시 사용할 수 있습니다.`}
          </p>
        </div>
      </section>
      {/* AppHeader 가 관측할 sentinel — 이 지점이 뷰포트 위로 스크롤되면
          "히어로를 지나갔다" 로 판정하고 헤더가 흰색 불투명 모드로 전환된다.
          시각적으로는 아무것도 렌더하지 않는다. */}
      <div id="home-hero-sentinel" aria-hidden="true" className="h-0" />

      <div className="mx-auto max-w-6xl space-y-8 pt-8">
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
    </div>
  );
}
