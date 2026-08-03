'use client';

// v2 Option Panel 안에서 학교 설정 (조직 선택 + 조직 기본 프롬프트 요약 +
// 조직 참조 이미지 인라인) 을 compact 하게 노출한다.
//
// 재사용 대상 (지시 §1 "새로운 조직 조회 API·Store·Prompt 병합 규칙 금지"):
//   - useMyOrganizations       : 내가 속한 조직 목록
//   - useOrganization          : 선택된 조직 상세 (basePrompt, schoolLevel 등)
//   - useOrganizationReferenceImages : 조직 참조 이미지 슬롯
//   - SCHOOL_LEVEL_LABELS      : 학교급 라벨
//
// 상태 SoT 는 Conversation Block options (orgSlug / orgReferenceIds[0]).
// 이 컴포넌트는 전역 useSchoolApplyStore / useOrgReferenceStore /
// useReferenceStore 를 참조하지 않는다. 조직 선택 자체가 "학교 설정 적용" 을
// 의미하며 별도 토글은 없다 (기존 SchoolContextCard 정책 그대로).

import { Building2, School } from 'lucide-react';
import Link from 'next/link';

import { useOrganization, useMyOrganizations } from '@/features/organization/hooks/useOrganizations';
import { useOrganizationReferenceImages } from '@/features/organization/hooks/useOrganizationReferenceImages';
import { cn } from '@/lib/utils';
import { SCHOOL_LEVEL_LABELS } from '@/types/domain';

interface Props {
  orgSlug: string | null;
  orgReferenceId: string | null;
  disabled: boolean;
  /** 개인 참조가 이미 적용 중이면 조직 참조는 상호배제로 선택 불가. */
  personalReferenceActive: boolean;
  onOrgSlugChange: (slug: string | null) => void;
  onOrgReferenceIdChange: (id: string | null) => void;
}

const NONE_KEY = '__none__';

export function OptionSchoolPicker({
  orgSlug,
  orgReferenceId,
  disabled,
  personalReferenceActive,
  onOrgSlugChange,
  onOrgReferenceIdChange,
}: Props) {
  const orgList = useMyOrganizations();
  const orgs = orgList.data?.organizations ?? [];
  const org = useOrganization(orgSlug);
  const orgRefs = useOrganizationReferenceImages(orgSlug);

  // 소속 조직이 하나도 없고 현재 선택된 것도 없으면 카드 자체를 노출하지
  // 않는다 (기존 SchoolContextCard 동작 유지).
  if (orgs.length === 0 && !orgSlug) return null;

  const selectedOrg = org.data?.organization;
  const currentValue = orgSlug ?? NONE_KEY;
  const orgRefList = orgRefs.data?.references ?? [];
  const orgRefCount = orgRefList.length;
  const orgRefDisabled = disabled || personalReferenceActive;

  function handleSlugChange(next: string) {
    if (next === currentValue) return;
    // 조직이 바뀌면 이전 조직의 참조 이미지 선택은 무효.
    onOrgReferenceIdChange(null);
    onOrgSlugChange(next === NONE_KEY ? null : next);
  }

  function handleOrgRefToggle(id: string) {
    if (orgRefDisabled) return;
    onOrgReferenceIdChange(orgReferenceId === id ? null : id);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <School className="h-3.5 w-3.5" aria-hidden="true" />
          <span>학교별 프롬프트 및 클립아트</span>
        </div>
        <select
          value={currentValue}
          disabled={disabled || orgList.isLoading}
          onChange={(e) => handleSlugChange(e.target.value)}
          className={cn(
            'h-8 max-w-[10rem] rounded-md border border-input bg-background px-2 text-xs',
            (disabled || orgList.isLoading) && 'cursor-not-allowed opacity-50',
          )}
          aria-label="학교별 프롬프트 및 클립아트 소스"
        >
          <option value={NONE_KEY}>설정 안 함</option>
          {orgs.map((o) => (
            <option key={o.slug} value={o.slug}>
              {o.name}
            </option>
          ))}
        </select>
      </div>

      {selectedOrg && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-2 text-xs">
          <div className="flex items-center gap-1.5">
            <Building2 className="h-3 w-3 text-primary" aria-hidden="true" />
            <span className="font-medium">{selectedOrg.name}</span>
            {selectedOrg.schoolLevel && (
              <span className="text-muted-foreground">
                · {SCHOOL_LEVEL_LABELS[selectedOrg.schoolLevel]}
              </span>
            )}
            <Link
              href={`/organization/${selectedOrg.slug}/settings`}
              className="ml-auto text-primary underline-offset-4 hover:underline"
            >
              조직 설정 →
            </Link>
          </div>

          <p className="text-muted-foreground">
            {selectedOrg.basePrompt
              ? '학교 기본 프롬프트가 자동 적용됩니다.'
              : '이 조직에 기본 프롬프트가 설정돼 있지 않습니다.'}
          </p>

          {orgRefCount > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>조직 참조 이미지 ({orgRefCount})</span>
              </div>
              <div className="grid grid-cols-5 gap-1">
                {orgRefList.slice(0, 5).map((ref) => {
                  const active = orgReferenceId === ref.id;
                  return (
                    <button
                      key={ref.id}
                      type="button"
                      disabled={orgRefDisabled}
                      onClick={() => handleOrgRefToggle(ref.id)}
                      aria-pressed={active}
                      title={ref.filename ?? '조직 참조 이미지'}
                      className={cn(
                        'aspect-square overflow-hidden rounded border-2 bg-muted transition-all',
                        active
                          ? 'border-primary ring-2 ring-primary/30'
                          : 'border-transparent hover:border-muted-foreground/40',
                        orgRefDisabled && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={ref.url}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  );
                })}
              </div>
              {personalReferenceActive && (
                <p className="text-muted-foreground">
                  개인 참조 클립아트가 적용 중이어서 학교 참조 이미지는 선택할 수 없어요.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
