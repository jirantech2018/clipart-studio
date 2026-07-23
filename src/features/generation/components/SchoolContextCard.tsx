'use client';

// 학교 설정 적용 카드 — 폼 아래에 개인 참조 이미지 카드와 별도로 놓인다.
// 헤더 우측 드롭다운으로 "개인" 또는 내가 속한 조직을 선택하고, 조직을
// 선택하면 그 조직 기본 프롬프트 일부와 조직 참조 이미지 (선택) 를 body 에
// 인라인으로 노출한다. URL `?org=<slug>` 로 상태를 저장 (bookmark 대응).

import { Building2, School } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useOrganizationReferenceImages } from '@/features/organization/hooks/useOrganizationReferenceImages';
import { useMyOrganizations } from '@/features/organization/hooks/useOrganizations';
import { useOrgReferenceStore } from '@/lib/store/orgReferenceStore';
import { useReferenceStore } from '@/lib/store/referenceStore';
import { useSchoolApplyStore } from '@/lib/store/schoolApplyStore';
import { cn } from '@/lib/utils';
import { SCHOOL_LEVEL_LABELS } from '@/types/domain';

import type { OrgGenerationContext } from '@/app/(main)/generate/page';

interface Props {
  orgContext: OrgGenerationContext | null;
}

const NONE_KEY = '__none__';

export function SchoolContextCard({ orgContext }: Props) {
  const router = useRouter();
  const { data: orgListData, isLoading: orgsLoading } = useMyOrganizations();
  const orgs = orgListData?.organizations ?? [];

  const isOrg = !!orgContext;
  const currentValue = orgContext?.slug ?? NONE_KEY;

  const orgRefs = useOrganizationReferenceImages(orgContext?.slug ?? null);
  const orgReferenceId = useOrgReferenceStore((s) => s.selectedOrgReferenceId);
  const selectOrgReference = useOrgReferenceStore((s) => s.select);
  const clearOrgReference = useOrgReferenceStore((s) => s.clear);
  const clearCustomReference = useReferenceStore((s) => s.clear);

  // 조직 참조를 새로 선택하면 개인 참조는 자동 해제 (상호 배타).
  function toggleOrgReference(id: string) {
    const active = orgReferenceId === id;
    if (active) {
      selectOrgReference(null);
    } else {
      clearCustomReference();
      selectOrgReference(id);
    }
  }

  // 조직 선택 자체가 "학교 설정 적용" 을 의미. 별도 토글 없음 — 사용자가
  // 조직을 선택하면 자동 true, "설정 안 함" 이면 false.
  const setApplied = useSchoolApplyStore((s) => s.set);

  useEffect(() => {
    setApplied(isOrg);
    if (!isOrg) clearOrgReference();
  }, [isOrg, setApplied, clearOrgReference]);

  function onDropdownChange(next: string) {
    if (next === currentValue) return;
    if (next === NONE_KEY) {
      router.replace('/generate');
    } else {
      router.replace(`/generate?org=${next}`);
    }
    router.refresh();
  }

  // 표시할 소스가 하나도 없으면 (조직 소속 없음) 카드 자체를 노출하지 않는다.
  if (orgs.length === 0 && !isOrg) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <School className="h-4 w-4" />
            학교 설정 적용
          </CardTitle>
          <select
            value={currentValue}
            onChange={(e) => onDropdownChange(e.target.value)}
            disabled={orgsLoading}
            className="h-9 max-w-[14rem] rounded-md border border-input bg-background px-2 text-xs"
            aria-label="학교 설정 소스 선택"
          >
            <option value={NONE_KEY}>설정 안 함</option>
            {orgs.map((org) => (
              <option key={org.slug} value={org.slug}>
                {org.name}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {isOrg && orgContext ? (
          <>
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <div className="flex items-center gap-2">
                <Building2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                <span className="font-medium">{orgContext.name}</span>
                {orgContext.schoolLevel && (
                  <span className="text-muted-foreground">
                    · {SCHOOL_LEVEL_LABELS[orgContext.schoolLevel]}
                  </span>
                )}
                <Link
                  href={`/organization/${orgContext.slug}/settings`}
                  className="ml-auto text-[10px] text-primary underline-offset-4 hover:underline"
                >
                  조직 설정 열기 →
                </Link>
              </div>
              {orgContext.basePrompt ? (
                <div className="mt-2 space-y-1">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    기본 프롬프트
                  </div>
                  <p
                    className="line-clamp-3 rounded bg-background p-2 text-[11px] font-mono leading-snug text-foreground"
                    title={orgContext.basePrompt}
                  >
                    {orgContext.basePrompt}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  이 조직에 기본 프롬프트가 설정돼 있지 않아요.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">조직 참조 이미지 (선택)</span>
                <Link
                  href={`/organization/${orgContext.slug}/settings`}
                  className="text-[10px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  슬롯 관리
                </Link>
              </div>
              {orgRefs.isLoading ? (
                <div className="grid grid-cols-5 gap-1.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      className="aspect-square animate-pulse rounded bg-muted"
                      aria-hidden="true"
                    />
                  ))}
                </div>
              ) : (orgRefs.data?.references.length ?? 0) === 0 ? (
                <div className="rounded border border-dashed p-3 text-center text-[11px] text-muted-foreground">
                  조직 참조 이미지가 없어요.{' '}
                  <Link
                    href={`/organization/${orgContext.slug}/settings`}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    조직 설정에서 추가하기 →
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-5 gap-1.5">
                  {(orgRefs.data?.references ?? []).map((ref) => {
                    const active = orgReferenceId === ref.id;
                    return (
                      <button
                        key={ref.id}
                        type="button"
                        onClick={() => toggleOrgReference(ref.id)}
                        aria-pressed={active}
                        title={ref.filename ?? '참조 이미지'}
                        className={cn(
                          'group relative aspect-square overflow-hidden rounded border-2 bg-muted transition-all',
                          active
                            ? 'border-primary ring-2 ring-primary/30'
                            : 'border-transparent hover:border-muted-foreground/40',
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
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            학교 설정을 적용하지 않고 생성해요. 조직을 선택하면 그 조직의 기본
            프롬프트와 참조 이미지가 함께 적용됩니다.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
