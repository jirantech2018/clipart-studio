'use client';

// STEP 2 — 생성 옵션 (v2).
//
// 목표 시안의 압축 옵션 패널.
//   1. 생성 개수      (BatchSizeSelector compact, presets=[1,5,10]+직접입력)
//   2. 이미지 비율    (AspectRatioSelector compact)
//   3. 개인 참조 이미지 (OptionReferencePicker → ReferenceLibrarySection compact)
//   4. 학교 설정      (OptionSchoolPicker → 기존 조직 훅 재사용)
//   5. Validation 안내 (validateBlockSubmission → messageForIssue)
//   6. 이미지 만들기 CTA (전체 폭, 문구는 요청 상태에 따라만 변경)
//
// 상태 SoT 는 Conversation Block options. 이 컴포넌트는 controlled 로만
// 동작하며 전역 store 를 참조하지 않는다.

import { Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AspectRatioSelector } from '@/features/generation/components/AspectRatioSelector';
import { BatchSizeSelector } from '@/features/generation/components/BatchSizeSelector';
import { SelectedReferenceCard } from '@/features/generation/components/SelectedReferenceCard';
import { resizeSlotPrompts } from '@/features/generation/lib/resizeSlotPrompts';
import { useOrganizationReferenceImages } from '@/features/organization/hooks/useOrganizationReferenceImages';
import { OptionReferencePicker } from '@/features/generation-v2/components/OptionReferencePicker';
import { OptionSchoolPicker } from '@/features/generation-v2/components/OptionSchoolPicker';
import { useReferenceImages } from '@/features/references/hooks/useReferenceImages';
import { BATCH_SIZE_PRESETS } from '@/types/domain';

import type { BlockOptions } from '@/lib/store/conversationStore';

interface OptionStepProps {
  options: BlockOptions;
  locked: boolean;
  submitting: boolean;
  /** 사용자 안내 문구. null 이면 안내 없음 = 생성 가능. */
  issueMessage: string | null;
  onChange: (patch: Partial<BlockOptions>) => void;
  onSubmit: () => void;
}

// v2 노출 프리셋 (지시 §5): 1 / 5 / 10 + 직접입력. 정책 상수 (1/2/5/10) 는
// 그대로 두고 View 필터만 여기서 적용.
const V2_VISIBLE_PRESETS = BATCH_SIZE_PRESETS.filter(
  (v) => v === 1 || v === 5 || v === 10,
);

