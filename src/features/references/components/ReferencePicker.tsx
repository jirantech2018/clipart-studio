'use client';

// 참조 이미지 선택 UI — GenerationForm에 마운트되어 저장된 슬롯 중 하나를 고르게 한다.
// 슬롯이 비어 있으면 설정 페이지로 유도한다.

import { LinkIcon } from 'lucide-react';
import Link from 'next/link';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useReferenceImages } from '@/features/references/hooks/useReferenceImages';

interface ReferencePickerProps {
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}

export function ReferencePicker({ value, onChange, disabled }: ReferencePickerProps) {
  const { data, isLoading } = useReferenceImages();
  const slots = data?.slots ?? [];

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Label>참조 이미지 (선택)</Label>
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square animate-pulse rounded-md bg-muted"
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="space-y-2">
        <Label>참조 이미지 (선택)</Label>
        <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
          저장된 참조 이미지가 없어요.{' '}
          <Link href="/settings" className="text-primary underline-offset-4 hover:underline">
            설정에서 추가하기 →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1">
          <LinkIcon className="h-3 w-3" />
          참조 이미지 (선택)
        </Label>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            선택 해제
          </button>
        )}
      </div>
      <div className="grid grid-cols-5 gap-2">
        {slots.map((slot) => {
          const active = value === slot.id;
          return (
            <button
              key={slot.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(active ? null : slot.id)}
              aria-pressed={active}
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
      <p className="text-sm text-muted-foreground">
        선택하면 프롬프트와 함께 이미지를 참조해 생성해요.{' '}
        <Link href="/settings" className="underline-offset-4 hover:underline">
          슬롯 관리
        </Link>
      </p>
    </div>
  );
}
