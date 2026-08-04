'use client';

// v2 Option Panel 안에서 개인 참조 이미지 슬롯을 노출하는 compact wrapper.
//
// 실제 슬롯 조회/렌더/선택 동작은 전부 기존 ReferenceLibrarySection 의
// Controlled 모드 (variant='compact') 에 위임한다.
//
// 상호배제 정책은 클릭 시 상위 (OptionStep) 의 handlePersonalReferenceChange
// 가 조직 참조 / chaining 을 clear 하는 방식으로 처리하므로, 이 컴포넌트에서
// 는 별도의 disabled/안내 문구 없이 항상 슬롯을 선택 가능한 상태로 노출한다.

import { ImageIcon } from 'lucide-react';
import Link from 'next/link';

import { ReferenceLibrarySection } from '@/features/references/components/ReferenceLibrarySection';

interface Props {
  value: string | null;
  onChange: (next: string | null) => void;
  disabled: boolean;
}

export function OptionReferencePicker({ value, onChange, disabled }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium text-primary">
          <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
          <span>개인 참조 클립아트</span>
          <span className="text-xs font-normal text-muted-foreground">
            (선택)
          </span>
        </div>
        <Link
          href="/profile"
          className="text-xs text-primary underline-offset-4 hover:underline"
        >
          개인 설정 →
        </Link>
      </div>

      <ReferenceLibrarySection
        value={value}
        onChange={onChange}
        disabled={disabled}
        variant="compact"
      />
    </div>
  );
}
