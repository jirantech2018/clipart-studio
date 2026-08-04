'use client';

// 사용 가이드 배너 4단 — /generate-v2 상단 헤더의 "사용 가이드 ▾" 를 펼쳤을 때
// 노출되는 소개 카드. 정보 표시 전용이며 상태를 소유하지 않는다.
// 4개 카드 데이터를 하나의 배열에서 정의하고 반응형 grid 로 렌더 (좁은
// 화면에서는 1~2단, lg 이상에서 4단).

import { Files, Gift, ImageIcon, PenLine } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { LucideIcon } from 'lucide-react';

interface GuideItem {
  Icon: LucideIcon;
  title: string;
  subtitle: string;
  description: string;
  example: string;
  /** Tailwind 톤 매핑 (배경/아이콘/부제) — 카드마다 다른 파스텔 색. */
  tone: {
    iconBg: string;
    iconColor: string;
    subtitleColor: string;
    exampleBg: string;
    exampleText: string;
  };
}

const GUIDE_ITEMS: ReadonlyArray<GuideItem> = [
  {
    Icon: PenLine,
    title: '직접 만들기',
    subtitle: '프롬프트로 클립아트 만들기',
    description:
      '원하는 내용을 자유롭게 입력하면 AI가 새로운 클립아트를 만들어드립니다.',
    example: '운동장에서 줄넘기하는 초등학생',
    tone: {
      iconBg: 'bg-purple-100/70',
      iconColor: 'text-purple-600',
      subtitleColor: 'text-purple-700',
      exampleBg: 'bg-purple-50/80',
      exampleText: 'text-purple-700',
    },
  },
  {
    Icon: ImageIcon,
    title: '참고 이미지 활용하기',
    subtitle: '참조 이미지로 클립아트 만들기',
    description:
      '내가 등록한 참고 이미지나 학교 기본 이미지를 바탕으로 비슷한 분위기의 클립아트를 생성합니다.',
    example: '학교 캐릭터 스타일 유지하기',
    tone: {
      iconBg: 'bg-sky-100/70',
      iconColor: 'text-sky-600',
      subtitleColor: 'text-sky-700',
      exampleBg: 'bg-sky-50/80',
      exampleText: 'text-sky-700',
    },
  },
  {
    Icon: Files,
    title: '기존 클립아트 활용하기',
    subtitle: '라이브러리 클립아트로 만들기',
    description:
      '내가 만든 클립아트나 공유 라이브러리의 클립아트를 선택해 새로운 클립아트로 확장합니다.',
    example: '같은 캐릭터의 다른 포즈 만들기',
    tone: {
      iconBg: 'bg-emerald-100/70',
      iconColor: 'text-emerald-600',
      subtitleColor: 'text-emerald-700',
      exampleBg: 'bg-emerald-50/80',
      exampleText: 'text-emerald-700',
    },
  },
  {
    Icon: Gift,
    title: '테마 패키지 만들기',
    subtitle: '테마별(목적별) 클립아트 패키지 생성하기',
    description:
      '행사나 수업 주제를 선택하면 포스터, 아이콘, 삽화 등 필요한 클립아트를 한 번에 생성합니다.',
    example: '독서 행사 패키지 만들기',
    tone: {
      iconBg: 'bg-rose-100/70',
      iconColor: 'text-rose-600',
      subtitleColor: 'text-rose-700',
      exampleBg: 'bg-rose-50/80',
      exampleText: 'text-rose-700',
    },
  },
];

export function UsageGuideBanners() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {GUIDE_ITEMS.map((item) => (
        <GuideCard key={item.title} item={item} />
      ))}
    </div>
  );
}

function GuideCard({ item }: { item: GuideItem }) {
  const { Icon, title, subtitle, description, example, tone } = item;
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
            tone.iconBg,
          )}
        >
          <Icon className={cn('h-5 w-5', tone.iconColor)} aria-hidden="true" />
        </div>
        <div className="min-w-0 space-y-0.5">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className={cn('text-xs font-medium', tone.subtitleColor)}>
            {subtitle}
          </div>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
      <div
        className={cn(
          'mt-auto flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs',
          tone.exampleBg,
        )}
      >
        <span
          className={cn(
            'shrink-0 rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] font-medium',
            tone.exampleText,
          )}
        >
          예시
        </span>
        <span className="text-muted-foreground">{example}</span>
      </div>
    </div>
  );
}
