'use client';

// Controlled BatchSize selector — /generate 와 /generate-v2 가 공유.
//
// Props 만으로 동작하며 Store 를 직접 참조하지 않는다.
//   value / onChange       : controlled
//   disabled               : streaming 등 잠금
//   variant                : 이번 커밋에서는 default 만 시각 유의미. compact
//                            도 API 는 열어두되 스타일은 default 와 동일.
//                            v2 에서 필요해질 때 별도 커밋으로 확장.
//   visiblePresets         : 화면에 노출할 preset 수의 View 필터.
//                            정책값 BATCH_SIZE_PRESETS 는 그대로 두고 여기서만
//                            시각적으로 축약. 잘못된 값은 방어 처리.

import { cn } from '@/lib/utils';
import { BATCH_SIZE_PRESETS, MAX_BATCH_SIZE, MIN_BATCH_SIZE } from '@/types/domain';

interface BatchSizeSelectorProps {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  variant?: 'default' | 'compact';
  visiblePresets?: readonly number[];
  /** 직접 입력 input 에 붙일 id. 기존 GenerationForm 의 Label htmlFor 연결 유지. */
  inputId?: string;
}

/**
 * visiblePresets 방어 처리.
 *   - 정수만 통과
 *   - MIN_BATCH_SIZE <= x <= MAX_BATCH_SIZE 만 통과
 *   - 중복 제거
 *   - 원본 순서 유지 (오름차순 강제 X — 지시 §추가조건 1)
 *   - undefined 이면 BATCH_SIZE_PRESETS 전체 사용 (기존 동작)
 *   - 결과가 빈 배열이면 그대로 반환 (fallback 하지 않고 직접 입력만 표시)
 */
function sanitizePresets(input: readonly number[] | undefined): readonly number[] {
  if (input === undefined) return BATCH_SIZE_PRESETS;
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of input) {
    if (!Number.isInteger(v)) continue;
    if (v < MIN_BATCH_SIZE || v > MAX_BATCH_SIZE) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function BatchSizeSelector({
  value,
  onChange,
  disabled = false,
  visiblePresets,
  inputId,
}: BatchSizeSelectorProps) {
  const presets = sanitizePresets(visiblePresets);

  // 프리셋 개수에 따라 컬럼 구성 동적 계산. 기존 GenerationForm 의
  // `grid-cols-[repeat(4,1fr)_1.6fr]` 를 preset 개수에 맞춰 일반화한 것.
  // (Tailwind arbitrary value 대신 인라인 style 사용 — build-time 상수화
  //  제약 회피 + 정확히 같은 시각 결과.)
  const gridTemplateColumns =
    presets.length > 0 ? `repeat(${presets.length}, 1fr) 1.6fr` : '1fr';

  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns }}>
      {presets.map((size) => (
        <button
          key={size}
          type="button"
          disabled={disabled}
          onClick={() => onChange(size)}
          className={cn(
            'h-9 rounded-md border text-sm font-medium transition-colors',
            value === size
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-input bg-background hover:bg-accent',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          {size}장
        </button>
      ))}
      <div className="relative">
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={MIN_BATCH_SIZE}
          max={MAX_BATCH_SIZE}
          step={1}
          disabled={disabled}
          value={value}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              onChange(MIN_BATCH_SIZE);
              return;
            }
            const parsed = Number.parseInt(raw, 10);
            if (Number.isNaN(parsed)) return;
            onChange(Math.min(MAX_BATCH_SIZE, Math.max(MIN_BATCH_SIZE, parsed)));
          }}
          className={cn(
            'h-9 w-full rounded-md border border-input bg-background px-3 pr-12 text-center text-sm font-medium',
            // 브라우저 기본 number spinner 제거 (기존 GenerationForm 그대로)
            '[appearance:textfield]',
            '[&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none',
            '[&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none',
            'focus:outline-none focus:ring-2 focus:ring-primary/40',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        />
        <span
          className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm text-muted-foreground/60"
          aria-hidden="true"
        >
          ~{MAX_BATCH_SIZE}장
        </span>
      </div>
    </div>
  );
}
