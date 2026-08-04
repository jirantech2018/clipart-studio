'use client';

// 사용 가이드 배너 — /generate-v2 헤더의 "사용 가이드 ▾" 를 펼쳤을 때
// 노출되는 상단 소개 섹션.
//
// 구조:
//   1. 큰 헤더 ("4가지 방법으로 클립아트를 만들어보세요!" + 부제)
//   2. 4개 카드 grid (1/2/4 반응형)
//      - 좌상단 번호 뱃지 (톤 색상)
//      - 중앙 원형 아이콘 박스 (톤 lighter 배경 + 톤 색상 아이콘)
//      - 제목 (검정 볼드)
//      - 부제 (카드 톤 색상)
//      - 설명 (회색, 자연 wrap)
//      - 하단에 예시 스크린샷 이미지 (별도 pill wrapper 없이 이미지만)
//   3. 하단 팁 배너 ("💡 다양한 방법을 상황에 맞게 활용해 보세요!")

import { Files, Gift, ImageIcon, PenLine } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { LucideIcon } from 'lucide-react';

interface GuideItem {
  number: number;
  Icon: LucideIcon;
  title: string;
  subtitle: string;
  description: string;
  exampleImage: string;
  /** Tailwind 톤 매핑. */
  tone: {
    numberBg: string;
    iconBg: string;
    iconColor: string;
    subtitleColor: string;
  };
}

const GUIDE_ITEMS: ReadonlyArray<GuideItem> = [
  {
    number: 1,
    Icon: PenLine,
    title: '직접 만들기',
    subtitle: '프롬프트로 클립아트 만들기',
    description:
      '원하는 내용을 자유롭게 입력하면 AI가 새로운 클립아트를 만들어드립니다.',
    exampleImage: '/generate-v2_intro_01.png',
    tone: {
      numberBg: 'bg-purple-500',
      iconBg: 'bg-purple-100',
      iconColor: 'text-purple-600',
      subtitleColor: 'text-purple-600',
    },
  },
  {
    number: 2,
    Icon: ImageIcon,
    title: '참고 이미지 활용하기',
    subtitle: '참조 이미지로 클립아트 만들기',
    description:
      '내가 등록한 참고 이미지나 학교·기관의 기본 이미지를 바탕으로 비슷한 스타일의 클립아트를 생성합니다.',
    exampleImage: '/generate-v2_intro_02.png',
    tone: {
      numberBg: 'bg-blue-500',
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
      subtitleColor: 'text-blue-600',
    },
  },
  {
    number: 3,
    Icon: Files,
    title: '기존 클립아트 활용하기',
    subtitle: '라이브러리 클립아트로 만들기',
    description:
      '내가 만든 클립아트나 공유 라이브러리의 클립아트를 선택해 새로운 클립아트로 확장합니다.',
    exampleImage: '/generate-v2_intro_03.png',
    tone: {
      numberBg: 'bg-emerald-500',
      iconBg: 'bg-emerald-100',
      iconColor: 'text-emerald-600',
      subtitleColor: 'text-emerald-600',
    },
  },
  {
    number: 4,
    Icon: Gift,
    title: '테마 패키지 만들기',
    subtitle: '테마별(목적별) 클립아트 패키지 생성하기',
    description:
      '행사나 수업 주제를 선택하면 포스터, 아이콘, 삽화 등 필요한 클립아트를 한 번에 생성합니다.',
    exampleImage: '/generate-v2_intro_04.png',
    tone: {
      numberBg: 'bg-rose-500',
      iconBg: 'bg-rose-100',
      iconColor: 'text-rose-500',
      subtitleColor: 'text-rose-500',
    },
  },
];

export function UsageGuideBanners() {
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          4가지 방법으로 클립아트를 만들어보세요!
        </h2>
        <p className="text-sm text-muted-foreground">
          원하는 방식으로 쉽고 빠르게 나만의 클립아트를 생성할 수 있습니다.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {GUIDE_ITEMS.map((item) => (
          <GuideCard key={item.number} item={item} />
        ))}
      </div>
    </div>
  );
}

function GuideCard({ item }: { item: GuideItem }) {
  const { number, Icon, title, subtitle, description, exampleImage, tone } = item;
  return (
    <div className="card relative flex flex-col gap-4 p-6">
      {/* 좌상단 번호 뱃지 */}
      <div
        className={cn(
          'absolute left-4 top-4 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white',
          tone.numberBg,
        )}
      >
        {number}
      </div>

      {/* 중앙 원형 아이콘 박스 */}
      <div className="flex justify-center pt-2">
        <div
          className={cn(
            'flex h-20 w-20 items-center justify-center rounded-full',
            tone.iconBg,
          )}
        >
          <Icon className={cn('h-9 w-9', tone.iconColor)} aria-hidden="true" />
        </div>
      </div>

      {/* 제목 + 부제 */}
      <div className="space-y-1 text-center">
        <h3 className="text-base font-bold text-foreground">{title}</h3>
        <p className={cn('text-sm font-semibold', tone.subtitleColor)}>
          {subtitle}
        </p>
      </div>

      {/* 설명 — 자연 wrap. 내부 개행 없음. */}
      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>

      {/* 하단 예시 이미지 — pill/배경 없이 이미지만 표시. */}
      <div className="mt-auto flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={exampleImage}
          alt={`${title} 예시`}
          className="h-auto w-full max-w-full rounded-md object-contain"
          loading="lazy"
        />
      </div>
    </div>
  );
}
