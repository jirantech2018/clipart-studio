'use client';

// STEP 1 — Prompt.
//
// Conversation Timeline 안에서 하나의 Block 상단을 구성하는 카드.
// 이 커밋(3-A)에서 시안 목표에 맞춰 아래 요소를 실제 wiring 한다.
//
//   [1] 무엇을 만들까요?          [최근 사용 ▾]
//   ┌──────────────────────────────┐
//   │  Textarea                    │
//   │                       0/500  │
//   └──────────────────────────────┘
//   [Lightbulb] AI 추천
//   [Chip] [Chip] [Chip] ...
//
// 재사용 자산 (Reuse First):
//   - PresetChips        : /generate 와 공유되는 controlled chip
//   - usePromptSuggestions : debounce + fallback 을 이미 처리 (변경 없음)
//   - RecentPromptDropdown : v2 신규. Conversation 내부 데이터만 소비
//
// draft 이외 상태(queued/generating/completed/failed/unknown) 에서는 locked=true
// 로 잠기며 내용은 계속 읽을 수 있어야 한다. AI 추천 chip 과 최근 사용
// Dropdown 은 disabled 처리 (숨김 아님 — 이전 조건 확인 가능).

import { Lightbulb } from 'lucide-react';

import { Textarea } from '@/components/ui/textarea';
import { PresetChips } from '@/features/generation/components/PresetChips';
import { RecentPromptDropdown } from '@/features/generation-v2/components/RecentPromptDropdown';
import { usePromptSuggestions } from '@/features/generation/hooks/usePromptSuggestions';
import { cn } from '@/lib/utils';

interface PromptStepProps {
  prompt: string;
  locked: boolean;
  autoFocus?: boolean;
  onChange: (next: string) => void;
  recentPrompts: readonly string[];
}

export function PromptStep({
  prompt,
  locked,
  autoFocus,
  onChange,
  recentPrompts,
}: PromptStepProps) {
  const suggestions = usePromptSuggestions(prompt);
  const hints = suggestions.data?.suggestions ?? [];

  return (
    <section className="flex h-full flex-col gap-3 rounded-xl border bg-muted/10 p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            1
          </span>
          <h3 className="text-base font-semibold">무엇을 만들까요?</h3>
        </div>
        <RecentPromptDropdown
          prompts={recentPrompts}
          currentPrompt={prompt}
          disabled={locked}
          onSelect={onChange}
        />
      </header>

      <div className="flex flex-1 flex-col gap-1">
        <Textarea
          value={prompt}
          onChange={(e) => onChange(e.target.value)}
          readOnly={locked}
          autoFocus={autoFocus}
          maxLength={500}
          placeholder={
            '예: 운동장에서 줄넘기하는 초등학생\n봄 햇살이 비치는 날, 밝고 활기찬 분위기'
          }
          className={cn(
            'min-h-[10rem] w-full flex-1 resize-none',
            locked && 'cursor-not-allowed bg-muted/40 text-foreground/80',
          )}
        />
        <div className="flex items-center justify-end text-sm text-muted-foreground tabular-nums">
          {prompt.length} / 500
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
          <span>AI 추천</span>
        </div>
        <div className="min-h-[2rem]">
          <PresetChips
            hints={hints}
            loading={suggestions.isFetching}
            value={prompt}
            onChange={onChange}
            disabled={locked}
          />
        </div>
      </div>
    </section>
  );
}
