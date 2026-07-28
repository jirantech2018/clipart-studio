'use client';

// 3-phase 취소 대화상자.
//   confirm  — 사용자에게 결과물·크레딧 처리 기준 설명 + 최종 승인 받음
//   pending  — 취소 API 응답 + SSE done 이벤트 대기 (도중에 실행되던 슬롯이
//              다 마무리될 때까지 몇 초 소요될 수 있음). 오버레이·Escape 로
//              닫히지 않음.
//   result   — done 이벤트가 도착해 store.summary 가 채워지면 자동 전환.
//              실제 정산 결과 (라이브러리 저장 수, 환불 크레딧, 잔액) 표시.

import { CheckCircle2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { useCancelJob } from '@/features/generation/hooks/useCancelJob';
import { useGenerationStore } from '@/lib/store/generationStore';
import { cn } from '@/lib/utils';

// 서버 CHUNK_SIZE 와 동일. UI 표시용 추정 (실행 중 슬롯 수를 서버가 별도로
// 노출하지 않아 min(CHUNK_SIZE, inFlight) 로 근사).
const CHUNK_SIZE = 5;

interface CancelDialogProps {
  open: boolean;
  onClose: () => void;
}

type Phase = 'confirm' | 'pending' | 'result';

export function CancelDialog({ open, onClose }: CancelDialogProps) {
  const jobId = useGenerationStore((s) => s.jobId);
  const batchSize = useGenerationStore((s) => s.batchSize);
  const cards = useGenerationStore((s) => s.cards);
  const failures = useGenerationStore((s) => s.failures);
  const summary = useGenerationStore((s) => s.summary);
  const reset = useGenerationStore((s) => s.reset);

  const cancel = useCancelJob();
  const [phase, setPhase] = useState<Phase>('confirm');

  // Dialog 가 새로 열릴 때마다 confirm 부터 시작.
  useEffect(() => {
    if (open) setPhase('confirm');
  }, [open]);

  // pending 상태에서 summary 가 채워지면 result 로 자동 전환.
  useEffect(() => {
    if (phase === 'pending' && summary) {
      setPhase('result');
    }
  }, [phase, summary]);

  const succeeded = cards.length;
  const failed = failures.length;
  const inFlight = Math.max(0, batchSize - succeeded - failed);
  const running = Math.min(CHUNK_SIZE, inFlight);
  const waiting = Math.max(0, inFlight - running);

  async function handleConfirmCancel() {
    if (!jobId) {
      toast.error('작업 ID 를 알 수 없어요');
      return;
    }
    setPhase('pending');
    try {
      await cancel.mutateAsync(jobId);
      // 최종 정산은 stream 의 done 이벤트가 store.summary 를 채우면 result phase
      // 로 자동 전환된다. 이 함수는 여기서 리턴만 하고 대기.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '취소 요청에 실패했어요');
      setPhase('confirm');
    }
  }

  function handleFinalClose() {
    // result 확인 후에만 로컬 상태 리셋 (사용자 명시 지시:
    // "서버 응답 전에 화면을 초기화하지 않는다").
    reset();
    onClose();
  }

  // ===== Phase: confirm =====
  if (phase === 'confirm') {
    return (
      <Dialog open={open} onClose={onClose} dismissable>
        <DialogHeader
          title="이미지 생성을 취소하시겠습니까?"
          description="취소하기 전에 결과물과 크레딧 처리 내용을 확인해 주세요."
        />
        <DialogBody>
          <div className="space-y-4 text-sm">
            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <div>
                <p className="font-medium">• 이미 완성된 이미지</p>
                <p className="text-muted-foreground">
                  라이브러리에 그대로 저장되며, 사용된 크레딧은 환불되지 않습니다.
                </p>
              </div>
              <div>
                <p className="font-medium">• 현재 생성 중인 이미지</p>
                <p className="text-muted-foreground">
                  AI 생성 요청이 이미 시작된 경우 즉시 중단되지 않을 수 있습니다.
                  <br />
                  성공하면 이미지가 라이브러리에 저장되고 크레딧이 사용됩니다.
                  <br />
                  실패하면 해당 크레딧이 환불됩니다.
                </p>
              </div>
              <div>
                <p className="font-medium">• 아직 생성이 시작되지 않은 이미지</p>
                <p className="text-muted-foreground">
                  생성을 시작하지 않고 취소되며, 해당 크레딧은 자동으로 환불됩니다.
                </p>
              </div>
            </div>

            <div className="rounded-md border p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                현재 진행 상태
              </p>
              <ul className="space-y-0.5">
                <li>
                  전체 요청: <strong className="tabular-nums">{batchSize}장</strong>
                </li>
                <li>
                  완료된 이미지: <strong className="tabular-nums">{succeeded}장</strong>
                </li>
                <li>
                  현재 생성 중 (추정):{' '}
                  <strong className="tabular-nums">{running}장</strong>
                </li>
                <li>
                  생성 대기 중: <strong className="tabular-nums">{waiting}장</strong>
                </li>
              </ul>
            </div>

            <p className="text-sm text-muted-foreground">
              지금 취소하면 대기 중인 <strong>{waiting}장</strong>의 생성이 중단되며,
              해당 크레딧이 자동으로 환불됩니다.
              <br />
              현재 생성 중인 <strong>{running}장</strong>은 처리 결과에 따라
              라이브러리에 저장되거나 크레딧이 환불될 수 있습니다.
              <br />
              <span className="text-xs">
                예상 환불: 최대 {waiting}크레딧 (실제 값은 서버 정산 후 확정)
              </span>
            </p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={onClose}
            autoFocus
          >
            계속 생성
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={handleConfirmCancel}
          >
            그래도 생성 취소
          </Button>
        </DialogFooter>
      </Dialog>
    );
  }

  // ===== Phase: pending =====
  if (phase === 'pending') {
    return (
      <Dialog open={open} onClose={onClose} dismissable={false}>
        <DialogHeader title="이미지 생성을 취소하고 있습니다" />
        <DialogBody>
          <div className="flex items-start gap-3 text-sm">
            <Loader2 className="mt-1 h-5 w-5 shrink-0 animate-spin text-primary" />
            <div className="space-y-2">
              <p>완료된 이미지와 현재 생성 상태를 확인하고 있습니다.</p>
              <p className="text-muted-foreground">
                생성을 시작하지 않은 이미지의 중단과
                <br />
                환불 가능한 크레딧을 정산하고 있습니다.
              </p>
            </div>
          </div>
        </DialogBody>
      </Dialog>
    );
  }

  // ===== Phase: result =====
  // 이 시점에서는 summary 가 반드시 있다 (pending → result 전환 조건).
  const finalSummary = summary!;
  const stillProcessing = Math.max(
    0,
    batchSize - finalSummary.completed - finalSummary.failed,
  );

  return (
    <Dialog open={open} onClose={handleFinalClose} dismissable>
      <DialogHeader title="이미지 생성이 취소되었습니다" />
      <DialogBody>
        <div className="space-y-3 text-sm">
          <div className="inline-flex items-center gap-2 text-primary">
            <CheckCircle2 className="h-4 w-4" />
            <span className="font-medium">정산 완료</span>
          </div>
          <ul className="space-y-1 rounded-md border p-3">
            <li>
              완료된 이미지:{' '}
              <strong className="tabular-nums">{finalSummary.completed}장</strong>
            </li>
            <li>
              라이브러리에 저장된 이미지:{' '}
              <strong className="tabular-nums">{finalSummary.completed}장</strong>
            </li>
            <li>
              환불된 크레딧:{' '}
              <strong className="tabular-nums">
                {finalSummary.refundedCredits}크레딧
              </strong>
            </li>
            {finalSummary.finalRemainingCredits !== null && (
              <li>
                현재 잔액:{' '}
                <strong className="tabular-nums">
                  {finalSummary.finalRemainingCredits}
                </strong>
              </li>
            )}
          </ul>
          <p className="text-muted-foreground">
            완료된 이미지는 라이브러리에 저장되어 있습니다.
            {stillProcessing > 0 && (
              <>
                <br />
                취소 요청 전에 이미 생성이 시작된 <strong>{stillProcessing}장</strong>
                은 처리 결과에 따라 추가로 저장되거나 해당 크레딧이 환불될 수 있어요.
              </>
            )}
          </p>
        </div>
      </DialogBody>
      <DialogFooter>
        <Link
          href="/library"
          onClick={handleFinalClose}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          라이브러리에서 확인
        </Link>
        <Button type="button" variant="default" size="sm" onClick={handleFinalClose}>
          확인
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
