'use client';

// Embed 공유 라이브러리 섹션 wrapper.
//
// sort state 를 hoist 해 EmbedCommunityHeader (드롭다운) 와
// CommunityEmbedGrid (fetch) 가 공유하도록 한다. 서비스 홈의
// HomeCommunitySection 과 동일한 패턴.

import { useState } from 'react';

import { CommunityEmbedGrid, type EmbedCommunityImage, type EmbedCommunitySort } from './CommunityEmbedGrid';
import { EmbedCommunityHeader } from './EmbedCommunityHeader';

interface Props {
  initialImages: EmbedCommunityImage[];
  initialTotal: number;
  tags: string[];
  loadMoreBatch: number;
}

export function EmbedCommunitySection({
  initialImages,
  initialTotal,
  tags,
  loadMoreBatch,
}: Props) {
  const [sort, setSort] = useState<EmbedCommunitySort>('newest');

  return (
    <div className="space-y-4">
      <EmbedCommunityHeader
        tags={tags}
        sort={sort}
        onSortChange={setSort}
      />
      <CommunityEmbedGrid
        initialImages={initialImages}
        initialTotal={initialTotal}
        initialSort="newest"
        sort={sort}
        batchSize={loadMoreBatch}
      />
    </div>
  );
}
