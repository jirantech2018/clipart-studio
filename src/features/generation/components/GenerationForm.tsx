'use client';

// Design Ref: §5.4 Generation Page checklist — prompt, batch size, diversity, school toggle, submit
// Optional parent prop switches this form into chaining (i2i) mode:
//   - reference thumbnail is shown
//   - prompt is pre-filled from the parent
//   - PresetChips are rendered
//   - generationMode = 'img2img', referenceImageId is passed to the job

import { Building2, Link as LinkIcon, Loader2, Sparkles, User, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PresetChips } from '@/features/generation/components/PresetChips';
import { useCreateJob, CreateJobError } from '@/features/generation/hooks/useCreateJob';
import { usePromptSuggestions } from '@/features/generation/hooks/usePromptSuggestions';
import { SchoolStyleToggle } from '@/features/generation/components/SchoolStyleToggle';
import { useOrganizationReferenceImages } from '@/features/organization/hooks/useOrganizationReferenceImages';
import { useMyOrganizations } from '@/features/organization/hooks/useOrganizations';
import { useReferenceImages } from '@/features/references/hooks/useReferenceImages';
import { useAuthStore } from '@/lib/store/authStore';
import { useGenerationDraftStore } from '@/lib/store/generationDraftStore';
import { useGenerationStore } from '@/lib/store/generationStore';
import { useOrgReferenceStore } from '@/lib/store/orgReferenceStore';
import { useReferenceStore } from '@/lib/store/referenceStore';
import { cn } from '@/lib/utils';
import { SCHOOL_LEVEL_LABELS } from '@/types/domain';

import type { OrgGenerationContext } from '@/app/(main)/generate/page';
import {
  ASPECT_RATIOS,
  ASPECT_RATIO_DIMENSIONS,
  ASPECT_RATIO_LABELS,
  BATCH_SIZE_PRESETS,
  MAX_BATCH_SIZE,
  MIN_BATCH_SIZE,
} from '@/types/domain';
import { createJobSchema } from '@/types/schemas';

import type { AspectRatio } from '@/types/domain';
import type { ChangeEvent, FormEvent } from 'react';

interface ParentInfo {
  id: string;
  prompt: string;
  thumbnailUrl: string;
}

interface GenerationFormProps {
  hasSchoolProfile: boolean;
  schoolName: string | null;
  initialCredits: number;
  creditsResetAt?: string | null;
  parent?: ParentInfo | null;
  /** P5-D-C: /generate?org=<slug> 로 진입한 조직 컨텍스트. 없으면 개인 컨텍스트. */
  orgContext?: OrgGenerationContext | null;
  /** 조직 slug 는 존재하지만 접근 권한이 없거나 삭제된 경우 표시할 안내. */
  orgAccessError?: string | null;
}

function formatResetDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
  });
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (24 * 3_600_000));
}

