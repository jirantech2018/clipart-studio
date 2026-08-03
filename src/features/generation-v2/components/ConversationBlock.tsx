'use client';

// Conversation 안의 개별 Block 오케스트레이터.
// 상태(status) 에 따라 4개 Step 을 조합해 렌더한다.
//
//   draft      → PromptStep(edit) + OptionStep(edit + submit)
//   queued     → PromptStep(ro)   + OptionStep(ro) + GeneratingStep
//   generating → PromptStep(ro)   + OptionStep(ro) + GeneratingStep
//   completed  → PromptStep(ro)   + OptionStep(ro) + CompletedStep
//   failed     → PromptStep(ro)   + OptionStep(ro) + Failure banner
//   unknown    → PromptStep(ro)   + OptionStep(ro) + "상태 확인 필요" 안내
//
// activeJobExists = 이 conversation 내 다른 Block 이 실행 중.
//   true 인 draft Block 은 submit 을 disable (동시 Job 1개 제한).

import { AlertTriangle, HelpCircle } from 'lucide-react';
import { forwardRef, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { CompletedStep } from '@/features/generation-v2/components/CompletedStep';
import { GeneratingStep } from '@/features/generation-v2/components/GeneratingStep';
import { OptionStep } from '@/features/generation-v2/components/OptionStep';
import { PromptStep } from '@/features/generation-v2/components/PromptStep';
import { useConversationJobStream } from '@/features/generation-v2/hooks/useConversationJobStream';
import { extractRecentPrompts } from '@/features/generation-v2/lib/recentPrompts';
import {
  messageForIssue,
  validateBlockSubmission,
} from '@/features/generation-v2/lib/validateBlockSubmission';
import { useConversationStore } from '@/lib/store/conversationStore';
import { cn } from '@/lib/utils';
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
    const conv = useConversationStore((s) => s.conversations[convId]);
    const [submitting, setSubmitting] = useState(false);

    // 최근 사용 Dropdown 용 — 현재 Block 을 제외한 이전 Block 들에서만 추출.
    // (draft 인 현재 Block 이 목록에 자기 자신을 노출하는 것은 지시상 불가)
    const recentPrompts = useMemo(() => {
      const others = (conv?.blocks ?? []).filter((b) => b.id !== block.id);
      return extractRecentPrompts(others);
    }, [conv?.blocks, block.id]);

    const isDraft = block.status === 'draft';
    const isTerminal =
      block.status === 'completed' ||
      block.status === 'failed' ||
      block.status === 'unknown';
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

    async function handleSubmit() {
      // 이중 방어: UI 는 이미 disable 되지만 빠른 연속 클릭/Enter 반복도 여기서 차단.
      if (submitting || locked) return;
      if (issue !== null) return;

      setSubmitting(true);
      try {
        const trimmed = block.prompt.trim();
        const personalRef = block.options.personalReferenceIds[0] ?? null;
        const orgRef = block.options.orgReferenceIds[0] ?? null;
        const parsed = createJobSchema.safeParse({
          prompt: trimmed,
          batchSize: block.options.batchSize,
          diversityLevel: 0,
          referenceImageId: personalRef,
          customReferenceId: null,
          schoolProfileApplied: block.options.schoolProfileApplied,
          generationMode: 'text2img',
          aspectRatio: block.options.aspectRatio,
          orgSlug: block.options.orgSlug,
          orgReferenceId: orgRef,
          slotPrompts: null,
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

    return (
      <article
        ref={ref}
        className={cn(
          'space-y-4 rounded-xl border bg-card p-4',
          isTerminal && 'bg-muted/10',
        )}
      >
        {/* Draft Block 상단: 좌(Prompt 60%) / 우(Option 40%). md 미만에서는
            자동으로 세로 stack. Prompt 는 textarea 가 자유롭게 늘어나야 해서
            높이 균등을 위해 items-stretch 적용. */}
        <div className="grid gap-4 md:grid-cols-[3fr_2fr] md:items-stretch">
          <PromptStep
            prompt={block.prompt}
            locked={locked}
            autoFocus={isDraft && isLast && !activeJobExists}
            onChange={(next) => updatePrompt(convId, block.id, next)}
            recentPrompts={recentPrompts}
          />

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
        </div>

        {isInFlight && <GeneratingStep block={block} />}
        {block.status === 'completed' && <CompletedStep block={block} />}
        {block.status === 'failed' && (
          <section className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">생성에 실패했어요</p>
              <p className="text-destructive/80">
                {block.errorMessage ?? '알 수 없는 오류가 발생했어요.'}
              </p>
            </div>
          </section>
        )}
        {block.status === 'unknown' && (
          <section className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-900 dark:text-amber-200">
            <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">생성 상태 확인이 필요합니다</p>
              <p>
                새로고침으로 실시간 연결이 끊어졌어요. 실제 생성 결과는 라이브러리에서
                확인할 수 있어요.
              </p>
            </div>
          </section>
        )}
      </article>
    );
  },
);
