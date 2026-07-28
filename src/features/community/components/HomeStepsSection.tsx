'use client';

// 홈 히어로 바로 아래에 4-Step 기능 카드를 가로로 나열하고 사이에 화살표를
// 넣어 사용 흐름을 안내한다.
//   1. 먼저 검색하세요        (SearchBar + 인기 검색 chip)
//   2. AI 생성                (→ /generate)
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
            이미 있는 이미지는 바로 사용할 수 있습니다.
          </p>
          <Suspense fallback={null}>
            <SearchBar className="w-full" />
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
            찾는 이미지가 없다면 AI가 새롭게 만듭니다.
          </p>
          <Link
            href="/generate"
            className={cn(buttonVariants({ size: 'sm' }), 'w-full')}
          >
            AI로 이미지 만들기
          </Link>
        </CardContent>
      </Card>

      <StepArrow />

      {/* Step 3 — 내 라이브러리 */}
      <Card className="flex-1">
        <CardContent className="flex h-full flex-col gap-3 p-4">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary" />
            <h3 className="text-base font-semibold">내 라이브러리</h3>
          </div>
          <p className="flex-1 text-sm text-muted-foreground">
            만든 이미지는 자동으로 저장됩니다.
          </p>
          <Link
            href="/library"
            className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'w-full')}
          >
            내 라이브러리 열기
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
            원하는 이미지를 기반으로 새로운 이미지를 만들 수 있습니다.
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
