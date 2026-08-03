'use client';

// /generate 페이지 하단에 놓이는 별도 카드. AI 이미지 만들기 폼과 시각적으로
// 분리해 저장된 참조 이미지 슬롯을 관리/선택하도록 한다.
//
// Controlled / Uncontrolled 두 모드를 지원한다.
//   Controlled   : value + onChange 를 부모가 소유. 전역 store 미참조.
//                  개인/조직 참조의 상호배제는 부모(예: /generate-v2
//                  Conversation Block) 책임.
//   Uncontrolled : props 미전달. 기존 /generate 처럼 useReferenceStore /
//                  useOrgReferenceStore / useGenerationStore.streamStatus 를
//                  fallback 으로 사용하며, 개인 참조 선택 시 조직 참조를
//                  자동 해제한다 (기존 동작 보존).
//
// TypeScript discriminated union 으로 부분 controlled (value 만 or onChange
// 만) 는 컴파일 단계에서 차단된다.

import { LinkIcon } from 'lucide-react';
import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useReferenceImages } from '@/features/references/hooks/useReferenceImages';
import { useGenerationStore } from '@/lib/store/generationStore';
import { useOrgReferenceStore } from '@/lib/store/orgReferenceStore';
import { useReferenceStore } from '@/lib/store/referenceStore';
import { cn } from '@/lib/utils';

type ControlledReferenceLibrarySectionProps = {
  value: string | null;
  onChange: (nextId: string | null) => void;
  disabled?: boolean;
  variant?: 'default' | 'compact';
};

type UncontrolledReferenceLibrarySectionProps = {
  value?: never;
  onChange?: never;
  disabled?: boolean;
  variant?: 'default' | 'compact';
};

export type ReferenceLibrarySectionProps =
  | ControlledReferenceLibrarySectionProps
  | UncontrolledReferenceLibrarySectionProps;

function isControlled(
  p: ReferenceLibrarySectionProps,
): p is ControlledReferenceLibrarySectionProps {
  return typeof p.onChange === 'function';
}

export function ReferenceLibrarySection(props: ReferenceLibrarySectionProps) {
  const { data, isLoading } = useReferenceImages();

  // React hooks 규칙상 top-level 무조건 호출. Controlled 모드에서는 아래
  // 분기에서 값을 사용하지 않는다 (전역 store read/write 없음).
  const storeSelectedId = useReferenceStore((s) => s.selectedReferenceId);
  const storeSelect = useReferenceStore((s) => s.select);
  const clearOrgReference = useOrgReferenceStore((s) => s.clear);
  const streamStatus = useGenerationStore((s) => s.streamStatus);

  const controlled = isControlled(props);
  const selectedReferenceId = controlled ? props.value : storeSelectedId;
  const inFlight = streamStatus === 'starting' || streamStatus === 'streaming';
  // disabled 우선순위: props.disabled > (controlled ? false : inFlight)
  const disabled = props.disabled ?? (controlled ? false : inFlight);
  const compact = props.variant === 'compact';

  function toggleSelect(id: string) {
    const active = selectedReferenceId === id;
    const nextId = active ? null : id;

    if (controlled) {
      props.onChange(nextId);
      return;
    }

    // Uncontrolled fallback: 개인 참조 새로 선택 시 조직 참조는 해제해
    // 상단에 하나만 뜨도록 한다 (기존 /generate 동작 보존).
    if (nextId !== null) {
      clearOrgReference();
    }
    storeSelect(nextId);
  }

  const slots = data?.slots ?? [];

  const grid = isLoading ? (
    <div className={cn('grid grid-cols-5', compact ? 'gap-1.5' : 'gap-2')}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="aspect-square animate-pulse rounded-md bg-muted"
          aria-hidden="true"
        />
      ))}
    </div>
  ) : slots.length === 0 ? (
    <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
      저장된 참조 이미지가 없어요.{' '}
      <Link href="/settings" className="text-primary underline-offset-4 hover:underline">
        설정에서 추가하기 →
      </Link>
    </div>
  ) : (
    <div className={cn('grid grid-cols-5', compact ? 'gap-1.5' : 'gap-2')}>
      {slots.map((slot) => {
        const active = selectedReferenceId === slot.id;
        return (
          <button
            key={slot.id}
            type="button"
            disabled={disabled}
            onClick={() => toggleSelect(slot.id)}
            aria-pressed={active}
            title={slot.filename ?? '참조 이미지'}
            className={cn(
              'group relative aspect-square overflow-hidden rounded-md border-2 bg-muted transition-all',
              active
                ? 'border-primary ring-2 ring-primary/30'
                : 'border-transparent hover:border-muted-foreground/40',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slot.url}
              alt={slot.filename ?? '참조 이미지'}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </button>
        );
      })}
    </div>
  );

  // compact variant: v2 Option Panel 안에서 재사용될 때는 자체 Card/헤더/안내
  // 문구를 벗기고 슬롯 그리드만 노출한다. 라벨과 상호배제 안내는 상위
  // OptionReferencePicker 가 담당.
  if (compact) {
    return <div className="space-y-2">{grid}</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LinkIcon className="h-4 w-4" />
          개인 참조 클립아트 (선택)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {grid}
        <p className="text-sm text-muted-foreground">
          이미지를 클릭하면 위의 AI 이미지 만들기 폼에 참조 이미지로 지정돼요.{' '}
          <Link href="/profile" className="underline-offset-4 hover:underline">
            슬롯 관리
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
