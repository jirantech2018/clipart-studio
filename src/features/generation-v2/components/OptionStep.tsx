'use client';

// STEP 2 — 생성 옵션 (v2).
//   - 생성 개수 : 공통 BatchSizeSelector 재사용, visiblePresets=[1,5,10]
//   - 이미지 비율 : 공통 AspectRatioSelector 재사용
//   - 학교 설정 요약 (실제 Picker 는 Commit 3)
//   - "이미지 만들기" primary CTA
// Read-only 모드: 모든 컨트롤 disabled + CTA 사라짐.

import { Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AspectRatioSelector } from '@/features/generation/components/AspectRatioSelector';
import { BatchSizeSelector } from '@/features/generation/components/BatchSizeSelector';
import { BATCH_SIZE_PRESETS } from '@/types/domain';

import type { BlockOptions } from '@/lib/store/conversationStore';

interface OptionStepProps {
  options: BlockOptions;
  locked: boolean;
  submitting: boolean;
  insufficient: boolean;
  onChange: (patch: Partial<BlockOptions>) => void;
  onSubmit: () => void;
}

// v2 시안 노출 프리셋 = 1 / 5 / 10 / 직접 입력. 정책 상수는 재사용하고
// View 필터만 여기서 적용 (지시서 §Q4). 하드코딩된 리터럴 배열 대신
// 정책 상수에서 필터해 이후 정책 변경 시 자동 반영.
const V2_VISIBLE_PRESETS = BATCH_SIZE_PRESETS.filter(
  (v) => v === 1 || v === 5 || v === 10,
);

export function OptionStep({
  options,
  locked,
  submitting,
  insufficient,
  onChange,
  onSubmit,
}: OptionStepProps) {
  const disabled = locked || submitting;

  return (
    <section className="flex h-full flex-col gap-4 rounded-md border bg-muted/20 p-4">
      <header className="flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          2
        </span>
        <h3 className="text-base font-semibold">생성 옵션</h3>
      </header>

      {/* 생성 개수 */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label>생성 개수</Label>
          <span className="text-sm tabular-nums text-muted-foreground">
            <span className="font-semibold text-foreground">{options.batchSize}</span>{' '}
            크레딧 사용
          </span>
        </div>
        <BatchSizeSelector
          value={options.batchSize}
          onChange={(next) => onChange({ batchSize: next })}
          disabled={disabled}
          variant="compact"
          visiblePresets={V2_VISIBLE_PRESETS}
        />
      </div>

      {/* 이미지 비율 */}
      <div className="space-y-2">
        <Label>이미지 비율</Label>
        <AspectRatioSelector
          value={options.aspectRatio}
          onChange={(next) => onChange({ aspectRatio: next })}
          disabled={disabled}
          variant="compact"
        />
      </div>

      {/* 학교 설정 요약 — 실제 Picker 는 Commit 3 */}
      {options.orgSlug && (
        <div className="rounded-md border bg-background p-3 text-sm">
          <div className="font-medium">학교 설정 적용</div>
          <div className="mt-0.5 text-muted-foreground">
            조직 컨텍스트({options.orgSlug}) 의 기본 프롬프트 · 참조 이미지가 자동
            적용됩니다.
          </div>
        </div>
      )}

      {/* 생성 CTA — flex-1 로 위 옵션들을 밀어올린 뒤 하단 우측 정렬 */}
      {!locked && (
        <div className="mt-auto flex items-center justify-end pt-1">
          <Button
            type="button"
            onClick={onSubmit}
            disabled={submitting || insufficient}
            className="min-w-[10rem]"
          >
            <Sparkles className="mr-1 h-4 w-4" />
            {submitting
              ? '요청 중…'
              : insufficient
                ? '크레딧 부족'
                : '이미지 만들기'}
          </Button>
        </div>
      )}
    </section>
  );
}
