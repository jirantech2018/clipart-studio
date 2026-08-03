'use client';

// Conversation Timeline 에서 AI 측 응답을 감싸는 시각 wrapper.
//
// Draft Block (Prompt + Option) 은 "사용자 발화" 성격이고,
// Generating / Completed / failed / unknown 은 "AI 응답" 성격이다.
// 아바타 + 좌측 여백으로 대화 흐름을 시각적으로 통일한다.
//
// 새 컴포넌트를 추가하지 않고 conversation UX 를 위해 응답에만 재사용.

import { Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';

interface Props {
  children: React.ReactNode;
  className?: string;
}

export function AiResponseBubble({ children, className }: Props) {
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <div
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm"
        title="AI"
      >
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
