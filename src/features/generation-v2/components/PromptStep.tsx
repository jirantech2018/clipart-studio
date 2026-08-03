'use client';

// STEP 1 — Prompt.
// draft 상태일 때만 편집 가능. queued/generating/completed/failed/unknown
// 상태에서는 read-only 로 잠기지만 내용은 여전히 읽을 수 있어야 한다
// (지시 §2 "내용은 읽을 수 있고 조작만 불가능해야 함").

import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface PromptStepProps {
  prompt: string;
  locked: boolean;
  autoFocus?: boolean;
  onChange: (next: string) => void;
}

export function PromptStep({ prompt, locked, autoFocus, onChange }: PromptStepProps) {
  return (
    <section className="space-y-2">
      <header className="flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          1
        </span>
        <h3 className="text-base font-semibold">무엇을 만들까요?</h3>
      </header>
      <Textarea
        value={prompt}
        onChange={(e) => onChange(e.target.value)}
        readOnly={locked}
        autoFocus={autoFocus}
        rows={4}
        maxLength={500}
        placeholder={
          '예: 운동장에서 줄넘기하는 초등학생\n봄 햇살이 비치는 날, 밝고 활기찬 분위기'
        }
        className={cn(
          'w-full resize-y',
          locked && 'cursor-not-allowed bg-muted/40 text-foreground/80',
        )}
      />
      <div className="flex items-center justify-end text-sm text-muted-foreground tabular-nums">
        {prompt.length} / 500
      </div>
    </section>
  );
}
