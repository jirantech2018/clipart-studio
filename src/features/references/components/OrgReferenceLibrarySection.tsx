'use client';

// 조직 컨텍스트 (`/generate?org=<slug>`) 에서 노출되는 조직 참조 이미지
// 슬롯. 개인 ReferenceLibrarySection 과 동일 UX — 클릭으로 선택/해제.
// 선택 상태는 orgReferenceStore 로 GenerationForm 과 공유.

import { LinkIcon } from 'lucide-react';
import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useOrganizationReferenceImages } from '@/features/organization/hooks/useOrganizationReferenceImages';
import { useGenerationStore } from '@/lib/store/generationStore';
import { useOrgReferenceStore } from '@/lib/store/orgReferenceStore';
import { cn } from '@/lib/utils';

export function OrgReferenceLibrarySection({
  slug,
  orgName,
}: {
  slug: string;
  orgName: string;
}) {
  const { data, isLoading } = useOrganizationReferenceImages(slug);
  const selectedOrgReferenceId = useOrgReferenceStore((s) => s.selectedOrgReferenceId);
  const select = useOrgReferenceStore((s) => s.select);
  const streamStatus = useGenerationStore((s) => s.streamStatus);
  const inFlight = streamStatus === 'starting' || streamStatus === 'streaming';

  const items = data?.references ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LinkIcon className="h-4 w-4" />
          조직 참조 이미지 (선택)
          <span className="text-xs font-normal text-muted-foreground">— {orgName}</span>
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
        ) : items.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
            이 조직에 등록된 참조 이미지가 없어요.{' '}
            <Link
              href={`/organization/${slug}/settings`}
              className="text-primary underline-offset-4 hover:underline"
            >
              조직 설정에서 추가하기 →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-2">
            {items.map((ref) => {
              const active = selectedOrgReferenceId === ref.id;
              return (
                <button
                  key={ref.id}
                  type="button"
                  disabled={inFlight}
                  onClick={() => select(active ? null : ref.id)}
                  aria-pressed={active}
                  title={ref.filename ?? '참조 이미지'}
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
                    src={ref.url}
                    alt={ref.filename ?? '참조 이미지'}
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
          <Link
            href={`/organization/${slug}/settings`}
            className="underline-offset-4 hover:underline"
          >
            슬롯 관리
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
