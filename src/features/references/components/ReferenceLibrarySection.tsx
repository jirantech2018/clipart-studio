'use client';

// /generate 페이지 하단에 놓이는 별도 카드. AI 이미지 만들기 폼과 시각적으로
// 분리해 저장된 참조 이미지 슬롯을 관리/선택하도록 한다. 선택 상태는
// referenceStore 를 통해 폼과 공유되며, 선택된 슬롯은 폼 상단에
// chaining 카드와 동일한 스타일로 노출된다.

import { LinkIcon } from 'lucide-react';
import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useReferenceImages } from '@/features/references/hooks/useReferenceImages';
import { useReferenceStore } from '@/lib/store/referenceStore';
import { useGenerationStore } from '@/lib/store/generationStore';
import { cn } from '@/lib/utils';

export function ReferenceLibrarySection() {
  const { data, isLoading } = useReferenceImages();
  const selectedReferenceId = useReferenceStore((s) => s.selectedReferenceId);
  const select = useReferenceStore((s) => s.select);
  const streamStatus = useGenerationStore((s) => s.streamStatus);
  const inFlight = streamStatus === 'starting' || streamStatus === 'streaming';

  const slots = data?.slots ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LinkIcon className="h-4 w-4" />
          참조 이미지 (선택)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="grid grid-cols-5 gap-2">
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
          <div className="grid grid-cols-5 gap-2">
            {slots.map((slot) => {
              const active = selectedReferenceId === slot.id;
              return (
                <button
                  key={slot.id}
                  type="button"
                  disabled={inFlight}
                  onClick={() => select(active ? null : slot.id)}
                  aria-pressed={active}
                  title={slot.filename ?? '참조 이미지'}
                  className={cn(
                    'group relative aspect-square overflow-hidden rounded-md border-2 bg-muted transition-all',
                    active
                      ? 'border-primary ring-2 ring-primary/30'
                      : 'border-transparent hover:border-muted-foreground/40',
                    inFlight && 'cursor-not-allowed opacity-50',
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
        )}

        <p className="text-[11px] text-muted-foreground">
          이미지를 클릭하면 위의 AI 이미지 만들기 폼에 참조 이미지로 지정돼요.{' '}
          <Link href="/settings" className="underline-offset-4 hover:underline">
            슬롯 관리
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
