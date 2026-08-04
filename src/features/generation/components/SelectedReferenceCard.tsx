'use client';

// 생성 폼 상단에 표시되는 "이번 생성에 참조되는 이미지 요약" 카드.
//
// /generate 에서는 원래 chaining (parent) 케이스와 개인/조직 참조 선택 케이스
// 두 곳에 인라인으로 반복 렌더되던 UI 였다. /generate-v2 에서도 개인 참조
// 클립아트 / 학교(조직) 참조 이미지 선택 시 동일 시각으로 노출하기 위해 하나의
// 공유 컴포넌트로 추출.
//
// 순수 controlled: 데이터 조회 / 상태 관리는 부모 책임. 이 컴포넌트는 전달된
// 값을 렌더하고 onClear 콜백만 부모에 전달한다.

import { X } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

interface SelectedReferenceCardProps {
  thumbnailUrl: string;
  /** 상단 라벨 — "참조 이미지", "개인 참조 클립아트", "조직 참조 이미지" 등. */
  label: string;
  /** 라벨 아래 두 번째 줄. 파일명 / 프롬프트 / 설명 등. null 이면 안 그림. */
  description: string | null;
  /** 하단 링크의 href (원본 상세, 슬롯 관리 페이지 등). */
  linkHref: string;
  /** 하단 링크 텍스트. */
  linkLabel: string;
  /** X 버튼 클릭 시 호출. */
  onClear: () => void;
  disabled?: boolean;
  /** 좁은 wrapper 에 얹혔을 때 여백을 조정하고 싶으면 className 으로 넘긴다. */
  className?: string;
}

export function SelectedReferenceCard({
  thumbnailUrl,
  label,
  description,
  linkHref,
  linkLabel,
  onClear,
  disabled = false,
  className,
}: SelectedReferenceCardProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-md border bg-muted/30 p-2',
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumbnailUrl}
        alt="참조 이미지"
        className="h-16 w-16 shrink-0 rounded object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-primary">{label}</p>
        {description && (
          <p
            className="line-clamp-2 text-xs text-muted-foreground"
            title={description}
          >
            {description}
          </p>
        )}
        <Link
          href={linkHref}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {linkLabel}
        </Link>
      </div>
      <button
        type="button"
        onClick={onClear}
        disabled={disabled}
        className={cn(
          'rounded p-1 text-muted-foreground hover:bg-accent',
          disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
        )}
        aria-label="참조 이미지 해제"
        title="참조 이미지 해제"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
