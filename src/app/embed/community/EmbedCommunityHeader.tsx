'use client';

// Embed 공유 라이브러리 상단 헤더.
//
// - 중앙 정렬 검색창 (submit 시 서비스 사이트 검색 페이지로 새 창 이동)
// - 슬라이드 태그 마퀴 (좌 화살표로 다음 페이지, 마지막이면 첫으로 순환)
// - 우측 최신순/인기순 드롭다운 (부모가 sort state 를 controlled 로 조작)
//
// 서비스 홈의 SearchBar + TagMarquee 와 시각적으로 유사하되, embed 컨텍스트라
// 태그·검색 이동은 새 창 (target=_blank) 으로 열어 iframe 스크롤을 방해하지 않음.

import { ChevronLeft, Search } from 'lucide-react';
import { useState } from 'react';

import type { EmbedCommunitySort } from './CommunityEmbedGrid';

// 검색·태그 클릭 시 마케팅 사이트의 /search?q=<q> 페이지로 이동한다.
// 마케팅 사이트가 그 안에서 우리 /embed/search?q=<q> 를 iframe 으로 감싸는
// 규약 (마케팅 헤더/네비를 유지한 채 검색 결과 표시).
const MARKETING_ORIGIN = 'https://clipart.schoolp.co.kr';
const TAG_PAGE_SIZE = 6;

const SORT_LABELS: Record<EmbedCommunitySort, string> = {
  newest: '최신순',
  popular: '인기순',
};

interface Props {
  tags: string[];
  sort: EmbedCommunitySort;
  onSortChange: (next: EmbedCommunitySort) => void;
}

export function EmbedCommunityHeader({ tags, sort, onSortChange }: Props) {
  const [query, setQuery] = useState('');
  const [tagPage, setTagPage] = useState(0);

  const totalPages =
    tags.length > 0 ? Math.max(1, Math.ceil(tags.length / TAG_PAGE_SIZE)) : 1;
  const start = tagPage * TAG_PAGE_SIZE;
  const visibleTags = tags.slice(start, start + TAG_PAGE_SIZE);
  const advance = () => setTagPage((p) => (p + 1) % totalPages);

  function handleSearchSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    // 새 창에서 서비스 사이트 검색 페이지 열림.
    window.open(
      `${MARKETING_ORIGIN}/search?q=${encodeURIComponent(trimmed)}`,
      '_blank',
      'noopener',
    );
  }

  return (
    <div className="space-y-3">
      {/* 검색창 — 좌측 정렬, 최대 폭 제한. 브랜드 인디고 (#373d8e) 3px 테두리
          + 동일 색 돋보기 아이콘. 높이 크게 (h-14) 로 존재감 확보. */}
      <form
        onSubmit={handleSearchSubmit}
        className="w-full max-w-xl"
      >
        <label className="relative block">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2"
            style={{ color: '#373d8e' }}
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="찾고 싶은 이미지를 검색해보세요"
            className="h-14 w-full rounded-full bg-background pl-12 pr-4 text-base placeholder:text-muted-foreground focus:outline-none"
            style={{ border: '3px solid #373d8e' }}
          />
        </label>
      </form>

      {/* 태그 마퀴 + 정렬 드롭다운 */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={advance}
          disabled={tags.length === 0}
          aria-label="다음 태그"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-background transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>

        <div className="flex flex-1 items-center gap-2 overflow-hidden whitespace-nowrap">
          {visibleTags.length > 0 ? (
            visibleTags.map((tag) => (
              <a
                key={tag}
                href={`${MARKETING_ORIGIN}/search?q=${encodeURIComponent(tag)}`}
                target="_blank"
                rel="noopener"
                className="inline-flex shrink-0 items-center rounded-full border border-input bg-background px-3 py-1 text-sm transition-colors hover:border-primary hover:bg-accent"
              >
                #{tag}
              </a>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">
              아직 공유된 이미지가 없어요.
            </span>
          )}
        </div>

        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as EmbedCommunitySort)}
          className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="정렬 방식"
        >
          {(Object.keys(SORT_LABELS) as EmbedCommunitySort[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
