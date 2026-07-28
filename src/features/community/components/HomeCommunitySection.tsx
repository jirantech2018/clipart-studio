'use client';

// 홈 페이지의 "공유 라이브러리 임베드" 영역을 하나의 client 컴포넌트로 묶어
// 부모(서버 컴포넌트) 는 태그 배열만 전달하고, sort state 는 이 안에서 hoist
// 해 TagMarquee 의 드롭다운과 CommunityGrid 를 동기화한다.

import { useState } from 'react';

import { CommunityGrid } from '@/features/community/components/CommunityGrid';
import { TagMarquee } from '@/features/community/components/TagMarquee';

import type { CommunitySort } from '@/features/community/hooks/useCommunity';

interface HomeCommunitySectionProps {
  tags: string[];
}

export function HomeCommunitySection({ tags }: HomeCommunitySectionProps) {
  const [sort, setSort] = useState<CommunitySort>('newest');

  return (
    <div className="space-y-4">
      <TagMarquee tags={tags} sort={sort} onSortChange={setSort} />
      <CommunityGrid hideCategoryFilters hideFilters sort={sort} onSortChange={setSort} />
    </div>
  );
}
