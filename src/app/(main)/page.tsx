// Design Ref: §5.4 Home — hero + community grid (인기/최근 큐레이션 섹션은 제거).
// Server component: 히어로 배경만 서버에서 로드하고, 공유 라이브러리 그리드는
// community 페이지에서 쓰는 CommunityGrid 를 그대로 재활용한다.

import { HomeCommunitySection } from '@/features/community/components/HomeCommunitySection';
import { HomeStepsSection } from '@/features/community/components/HomeStepsSection';
import { TutorialOverlay } from '@/features/onboarding/components/TutorialOverlay';
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

  // 홈 상단 TagMarquee 용 태그 리스트 — 공유 라이브러리(is_on_community=TRUE)
  // 에 실제 노출되고 있는 이미지들의 태그만 뽑는다. 두 단계 조회:
  //   1) 공유 라이브러리 이미지 id (최근순, 최대 500장)
  //   2) 그 이미지들의 image_tags.tag 를 join 없이 IN 필터로 조회
  // 이후 distinct + Fisher-Yates 셔플 후 60개까지 자름.
  const { data: communityImages } = await service
    .from('images')
    .select('id')
    .eq('is_on_community', true)
    .order('created_at', { ascending: false })
    .limit(500);
  const publicIds = ((communityImages ?? []) as { id: string }[]).map((r) => r.id);
  let tagsForMarquee: string[] = [];
  if (publicIds.length > 0) {
    const { data: tagRows } = await service
      .from('image_tags')
      .select('tag')
      .in('image_id', publicIds);
    const tagSet = new Set<string>();
    for (const r of (tagRows ?? []) as { tag: string }[]) {
      if (r.tag) tagSet.add(r.tag);
    }
    tagsForMarquee = Array.from(tagSet)
      .sort(() => Math.random() - 0.5)
      .slice(0, 60);
  }

  return (
    <div>
      <TutorialOverlay />
      {/* 히어로 배너 — 화면 전체 폭 + 헤더 뒤까지 확장. main 이 p-6 이고
          AppHeader 가 sticky h-14 라서, -mx-6 로 좌우 padding 을 없애고
          -mt-20 (헤더 3.5rem + main 상단 1.5rem = 5rem) 만큼 위로 밀어
          배너 상단이 반투명 헤더 뒤로 흘러들어간다. */}
      {/* min-h-[..] 로 배너 최소 높이를 확보한 뒤 flex items-end 로 h1 을 하단에
          가깝게 붙인다. 모바일에서는 h1 폰트를 줄이고 <br className="sm:hidden">
          로 "학교에서 필요한 클립아트를 / 쉽고 빠르게 만들어 보세요." 두 줄로. */}
      <section className="relative isolate -mx-6 -mt-20 flex min-h-[42vh] items-end overflow-hidden bg-muted md:min-h-[48vh]">
        {heroBackground && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroBackground}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <div className="relative mx-auto w-full max-w-6xl px-6 pb-8 text-center md:pb-12">
          <h1 className="text-2xl font-bold tracking-tight text-white [text-shadow:0_2px_12px_rgba(0,0,0,0.55)] sm:text-3xl md:text-4xl">
            학교에서 필요한 클립아트를
            <br className="sm:hidden" />{' '}
            쉽고 빠르게 만들어 보세요.
          </h1>
        </div>
      </section>
      {/* AppHeader 가 관측할 sentinel — 이 지점이 뷰포트 위로 스크롤되면
          "히어로를 지나갔다" 로 판정하고 헤더가 흰색 불투명 모드로 전환된다. */}
      <div id="home-hero-sentinel" aria-hidden="true" className="h-0" />

      <div className="mx-auto max-w-6xl space-y-4 pt-4">
        {/* 4-Step 기능 카드 — 검색 → AI 생성 → 라이브러리 → 스타일 이어 만들기.
            기존 검색바 + CTA 두 개를 카드 안으로 흡수. */}
        <HomeStepsSection />

        {/* 공유 라이브러리 헤더 — 좌측 제목 + 우측(md 이상) 안내 문구.
            모바일에선 세로 스택. */}
        <div className="flex flex-col gap-1 pt-2 md:flex-row md:items-baseline md:gap-3">
          <h2 className="shrink-0 text-xl font-semibold tracking-tight">
            공유 라이브러리
          </h2>
          <p className="text-sm text-muted-foreground">
            다른 사람들이 만든 이미지를 자유롭게 둘러보세요. 마음에 드는 이미지를
            발견했다면, 비슷한 스타일로 새로운 이미지를 만들어 볼 수 있습니다.
          </p>
        </div>

        {/* 공유 라이브러리 임베드 — 좌 화살표+태그 캐러셀 + 우 sort 드롭다운
            + 그리드. sort state 를 두 파트가 공유해야 해서 client wrapper 로. */}
        <HomeCommunitySection tags={tagsForMarquee} />
      </div>
    </div>
  );
}
