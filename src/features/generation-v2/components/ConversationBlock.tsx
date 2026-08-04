'use client';

// Conversation 안의 개별 Block 오케스트레이터.
// 상태(status) + packageMode 조합에 따라 상단 카드 두 장을 조합해 렌더한다.
//
//   packageMode=false, draft      → PromptStep + OptionStep
//   packageMode=true,  draft      → PackagePromptCard + PackageOptionCard
//   queued/generating             → GeneratingStep (AI 응답 카드)
//   completed / failed / unknown  → 각 응답 카드
//
// Phase 2: packageMode 도 실제 파이프라인에 연결됨. PackageOptionCard 의 CTA
// 는 canSubmitPackage + credit 여유 + activeJob 없음을 만족하면 submitPackage
// 로 /api/jobs (kind='package') 호출 후 useConversationJobStream 이 SSE 를
// 구독한다.

import { AlertTriangle, HelpCircle } from 'lucide-react';
import { forwardRef, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { AiResponseBubble } from '@/features/generation-v2/components/AiResponseBubble';
import { CompletedStep } from '@/features/generation-v2/components/CompletedStep';
import { GeneratingStep } from '@/features/generation-v2/components/GeneratingStep';
import { OptionStep } from '@/features/generation-v2/components/OptionStep';
import { PackageOptionCard } from '@/features/generation-v2/components/PackageOptionCard';
import { PackagePromptCard } from '@/features/generation-v2/components/PackagePromptCard';
import { PromptStep } from '@/features/generation-v2/components/PromptStep';
import { useConversationJobStream } from '@/features/generation-v2/hooks/useConversationJobStream';
import { usePackageJobRehydrate } from '@/features/generation-v2/hooks/usePackageJobRehydrate';
import { usePackagePlan } from '@/features/generation-v2/hooks/usePackagePlan';
import { mergePackagePlan } from '@/features/generation-v2/lib/mergePackagePlan';
import {
  PackageSubmitError,
  canSubmitPackage,
  computePackageTotalSlots,
  submitPackage,
} from '@/features/generation-v2/lib/packageSubmit';
import {
  messageForIssue,
  validateBlockSubmission,
} from '@/features/generation-v2/lib/validateBlockSubmission';
import { useConversationStore } from '@/lib/store/conversationStore';
import { createJobSchema } from '@/types/schemas';

import type { Block, BlockOptions } from '@/lib/store/conversationStore';

interface ConversationBlockProps {
  block: Block;
  convId: string;
  isLast: boolean;
  activeJobExists: boolean;
  credits: number;
  onFirstGenerationStart: (prompt: string) => void;
}

interface CreateJobResponse {
  jobId: string;
  reservedCredits: number;
  remainingCredits: number;
  streamUrl: string;
}

async function submitJob(payload: unknown): Promise<CreateJobResponse> {
  const res = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as
    | { data: CreateJobResponse }
    | { error: { code: string; message: string; details?: Record<string, unknown> } };
  if (!res.ok || 'error' in json) {
    const err =
      'error' in json ? json.error : { code: 'INTERNAL_ERROR', message: '요청 실패' };
    throw new Error(err.message);
  }
  return json.data;
}

export const ConversationBlock = forwardRef<HTMLDivElement, ConversationBlockProps>(
  function ConversationBlock(
    { block, convId, isLast, activeJobExists, credits, onFirstGenerationStart },
    ref,
  ) {
    const updatePrompt = useConversationStore((s) => s.updateBlockPrompt);
    const updateOptions = useConversationStore((s) => s.updateBlockOptions);
    const markQueued = useConversationStore((s) => s.markBlockQueued);
    const markFailed = useConversationStore((s) => s.markBlockFailed);
    const [submitting, setSubmitting] = useState(false);

    const isDraft = block.status === 'draft';
    const isInFlight = block.status === 'queued' || block.status === 'generating';

    // Block 잠금 조건: draft 가 아니거나, draft 지만 다른 job 이 활성.
    const locked = !isDraft || activeJobExists;

    // Validation 은 얇은 adapter 하나로 압축. 실제 정책은 createJobSchema 와
    // 기존 credits/activeJob 를 그대로 소비.
    const issue = validateBlockSubmission({
      prompt: block.prompt,
      options: block.options,
      credits,
      activeJobExists,
      isDraftBlock: isDraft,
    });
    const creditDeficit = Math.max(0, block.options.batchSize - credits);
    const issueMessage = messageForIssue(issue, { creditDeficit });

    // SSE stream 훅. jobId 가 있고 아직 in-flight 이면 열기.
    useConversationJobStream({
      convId,
      blockId: block.id,
      jobId: isInFlight ? block.jobId : null,
    });

    // Package Job 재진입 복구. Mount 시 packageMode 이면서 status 가
    // unknown/queued/generating 이면 서버에 실제 Job + Slot 상태를 1회 조회.
    // Fetch 결과가 queued/running 이면 위의 SSE 훅이 이어서 실시간을 담당.
    // Single Job 은 packageMode=false 이므로 훅 내부에서 no-op.
    usePackageJobRehydrate({
      convId,
      blockId: block.id,
      jobId: block.jobId,
      packageMode: block.options.packageMode,
      currentStatus: block.status,
    });

    // 패키지 모드 AI 추천. usePackagePlan 은 required 필드 없으면 enabled false.
    const packagePlanState = block.options.packagePlan;
    const plan = usePackagePlan({
      purpose: packagePlanState.purpose,
      topicOrEvent: packagePlanState.topicOrEvent,
      target: packagePlanState.target,
      styleTone: packagePlanState.styleTone,
      additionalRequest: packagePlanState.additionalRequest,
      usageChannels: packagePlanState.usageChannels,
      userAddedKeywords: packagePlanState.userAddedKeywords,
      userRemovedKeywords: packagePlanState.userRemovedKeywords,
    });

    // AI 응답 도착 시 사용자 편집 보호 병합 후 store 반영.
    // dependency 는 plan.data 참조만 — react-query 가 dedupe 하므로 무한 루프 X.
    useEffect(() => {
      const data = plan.data;
      if (!data) return;
      if (!block.options.packageMode) return;
      const current = block.options.packagePlan;
      const merged = mergePackagePlan(current, data);
      const same =
        JSON.stringify(merged.aiKeywords) ===
          JSON.stringify(current.aiKeywords) &&
        JSON.stringify(merged.aiItems) === JSON.stringify(current.aiItems) &&
        JSON.stringify(merged.itemState) ===
          JSON.stringify(current.itemState) &&
        JSON.stringify(merged.userModifiedItemIds) ===
          JSON.stringify(current.userModifiedItemIds);
      if (same) return;
      updateOptions(convId, block.id, {
        packagePlan: {
          ...current,
          aiKeywords: merged.aiKeywords,
          aiItems: merged.aiItems,
          itemState: merged.itemState,
          userModifiedItemIds: merged.userModifiedItemIds,
        },
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [plan.data]);

    async function handleSubmit() {
      // 이중 방어: UI 는 이미 disable 되지만 빠른 연속 클릭/Enter 반복도 여기서 차단.
      if (submitting || locked) return;
      if (issue !== null) return;
      // packageMode 는 별도 handler.
      if (block.options.packageMode) return;

      setSubmitting(true);
      try {
        const trimmed = block.prompt.trim();
        const parentRef = block.options.parentImageId;
        const personalRef = block.options.personalReferenceIds[0] ?? null;
        const orgRef = block.options.orgReferenceIds[0] ?? null;
        const parsed = createJobSchema.safeParse({
          prompt: trimmed,
          batchSize: block.options.batchSize,
          diversityLevel: 0,
          referenceImageId: parentRef ?? personalRef,
          customReferenceId: null,
          schoolProfileApplied: block.options.schoolProfileApplied,
          generationMode: parentRef || personalRef || orgRef ? 'img2img' : 'text2img',
          aspectRatio: block.options.aspectRatio,
          orgSlug: block.options.orgSlug,
          orgReferenceId: orgRef,
          slotPrompts: block.options.diversityCustomOn
            ? block.options.slotPrompts
            : null,
        });
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          toast.error(first?.message ?? '입력값을 확인해주세요');
          setSubmitting(false);
          return;
        }
        const data = await submitJob(parsed.data);
        markQueued(convId, block.id, data.jobId);
        onFirstGenerationStart(trimmed);
      } catch (err) {
        const message = err instanceof Error ? err.message : '생성 요청 실패';
        toast.error(message);
        markFailed(convId, block.id, message);
      } finally {
        setSubmitting(false);
      }
    }

    async function handlePackageSubmit() {
      if (submitting || locked) return;
      if (!canSubmitPackage(packagePlanState)) {
        toast.error('목적·대상·스타일과 최소 1장을 입력해주세요.');
        return;
      }
      const totalSlots = computePackageTotalSlots(packagePlanState);
      if (credits < totalSlots) {
        toast.error(
          `크레딧이 부족해요. (필요: ${totalSlots}, 보유: ${credits})`,
        );
        return;
      }
      setSubmitting(true);
      try {
        const result = await submitPackage(packagePlanState);
        markQueued(convId, block.id, result.jobId);
        // 대화 제목은 목적 + 주제 조합. 주제가 없으면 목적만.
        const titleSeed =
          [
            packagePlanState.purpose.trim(),
            packagePlanState.topicOrEvent.trim(),
          ]
            .filter(Boolean)
            .join(' · ') || '패키지 생성';
        onFirstGenerationStart(titleSeed);
      } catch (err) {
        const message =
          err instanceof PackageSubmitError
            ? err.message
            : err instanceof Error
              ? err.message
              : '패키지 생성 요청 실패';
        toast.error(message);
        markFailed(convId, block.id, message);
      } finally {
        setSubmitting(false);
      }
    }

    const packageMode = block.options.packageMode;

    return (
      <article
        ref={ref}
        // 외곽 카드 없이 순수 wrapper. Prompt/Option/응답 카드가 각자
        // 배경 위에 개별 카드로 놓이도록 함 (사용자 요청 반영).
        className="space-y-4 animate-fade-in-up"
      >
        <div className="grid gap-4 md:grid-cols-[3fr_2fr] md:items-stretch">
          {packageMode ? (
            <PackagePromptCard
              locked={locked}
              packageMode
              onPackageModeChange={(next) =>
                updateOptions(convId, block.id, { packageMode: next })
              }
              plan={packagePlanState}
              onPlanChange={(patch) =>
                updateOptions(convId, block.id, {
                  packagePlan: { ...packagePlanState, ...patch },
                })
              }
              isRecommendationLoading={plan.isFetching}
            />
          ) : (
            <PromptStep
              prompt={block.prompt}
              locked={locked}
              autoFocus={isDraft && isLast && !activeJobExists}
              onChange={(next) => updatePrompt(convId, block.id, next)}
              diversityEnabled={block.options.diversityCustomOn}
              onDiversityEnabledChange={(next) =>
                updateOptions(convId, block.id, { diversityCustomOn: next })
              }
              slotPrompts={block.options.slotPrompts}
              onSlotPromptsChange={(next) =>
                updateOptions(convId, block.id, { slotPrompts: next })
              }
              batchSize={block.options.batchSize}
              packageMode={packageMode}
              onPackageModeChange={(next) =>
                updateOptions(convId, block.id, { packageMode: next })
              }
            />
          )}

          {packageMode ? (
            <PackageOptionCard
              locked={locked}
              plan={packagePlanState}
              onPlanChange={(patch) =>
                updateOptions(convId, block.id, {
                  packagePlan: { ...packagePlanState, ...patch },
                })
              }
              isRecommendationLoading={plan.isFetching}
              isRecommendationAuto={plan.data !== undefined}
              onSubmit={handlePackageSubmit}
            />
          ) : (
            <OptionStep
              options={block.options}
              locked={locked}
              submitting={submitting}
              issueMessage={issueMessage}
              onChange={(patch: Partial<BlockOptions>) =>
                updateOptions(convId, block.id, patch)
              }
              onSubmit={handleSubmit}
            />
          )}
        </div>

        {isInFlight && (
          <AiResponseBubble>
            <GeneratingStep block={block} />
          </AiResponseBubble>
        )}
        {block.status === 'completed' && (
          <AiResponseBubble>
            <CompletedStep block={block} />
          </AiResponseBubble>
        )}
        {block.status === 'failed' && (
          <AiResponseBubble>
            <section className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="space-y-0.5">
                <p className="font-medium">생성에 실패했어요</p>
                <p className="text-destructive/80">
                  {block.errorMessage ?? '알 수 없는 오류가 발생했어요.'}
                </p>
              </div>
            </section>
          </AiResponseBubble>
        )}
        {block.status === 'unknown' && (
          <AiResponseBubble>
            <section className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-amber-900 dark:text-amber-200">
              <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="space-y-0.5">
                <p className="font-medium">생성 상태 확인이 필요합니다</p>
                <p>
                  새로고침으로 실시간 연결이 끊어졌어요. 실제 생성 결과는 라이브러리에서
                  확인할 수 있어요.
                </p>
              </div>
            </section>
          </AiResponseBubble>
        )}
      </article>
    );
  },
);
