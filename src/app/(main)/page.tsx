// Design Ref: §5.4 Home — CTA + Community 자동 큐레이션 (인기 + 최근).
// Server component: fetch the two lists in parallel from community_images view.

import Link from 'next/link';
import { Suspense } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { HomeSection } from '@/features/community/components/HomeSection';
import { TutorialOverlay } from '@/features/onboarding/components/TutorialOverlay';
import { SearchBar } from '@/features/search/components/SearchBar';
import { publicUrl } from '@/services/r2/upload';
import { createSupabaseServerClient } from '@/services/supabase/server';

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
  };
}

export default async function HomePage() {
  const supabase = createSupabaseServerClient();
  const [popularRes, recentRes] = await Promise.all([
    supabase
      .from('community_images')
      .select('id, prompt, r2_key, thumbnail_r2_key, author_type, author_school_name, download_count, created_at')
      .order('download_count', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(HOME_LIMIT),
    supabase
      .from('community_images')
      .select('id, prompt, r2_key, thumbnail_r2_key, author_type, author_school_name, download_count, created_at')
      .order('created_at', { ascending: false })
      .limit(HOME_LIMIT),
  ]);

  const popular = (popularRes.data ?? []).map(rowToHomeImage);
  const recent = (recentRes.data ?? []).map(rowToHomeImage);

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <TutorialOverlay />
      <section className="space-y-6 pt-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          찾고, 없으면 만들고, 만들면 계정의 자산이 됩니다
        </h1>
        <p className="text-lg text-muted-foreground">
          여기서 이미지를 찾아보세요. 원하는 결과가 없다면 AI로 직접 만들면 됩니다.
        </p>
        <div className="mx-auto max-w-xl px-4">
          <Suspense fallback={null}>
            <SearchBar className="w-full" />
          </Suspense>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
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
      </section>

      <HomeSection
        title="인기 이미지"
        subtitle="Community에서 많이 다운로드된 이미지"
        moreHref="/community?sort=popular"
        images={popular}
        emptyLabel="아직 공개된 이미지가 없어요. Community 공개를 켜면 여기 노출됩니다."
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