export function GenerationForm({
  hasSchoolProfile,
  schoolName,
  initialCredits,
  creditsResetAt,
  parent,
  orgContext,
  orgAccessError,
}: GenerationFormProps) {
  const router = useRouter();
  const storeCredits = useAuthStore((s) => s.profile?.credits);
  const credits = storeCredits ?? initialCredits;
  const streamStatus = useGenerationStore((s) => s.streamStatus);
  const inFlight = streamStatus === 'starting' || streamStatus === 'streaming';

  const chaining = !!parent;
  const isOrgContext = !!orgContext;

  const [prompt, setPrompt] = useState<string>(parent?.prompt ?? '');
  const [batchSize, setBatchSize] = useState<number>(5);
  // 조직 컨텍스트일 때는 조직의 style_enabled 기본값을 반영. 개인 컨텍스트는
  // 기존 hasSchoolProfile 동작 그대로.
  const [schoolProfileApplied, setSchoolProfileApplied] = useState(
    isOrgContext ? orgContext.styleEnabled : hasSchoolProfile,
  );
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('square');

  // 참조 이미지 스토어 — 개인/조직 별도. 조직 컨텍스트에서는 개인 슬롯 선택
  // 상태를 무시하고 조직 스토어만 참조 (사용자 명세: 자동 mix 금지).
  const customReferenceId = useReferenceStore((s) => s.selectedReferenceId);
  const clearCustomReference = useReferenceStore((s) => s.clear);
  const orgReferenceId = useOrgReferenceStore((s) => s.selectedOrgReferenceId);
  const clearOrgReference = useOrgReferenceStore((s) => s.clear);
  const { data: referenceData } = useReferenceImages();
  const { data: orgReferenceData } = useOrganizationReferenceImages(
    isOrgContext ? orgContext.slug : null,
  );
  const selectedReference = chaining
    ? null
    : isOrgContext
      ? orgReferenceId
        ? orgReferenceData?.references.find((r) => r.id === orgReferenceId) ?? null
        : null
      : customReferenceId
        ? referenceData?.slots.find((s) => s.id === customReferenceId) ?? null
        : null;

  // 컨텍스트 스위칭 시 반대 스토어 초기화 — 개인/조직 자동 mix 방지 안전장치.
  useEffect(() => {
    if (isOrgContext) {
      clearCustomReference();
    } else {
      clearOrgReference();
    }
  }, [isOrgContext, clearCustomReference, clearOrgReference]);

  // 우측 BatchProgressPanel 이 idle 상태에서도 빈 슬롯을 미리 그리도록,
  // 배치 크기/이미지 비율이 바뀌면 draft store 로 push.
  const setDraftBatchSize = useGenerationDraftStore((s) => s.setBatchSize);
  const setDraftAspectRatio = useGenerationDraftStore((s) => s.setAspectRatio);
  useEffect(() => {
    setDraftBatchSize(batchSize);
  }, [batchSize, setDraftBatchSize]);
  useEffect(() => {
    setDraftAspectRatio(aspectRatio);
  }, [aspectRatio, setDraftAspectRatio]);

  // 프롬프트 기반 AI 추천 힌트 (debounce 800ms). 프롬프트가 짧으면 서버가
  // 하드코딩 fallback 5개를 즉시 돌려주므로 언제나 chip 은 표시된다.
  const suggestionQuery = usePromptSuggestions(prompt);
  const suggestionHints = suggestionQuery.data?.suggestions ?? [];

  const createJob = useCreateJob();

  const insufficient = credits < batchSize;
  const disabled = inFlight || insufficient || !prompt.trim() || createJob.isPending;

  async function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // 조직 컨텍스트일 때는 개인 customReferenceId 대신 orgReferenceId 를 사용.
    // 서버 계약(P5-D-C 다음 슬라이스)에서 orgSlug / orgReferenceId 를 정식으로
    // 소비하기 전까지는, 우선 기존 customReferenceId 자리로 orgReferenceId 를
    // 보내지 않고 null 을 넘긴다 (개인 리소스와 충돌 방지). 즉 지금은 프롬프트
    // + 조직 컨텍스트 배지만 클라이언트에 반영되며, 실제 조직 참조 이미지
    // 파이프라인은 다음 세션에서 연결.
    const effectiveCustomRef = chaining || isOrgContext ? null : customReferenceId;
    const parsed = createJobSchema.safeParse({
      prompt,
      batchSize,
      diversityLevel: 0,
      referenceImageId: parent?.id ?? null,
      customReferenceId: effectiveCustomRef,
      schoolProfileApplied,
      generationMode: chaining || effectiveCustomRef ? 'img2img' : 'text2img',
      aspectRatio,
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(first?.message ?? '입력값을 확인해주세요');
      return;
    }

    try {
      await createJob.mutateAsync(parsed.data);
    } catch (err) {
      if (err instanceof CreateJobError) {
        if (err.code === 'INSUFFICIENT_CREDITS') {
          toast.error('크레딧이 부족합니다. 프로필 페이지에서 리셋일을 확인해주세요.');
        } else if (err.code === 'ACTIVE_JOB_EXISTS') {
          toast.error('이전 생성이 아직 진행 중입니다.');
        } else {
          toast.error(err.message);
        }
        return;
      }
      toast.error('요청 중 문제가 발생했습니다');
    }
  }

  function clearParent() {
    // Drop ?parent= from URL — server re-renders in plain text2img mode.
    router.replace('/generate');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {chaining ? <LinkIcon className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
          {chaining ? '이 이미지로 생성 (i2i)' : 'AI 이미지 만들기'}
        </CardTitle>
        {orgAccessError && (
          <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            {orgAccessError} 개인 컨텍스트로 자동 전환하지 않습니다 —{' '}
            <Link href="/generate" className="underline-offset-4 hover:underline">
              개인 생성으로 이동
            </Link>
          </p>
        )}
      </CardHeader>
      <CardContent>
        <form onSubmit={handleFormSubmit} className="space-y-5">
          {chaining && parent && (
            <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={parent.thumbnailUrl}
                alt="참조 이미지"
                className="h-16 w-16 shrink-0 rounded object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">참조 이미지</p>
                <p className="line-clamp-2 text-xs text-muted-foreground" title={parent.prompt}>
                  {parent.prompt}
                </p>
                <Link
                  href={`/image/${parent.id}`}
                  className="text-[10px] text-primary underline-offset-4 hover:underline"
                >
                  원본 상세 보기
                </Link>
              </div>
              <button
                type="button"
                onClick={clearParent}
                disabled={inFlight}
                className="rounded p-1 text-muted-foreground hover:bg-accent"
                aria-label="참조 이미지 해제"
                title="참조 이미지 해제"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {!chaining && selectedReference && (
            <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedReference.url}
                alt="참조 이미지"
                className="h-16 w-16 shrink-0 rounded object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">
                  {isOrgContext ? '조직 참조 이미지' : '참조 이미지'}
                </p>
                <p
                  className="line-clamp-2 text-xs text-muted-foreground"
                  title={selectedReference.filename ?? undefined}
                >
                  {selectedReference.filename ?? '저장된 슬롯 이미지'}
                </p>
                <Link
                  href={
                    isOrgContext && orgContext
                      ? `/organization/${orgContext.slug}/settings`
                      : '/profile'
                  }
                  className="text-[10px] text-primary underline-offset-4 hover:underline"
                >
                  슬롯 관리
                </Link>
              </div>
              <button
                type="button"
                onClick={isOrgContext ? clearOrgReference : clearCustomReference}
                disabled={inFlight}
                className="rounded p-1 text-muted-foreground hover:bg-accent"
                aria-label="참조 이미지 해제"
                title="참조 이미지 해제"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {insufficient && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-200">
              지금 배치({batchSize}장)를 만들 크레딧이 부족해요.{' '}
              {creditsResetAt && daysUntil(creditsResetAt) !== null ? (
                <>
                  <span className="font-semibold">
                    {formatResetDate(creditsResetAt)}
                  </span>
                  (D-{daysUntil(creditsResetAt)})에 30 크레딧이 다시 지급됩니다.
                </>
              ) : (
                <>다음 리셋 예정일은 프로필에서 확인할 수 있어요.</>
              )}
              {batchSize > 5 && ' 배치 크기를 5로 낮추면 지금 바로 생성할 수 있어요.'}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                생성 후
              </div>
              <div className="text-sm font-semibold tabular-nums">
                {Math.max(0, credits - batchSize)} 크레딧 남음
              </div>
            </div>
            <Button type="submit" disabled={disabled} className="min-w-[10rem]">
              {inFlight
                ? '생성 중…'
                : insufficient
                  ? '크레딧 부족'
                  : '이미지 만들기'}
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="batchSize">몇 장 만들어 볼까요?</Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                <span className="font-semibold text-foreground">{batchSize}</span> 크레딧
                사용
              </span>
            </div>
            <div className="grid grid-cols-[repeat(4,1fr)_1.6fr] gap-1.5">
              {BATCH_SIZE_PRESETS.map((size) => (
                <button
                  key={size}
                  type="button"
                  disabled={inFlight}
                  onClick={() => setBatchSize(size)}
                  className={cn(
                    'h-9 rounded-md border text-sm font-medium transition-colors',
                    batchSize === size
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-background hover:bg-accent',
                    inFlight && 'cursor-not-allowed opacity-50',
                  )}
                >
                  {size}장
                </button>
              ))}
              <div className="relative">
                <input
                  id="batchSize"
                  type="number"
                  inputMode="numeric"
                  min={MIN_BATCH_SIZE}
                  max={MAX_BATCH_SIZE}
                  step={1}
                  disabled={inFlight}
                  value={batchSize}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    const raw = e.target.value;
                    if (raw === '') {
                      setBatchSize(MIN_BATCH_SIZE);
                      return;
                    }
                    const parsed = Number.parseInt(raw, 10);
                    if (Number.isNaN(parsed)) return;
                    setBatchSize(
                      Math.min(MAX_BATCH_SIZE, Math.max(MIN_BATCH_SIZE, parsed)),
                    );
                  }}
                  className={cn(
                    'h-9 w-full rounded-md border border-input bg-background px-3 pr-12 text-center text-sm font-medium',
                    // 브라우저 기본 number spinner 제거
                    '[appearance:textfield]',
                    '[&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none',
                    '[&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none',
                    'focus:outline-none focus:ring-2 focus:ring-primary/40',
                    inFlight && 'cursor-not-allowed opacity-50',
                  )}
                />
                <span
                  className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-muted-foreground/60"
                  aria-hidden="true"
                >
                  ~{MAX_BATCH_SIZE}장
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              여러 장을 만들수록 원하는 이미지를 찾기 쉬워집니다. 직접 입력해{' '}
              {MAX_BATCH_SIZE}장까지 만들 수 있어요.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prompt">프롬프트</Label>
            <Textarea
              id="prompt"
              rows={4}
              placeholder={'예: 운동장에서 뛰는 초등학생\n벚꽃 아래에서 책을 읽는 학생'}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={inFlight}
            />
            <div className="space-y-1.5 pt-1">
              <p className="text-xs text-muted-foreground">
                AI 추천 — 클릭해서 프롬프트에 변형 힌트를 덧붙여 보세요
              </p>
              <PresetChips
                hints={suggestionHints}
                loading={suggestionQuery.isLoading || suggestionQuery.isFetching}
                value={prompt}
                onChange={setPrompt}
                disabled={inFlight}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>이미지 비율</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {ASPECT_RATIOS.map((r) => {
                const dims = ASPECT_RATIO_DIMENSIONS[r];
                const previewRatio = `${dims.width} / ${dims.height}`;
                const active = aspectRatio === r;
                return (
                  <button
                    key={r}
                    type="button"
                    disabled={inFlight}
                    onClick={() => setAspectRatio(r)}
                    aria-pressed={active}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-md border py-2 text-xs font-medium transition-colors',
                      active
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-input bg-background text-muted-foreground hover:bg-accent',
                      inFlight && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <span
                      className={cn(
                        'w-6 rounded-sm border',
                        active
                          ? 'border-primary bg-primary/30'
                          : 'border-current bg-current/20',
                      )}
                      style={{ aspectRatio: previewRatio }}
                      aria-hidden="true"
                    />
                    <span>{ASPECT_RATIO_LABELS[r]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 학교 설정 적용 배너 — 개인 vs 조직 컨텍스트 스위칭 + 상세 요약 */}
          <SchoolContextBanner
            orgContext={orgContext}
            hasSchoolProfile={hasSchoolProfile}
            personalSchoolName={schoolName}
            checked={schoolProfileApplied}
            onCheckedChange={setSchoolProfileApplied}
          />

        </form>
      </CardContent>
    </Card>
  );
}

// ─── School Context Banner ─────────────────────────────────────────
// 학교 설정 소스 (개인 or 내가 속한 조직) 를 선택하고, 선택된 것의 학교
// 설정 요약 + 스타일 적용 토글 + (조직인 경우) 참조 이미지 슬롯을 인라인으로
// 노출한다. URL `?org=` 파라미터로 컨텍스트 상태를 저장 — 새로고침해도 유지.

function SchoolContextBanner({
  orgContext,
  hasSchoolProfile,
  personalSchoolName,
  checked,
  onCheckedChange,
}: {
  orgContext: OrgGenerationContext | null | undefined;
  hasSchoolProfile: boolean;
  personalSchoolName: string | null;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  const router = useRouter();
  const { data: orgListData, isLoading: orgsLoading } = useMyOrganizations();
  const orgs = orgListData?.organizations ?? [];
  const orgRefs = useOrganizationReferenceImages(orgContext?.slug ?? null);
  const orgReferenceId = useOrgReferenceStore((s) => s.selectedOrgReferenceId);
  const selectOrgReference = useOrgReferenceStore((s) => s.select);

  const isOrg = !!orgContext;
  const selectedSlug = orgContext?.slug ?? null;

  function switchTo(slug: string | null) {
    if (slug === selectedSlug) return;
    router.replace(slug ? `/generate?org=${slug}` : '/generate');
    router.refresh();
  }

  // 개인 컨텍스트에 개인 school_profile 조차 없으면 배너 자체 숨김 —
  // 조직도 없으면 표시할 소스가 하나도 없음.
  if (!isOrg && !hasSchoolProfile && orgs.length === 0) return null;

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">학교 설정 적용</div>
        <div className="text-[10px] text-muted-foreground">
          어느 학교 AI 설정을 쓸까요?
        </div>
      </div>

      {/* 소스 선택 pills — 개인 / 각 조직 */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => switchTo(null)}
          aria-pressed={!isOrg}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            !isOrg
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-input bg-background text-muted-foreground hover:bg-accent',
          )}
        >
          <User className="h-3 w-3" aria-hidden="true" />
          개인
        </button>
        {orgsLoading && orgs.length === 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            조직 목록…
          </span>
        )}
        {orgs.map((org) => {
          const active = org.slug === selectedSlug;
          return (
            <button
              key={org.slug}
              type="button"
              onClick={() => switchTo(org.slug)}
              aria-pressed={active}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background text-muted-foreground hover:bg-accent',
              )}
            >
              <Building2 className="h-3 w-3" aria-hidden="true" />
              {org.name}
            </button>
          );
        })}
      </div>

      {/* 선택된 소스 상세 */}
      {isOrg && orgContext ? (
        <div className="space-y-3 rounded-md bg-background p-3">
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">학교명</span>
              <span className="font-medium">{orgContext.name}</span>
            </div>
            {orgContext.schoolLevel && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">학교급</span>
                <span className="font-medium">
                  {SCHOOL_LEVEL_LABELS[orgContext.schoolLevel]}
                </span>
              </div>
            )}
            {orgContext.basePrompt && (
              <div className="space-y-0.5">
                <div className="text-muted-foreground">기본 프롬프트</div>
                <p
                  className="line-clamp-2 rounded bg-muted/40 p-1.5 text-[11px] font-mono text-foreground"
                  title={orgContext.basePrompt}
                >
                  {orgContext.basePrompt}
                </p>
              </div>
            )}
            <Link
              href={`/organization/${orgContext.slug}/settings`}
              className="text-[10px] text-primary underline-offset-4 hover:underline"
            >
              조직 설정 열기 →
            </Link>
          </div>

          <SchoolStyleToggle
            hasSchoolProfile
            schoolName={orgContext.name}
            checked={checked}
            onChange={onCheckedChange}
          />

          {/* 조직 참조 이미지 슬롯 인라인 */}
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
                      onClick={() => selectOrgReference(active ? null : ref.id)}
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
        </div>
      ) : (
        // 개인 컨텍스트 요약
        <div className="rounded-md bg-background p-3">
          <SchoolStyleToggle
            hasSchoolProfile={hasSchoolProfile}
            schoolName={personalSchoolName}
            checked={checked}
            onChange={onCheckedChange}
          />
          {!hasSchoolProfile && orgs.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              개인 학교 설정이 없어요. 위에서 조직을 선택하면 그 조직 AI 설정을 쓸 수 있어요.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
