'use client';

// 홈 히어로 바로 아래에 4-Step 기능 카드를 가로로 나열하고 사이에 화살표를
// 넣어 사용 흐름을 안내한다.
//   1. 먼저 검색하세요        (SearchBar + 인기 검색 chip)
//   2. AI 생성                (→ /generate-v2)
//   3. 내 라이브러리           (→ /library)
//   4. 스타일 이어 만들기       (안내 카드, 이미지 상세에서 진입)
//
// md 이상에서는 flex row + 카드 사이 ChevronRight, 좁은 화면에서는 세로 스택.

import { ChevronRight, FolderOpen, Palette, Search, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SearchBar } from '@/features/search/components/SearchBar';
import { cn } from '@/lib/utils';

export function HomeStepsSection() {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
      {/* Step 1 — 검색 */}
      <Card className="flex-1">
        <CardContent className="flex h-full flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" />
            <h3 className="text-base font-semibold">먼저 검색하세요</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            원하는 이미지를 먼저 검색해 보세요. 이미 있는 이미지는 바로 내려받아
            사용할 수 있습니다.
          </p>
          <Suspense fallback={null}>
            <SearchBar
              className="w-full"
              placeholder="예) 운동회, 졸업식, 과학실, 칠판"
            />
          </Suspense>
        </CardContent>
      </Card>

      <StepArrow />

      {/* Step 2 — AI 생성 */}
      <Card className="flex-1">
        <CardContent className="flex h-full flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="text-base font-semibold">AI 생성</h3>
          </div>
          <p className="flex-1 text-sm text-muted-foreground">
            찾는 이미지가 없다면 AI가 새롭게 만들어 드립니다. 저작권 고민은
            줄이고, 학교에 맞는 클립아트를 만들어 보세요.
          </p>
          <Link
            href="/organization/my/generate"
            className={cn(buttonVariants({ size: 'sm' }), 'w-full')}
          >
            내 작업실에서 만들기
          </Link>
        </CardContent>
      </Card>

      <StepArrow />

      {/* Step 3 — 라이브러리 */}
      <Card className="flex-1">
        <CardContent className="flex h-full flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary" />
            <h3 className="text-base font-semibold">라이브러리</h3>
          </div>
          <p className="flex-1 text-sm text-muted-foreground">
            만든 이미지는 내 라이브러리에 저장되고, 조직 라이브러리 → 공유
            라이브러리로 공유하여 활용할 수 있습니다.
          </p>
          <Link
            href="/organizations"
            className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'w-full')}
          >
            우리학교 워크스페이스
          </Link>
        </CardContent>
      </Card>

      <StepArrow />

      {/* Step 4 — 스타일 이어 만들기 (안내 카드) */}
      <Card className="flex-1">
        <CardContent className="flex h-full flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-primary" />
            <h3 className="text-base font-semibold">스타일 이어 만들기</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            마음에 드는 이미지를 바탕으로 새로운 이미지를 만들어 보세요.
          </p>
          {/* img → img 시각 힌트 — 실제 진입은 이미지 상세의 "다시 만들기" */}
          <div className="mt-auto flex items-center justify-center gap-2 rounded-md border bg-muted/40 py-3 text-primary">
            <ImageThumb />
            <ChevronRight className="h-4 w-4" />
            <ImageThumb />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StepArrow() {
  return (
    <div className="flex items-center justify-center md:px-1">
      <ChevronRight
        className="h-6 w-6 rotate-90 text-muted-foreground md:rotate-0"
        aria-hidden="true"
      />
    </div>
  );
}

function ImageThumb() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded border border-primary/40 bg-background">
      <Palette className="h-4 w-4" aria-hidden="true" />
    </div>
  );
}
