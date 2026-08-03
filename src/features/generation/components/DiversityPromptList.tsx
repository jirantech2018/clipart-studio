'use client';

// 다양성 생성 (Custom Diversity) — 순수 Controlled 컴포넌트.
//
// /generate 와 /generate-v2 두 곳에서 공유하며 자체 Store / 자체 상태는 갖지
// 않는다. batchSize 리사이즈나 payload 조립은 부모 책임. 이 컴포넌트는
// 전달받은 값을 노출하고 변경 이벤트만 부모에 콜백한다.
//
// 시각 규칙:
//   default : /generate 인라인 원본 DOM/스타일 그대로 유지 (회귀 방지)
//   compact : /generate-v2 PromptStep 안 (AI 추천 하단) 에 embed 되는 hero
//             UI. 시안 톤 — 체크박스 + 5슬롯 예시 세트 + 우측 힌트 텍스트.
//             batchSize 가 5보다 크면 예시 세트를 mod 로 순환 사용.

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

// compact variant 의 슬롯별 예시 placeholder + 우측 힌트 텍스트.
// batchSize 가 세트 길이보다 크면 mod 로 순환한다.
const COMPACT_SLOT_HINTS: ReadonlyArray<{ placeholder: string; hint: string }> = [
  { placeholder: '예) 사회 선생님', hint: '사회 선생님, 과학 선생님' },
  { placeholder: '예) 과학 선생님', hint: '음악 선생님, 체육 선생님' },
  { placeholder: '예) 음악 선생님', hint: '미술 선생님, 도서관 배경' },
  { placeholder: '예) 미술 선생님', hint: '급식실, 교실 풍경' },
  { placeholder: '예) 체육 선생님', hint: '운동장, 실험실 풍경' },
];

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

  if (compact) {
    // v2 hero UI — 시안 톤. checkbox + 5-slot 예시 세트.
    return (
      <div className="rounded-md border bg-primary/5 p-3">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            disabled={disabled}
            className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          />
          <div className="space-y-0.5">
            <div className="text-sm font-semibold text-primary">
              클립아트마다 다르게 만들기
            </div>
            <div className="text-xs text-muted-foreground">
              여러 장을 만들 때, 각 클립아트의 주제나 내용을 다르게 지정할 수 있어요.
            </div>
          </div>
        </label>

        {enabled && (
          <div className="mt-3 space-y-2">
            <div className="max-h-[20rem] space-y-2 overflow-y-auto pr-1">
              {visible.map((slot, i) => {
                const preset =
                  COMPACT_SLOT_HINTS[i % COMPACT_SLOT_HINTS.length] ??
                  COMPACT_SLOT_HINTS[0]!;
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-xs font-semibold tabular-nums text-foreground">
                      클립아트 {i + 1}
                    </span>
                    <input
                      type="text"
                      value={slot}
                      onChange={(e) => handleSlotChange(i, e.target.value)}
                      disabled={disabled}
                      placeholder={preset.placeholder}
                      maxLength={500}
                      className={cn(
                        'h-9 min-w-0 flex-1 rounded-md border border-input bg-white/70 px-3 text-sm',
                        'focus:outline-none focus:ring-2 focus:ring-primary/40',
                        disabled && 'cursor-not-allowed opacity-50',
                      )}
                    />
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:block sm:w-40 md:w-44">
                      예시: {preset.hint}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              비워두면 공통 프롬프트 내용으로 생성됩니다.
            </p>
          </div>
        )}
      </div>
    );
  }

  // default variant — /generate 원본 톤 유지.
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
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
            클립아트마다 다른 주제·소재를 지정할 수 있어요
          </span>
        </span>
      </label>

      {enabled && (
        <div className="max-h-[30rem] space-y-1.5 overflow-y-auto pr-1 pt-1">
          {visible.map((slot, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-sm tabular-nums text-muted-foreground">
                클립아트 {i + 1}
              </span>
              <input
                type="text"
                value={slot}
                onChange={(e) => handleSlotChange(i, e.target.value)}
                disabled={disabled}
                placeholder="예) 사회 선생님"
                maxLength={500}
                className={cn(
                  'h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-primary/40',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            비워두면 공통 프롬프트만 사용해요. 각 슬롯에는 공통 프롬프트에 이
            문구가 추가되어 전달됩니다.
          </p>
        </div>
      )}
    </div>
  );
}
