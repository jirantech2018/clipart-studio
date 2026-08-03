'use client';

// v2 Option Panel 안에서 개인 참조 이미지 슬롯을 노출하는 compact wrapper.
//
// 실제 슬롯 조회/렌더/선택 동작은 전부 기존 ReferenceLibrarySection 의
// Controlled 모드 (variant='compact') 에 위임한다. 이 컴포넌트는
//   - 라벨과 선택 카운트
//   - 개인/조직 참조 상호배제 안내
//   - Conversation Block options 에 값 전달
// 만 담당한다. 참조 이미지 조회/권한/오류 등을 복제하지 않는다.

import { ImageIcon } from 'lucide-react';

import { ReferenceLibrarySection } from '@/features/references/components/ReferenceLibrarySection';
import { cn } from '@/lib/utils';

interface Props {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled: boolean;
  /** 학교(조직) 참조가 이미 적용 중이면 개인 참조는 상호배제로 사용 불가. */
  orgReferenceActive: boolean;
}

export function OptionReferencePicker({
  value,
  onChange,
  disabled,
  orgReferenceActive,
}: Props) {
  const effectiveDisabled = disabled || orgReferenceActive;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
          <span>개인 참조 이미지</span>
        </div>
        {value && !orgReferenceActive && (
          <span className="text-xs text-muted-foreground">1장 선택됨</span>
        )}
      </div>

      <div className={cn(orgReferenceActive && 'opacity-60')}>
        <ReferenceLibrarySection
          value={orgReferenceActive ? null : value}
          onChange={onChange}
          disabled={effectiveDisabled}
          variant="compact"
        />
      </div>

      {orgReferenceActive ? (
        <p className="text-xs text-muted-foreground">
          학교 참조 이미지가 적용 중이어서 개인 참조 이미지를 사용할 수 없어요.
        </p>
      ) : value === null ? (
        <p className="text-xs text-muted-foreground">
          개인 참조 이미지를 선택하면 학교 참조 이미지 적용이 해제돼요.
        </p>
      ) : null}
    </div>
  );
}
