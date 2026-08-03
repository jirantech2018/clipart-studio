'use client';

// 다양성 생성 (Custom Diversity) — 순수 Controlled 컴포넌트.
//
// /generate 와 /generate-v2 두 곳에서 공유하며 자체 Store / 자체 상태는 갖지
// 않는다. batchSize 리사이즈나 payload 조립은 부모 책임. 이 컴포넌트는
// 전달받은 값을 노출하고 변경 이벤트만 부모에 콜백한다.
//
// 시각 규칙:
//   default : /generate 인라인 원본 DOM/스타일 그대로 유지 (회귀 방지)
//   compact : v2 Option Panel 밀도에 맞춰 padding/gap 축소, 슬롯 목록은
//             내부 세로 스크롤로 CTA 위치를 밀지 않도록 max-height 지정

import { cn } from '@/lib/utils';

interface DiversityPromptListProps {
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  slotPrompts: readonly string[];
  onSlotPromptsChange: (next: string[]) => void;
  batchSize: number;
  disabled?: boolean;
  variant?: 'default' | 'compact';
}

export function DiversityPromptList({
  enabled,
  onEnabledChange,
  slotPrompts,
  onSlotPromptsChange,
  batchSize,
  disabled = false,
  variant = 'default',
}: DiversityPromptListProps) {
  const compact = variant === 'compact';

  function handleSlotChange(index: number, value: string) {
    const next = [...slotPrompts];
    next[index] = value;
    onSlotPromptsChange(next);
  }

  // batchSize 가 store 상 값이고 slotPrompts 길이가 아직 정합되지 않은 경우
  // 를 대비해 렌더 대상은 batchSize 기준으로 뽑는다. 실제 정합은 부모가
  // resizeSlotPrompts 로 유지.
  const visible = Array.from(
    { length: Math.max(0, Math.floor(batchSize)) },
    (_, i) => slotPrompts[i] ?? '',
  );

  return (
    <div
      className={cn(
        'space-y-2 rounded-md border bg-muted/20',
        compact ? 'p-2.5' : 'p-3',
      )}
    >
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          disabled={disabled}
          className="mt-0.5 h-4 w-4 shrink-0"
        />
        <span>
          <span className="font-medium">다양성 생성</span>
          <span className="ml-1 text-xs text-muted-foreground">
            이미지마다 다른 주제·소재를 지정할 수 있어요
          </span>
        </span>
      </label>

      {enabled && (
        <div
          className={cn(
            'space-y-1.5 pt-1',
            // 슬롯이 많을 때 CTA 위치가 밀리지 않도록 내부 세로 스크롤.
            // compact 는 8칸(약 20rem) 이후, default 는 12칸(약 30rem) 이후.
            compact
              ? 'max-h-[20rem] overflow-y-auto pr-1'
              : 'max-h-[30rem] overflow-y-auto pr-1',
          )}
        >
          {visible.map((slot, i) => (
            <div key={i} className="flex items-center gap-2">
              <span
                className={cn(
                  'shrink-0 tabular-nums text-muted-foreground',
                  compact ? 'w-12 text-xs' : 'w-14 text-sm',
                )}
              >
                이미지 {i + 1}
              </span>
              <input
                type="text"
                value={slot}
                onChange={(e) => handleSlotChange(i, e.target.value)}
                disabled={disabled}
                placeholder="예) 사회 선생님"
                maxLength={500}
                className={cn(
                  'flex-1 rounded-md border border-input bg-background px-2 text-sm',
                  compact ? 'h-7' : 'h-8',
                  'focus:outline-none focus:ring-2 focus:ring-primary/40',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
              />
            </div>
          ))}
          <p
            className={cn(
              'text-muted-foreground',
              compact ? 'text-[11px] leading-snug' : 'text-xs',
            )}
          >
            비워두면 공통 프롬프트만 사용해요. 각 슬롯에는 공통 프롬프트에 이
            문구가 추가되어 전달됩니다.
          </p>
        </div>
      )}
    </div>
  );
}
