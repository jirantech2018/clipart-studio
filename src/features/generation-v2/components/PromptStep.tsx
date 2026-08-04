'use client';

// STEP 1 — Prompt.
//
// Conversation Timeline 안에서 하나의 Block 상단을 구성하는 카드.
//
//   [1] 어떤 클립아트를 만들까요?
//   ┌──────────────────────────────┐
//   │  Textarea                    │
//   │                       0/500  │
//   └──────────────────────────────┘
//   [Lightbulb] AI 추천
//   [Chip] [Chip] [Chip] ...
//   ┌──────────────────────────────────────────────┐
//   │ ☑ 클립아트마다 다르게 만들기 (compact)        │
//   └──────────────────────────────────────────────┘
//
// 재사용 자산:
//   - PresetChips             : /generate 와 공유되는 controlled chip
//   - usePromptSuggestions    : debounce + fallback (변경 없음)
//   - DiversityPromptList     : /generate 와 공유. 여기서는 compact variant
//                               (시안 hero UI: 체크박스 + 5-슬롯 예시 세트)
//
// draft 이외 상태(queued/generating/completed/failed/unknown) 에서는 locked=true
// 로 잠기며 내용은 계속 읽을 수 있어야 한다. AI 추천 chip / 다양성 슬롯 모두
// disabled 처리 (숨김 아님).

import { Lightbulb } from 'lucide-react';

import { Textarea } from '@/components/ui/textarea';
import { DiversityPromptList } from '@/features/generation/components/DiversityPromptList';
import { PresetChips } from '@/features/generation/components/PresetChips';
import { usePromptSuggestions } from '@/features/generation/hooks/usePromptSuggestions';
import { cn } from '@/lib/utils';

interface PromptStepProps {
  prompt: string;
  locked: boolean;
  autoFocus?: boolean;
  onChange: (next: string) => void;
  // 다양성 생성 controlled 전달 — SoT 는 여전히 BlockOptions.
  diversityEnabled: boolean;
  onDiversityEnabledChange: (next: boolean) => void;
  slotPrompts: readonly string[];
  onSlotPromptsChange: (next: string[]) => void;
  batchSize: number;
}

export function PromptStep({
  prompt,
  locked,
  autoFocus,
  onChange,
  diversityEnabled,
  onDiversityEnabledChange,
  slotPrompts,
  onSlotPromptsChange,
  batchSize,
}: PromptStepProps) {
  const suggestions = usePromptSuggestions(prompt);
  const hints = suggestions.data?.suggestions ?? [];

  return (
    <section className="card flex h-full flex-col gap-3 p-5">
      <header className="flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          1
        </span>
        <h3 className="text-base font-semibold">어떤 클립아트를 만들까요?</h3>
      </header>

      <div className="flex flex-col gap-1">
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
            'min-h-[10rem] w-full resize-none',
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

      <DiversityPromptList
        enabled={diversityEnabled}
        onEnabledChange={onDiversityEnabledChange}
        slotPrompts={slotPrompts}
        onSlotPromptsChange={onSlotPromptsChange}
        batchSize={batchSize}
        disabled={locked}
        variant="compact"
      />
    </section>
  );
}