export function OptionStep({
  options,
  locked,
  submitting,
  issueMessage,
  onChange,
  onSubmit,
}: OptionStepProps) {
  const disabled = locked || submitting;

  const personalReferenceId = options.personalReferenceIds[0] ?? null;
  const orgReferenceId = options.orgReferenceIds[0] ?? null;
  const personalActive = personalReferenceId !== null;
  const orgReferenceActive = orgReferenceId !== null;

  // 선택된 참조 이미지 상단 요약 카드용 slot 정보. 하위 picker 들이 이미
  // 동일 훅을 호출하므로 React Query dedupe 로 추가 요청 없음.
  const personalRefs = useReferenceImages();
  // OptionSchoolPicker 와 동일 인자로 호출 → React Query dedupe 로 중복 요청 없음.
  const orgRefs = useOrganizationReferenceImages(options.orgSlug);
  const selectedPersonalSlot = personalReferenceId
    ? personalRefs.data?.slots.find((s) => s.id === personalReferenceId) ?? null
    : null;
  const selectedOrgSlot = orgReferenceId
    ? orgRefs.data?.references.find((r) => r.id === orgReferenceId) ?? null
    : null;

  function handlePersonalReferenceChange(next: string | null) {
    if (next === null) {
      onChange({ personalReferenceIds: [] });
      return;
    }
    // 상호배제 (기존 /generate 정책): 개인 참조 선택 시 조직 참조는 해제.
    onChange({ personalReferenceIds: [next], orgReferenceIds: [] });
  }

  function handleOrgReferenceIdChange(next: string | null) {
    if (next === null) {
      onChange({ orgReferenceIds: [] });
      return;
    }
    // 상호배제: 조직 참조 선택 시 개인 참조는 해제.
    onChange({ orgReferenceIds: [next], personalReferenceIds: [] });
  }

  function handleOrgSlugChange(nextSlug: string | null) {
    // 조직 선택 자체가 "학교 설정 적용" 을 의미 (기존 SchoolContextCard 정책).
    onChange({
      orgSlug: nextSlug,
      schoolProfileApplied: nextSlug !== null,
      // 조직이 바뀌면 이전 조직의 참조 이미지 선택은 무효 → 상위에서 이미 null 넘어옴
    });
  }

  const canSubmit = !disabled && issueMessage === null;

  return (
    <section className="card flex h-full flex-col gap-4 p-5">
      <header className="flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          2
        </span>
        <h3 className="text-base font-semibold">생성 옵션</h3>
      </header>

      {/* 상단 요약: 개인 또는 조직 참조 이미지가 선택되어 있으면 /generate 와
          동일한 카드 UI 로 노출. 두 종류는 상호배제라 동시 렌더되지 않음. */}
      {selectedPersonalSlot && (
        <SelectedReferenceCard
          thumbnailUrl={selectedPersonalSlot.url}
          label="개인 참조 클립아트"
          description={selectedPersonalSlot.filename ?? '저장된 슬롯 이미지'}
          linkHref="/profile"
          linkLabel="슬롯 관리"
          onClear={() => handlePersonalReferenceChange(null)}
          disabled={disabled}
        />
      )}
      {selectedOrgSlot && (
        <SelectedReferenceCard
          thumbnailUrl={selectedOrgSlot.url}
          label="학교 참조 이미지"
          description={selectedOrgSlot.filename ?? '조직 슬롯 이미지'}
          linkHref={
            options.orgSlug
              ? `/organization/${options.orgSlug}/settings`
              : '/profile'
          }
          linkLabel="슬롯 관리"
          onClear={() => handleOrgReferenceIdChange(null)}
          disabled={disabled}
        />
      )}

      {/* 1. 생성 개수 */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label className="text-primary">생성 개수</Label>
          <span className="text-xs tabular-nums text-muted-foreground">
            <span className="font-semibold text-primary">{options.batchSize}</span>{' '}
            크레딧 사용
          </span>
        </div>
        <BatchSizeSelector
          value={options.batchSize}
          onChange={(nextSize) =>
            // batchSize 변경 시 slotPrompts 길이도 동시에 정합. OFF 상태여도
            // 입력값은 보존 (지시 §3).
            onChange({
              batchSize: nextSize,
              slotPrompts: resizeSlotPrompts(options.slotPrompts, nextSize),
            })
          }
          disabled={disabled}
          variant="compact"
          visiblePresets={V2_VISIBLE_PRESETS}
        />
      </div>

      {/* 2. 이미지 비율 */}
      <div className="space-y-2">
        <Label className="text-primary">클립아트 비율</Label>
        <AspectRatioSelector
          value={options.aspectRatio}
          onChange={(next) => onChange({ aspectRatio: next })}
          disabled={disabled}
          variant="compact"
        />
      </div>

      {/* 3. 개인 참조 이미지 */}
      <OptionReferencePicker
        value={personalReferenceId}
        onChange={handlePersonalReferenceChange}
        disabled={disabled}
        orgReferenceActive={orgReferenceActive}
      />

      {/* 4. 학교 설정 */}
      <OptionSchoolPicker
        orgSlug={options.orgSlug}
        orgReferenceId={orgReferenceId}
        disabled={disabled}
        personalReferenceActive={personalActive}
        onOrgSlugChange={handleOrgSlugChange}
        onOrgReferenceIdChange={handleOrgReferenceIdChange}
      />

      {/* 5 + 6. 하단 안내 + CTA (locked 이면 CTA 숨김).
          다양성 생성은 시안에 따라 PromptStep (AI 추천 하단) 으로 이동. */}
      {!locked && (
        <div className="mt-auto space-y-2 pt-1">
          {issueMessage && (
            <p
              role="status"
              aria-live="polite"
              className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-200"
            >
              {issueMessage}
            </p>
          )}
          <Button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="min-h-[44px] w-full"
          >
            <Sparkles className="mr-1 h-4 w-4" />
            {submitting ? '클립아트 생성 요청 중…' : '클립아트 만들기'}
          </Button>
        </div>
      )}
    </section>
  );
}
