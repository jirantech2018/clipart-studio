// Design Ref: §5.4 Home — hero + community grid (인기/최근 큐레이션 섹션은 제거).
// Server component: 히어로 배경만 서버에서 로드하고, 공유 라이브러리 그리드는
// community 페이지에서 쓰는 CommunityGrid 를 그대로 재활용한다.

import Link from 'next/link';
import { Suspense } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { CommunityGrid } from '@/features/community/components/CommunityGrid';
import { TutorialOverlay } from '@/features/onboarding/components/TutorialOverlay';
import { SearchBar } from '@/features/search/components/SearchBar';
import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServiceClient } from '@/services/supabase/server';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
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
          배너 상단이 반투명 헤더 뒤로 흘러들어간다. */}
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
          "히어로를 지나갔다" 로 판정하고 헤더가 흰색 불투명 모드로 전환된다. */}
      <div id="home-hero-sentinel" aria-hidden="true" className="h-0" />

      <div className="mx-auto max-w-6xl space-y-4 pt-4">
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

        {/* 공유 라이브러리 그리드 — /community 페이지의 그리드를 그대로 임베드.
            홈에서는 헤딩/서브카피 없이 그리드만 이어붙여 여백을 최소화. */}
        <CommunityGrid />
      </div>
    </div>
  );
}
