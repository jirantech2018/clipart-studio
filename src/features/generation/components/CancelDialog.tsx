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
    // 순서 중요: dialog 를 먼저 unmount 시키고 그 뒤에 store 를 초기화한다.
    // 반대 순서로 하면 summary 가 null 이 되는 순간 result phase 렌더가
    // finalSummary.completed 접근에서 크래시 (client-side exception).
    onClose();
    setPhase('confirm');
    // 다음 tick 에 reset — Dialog 가 unmount 된 뒤라 안전.
    setTimeout(() => reset(), 0);
  }

  // ===== Phase: confirm =====
  if (phase === 'confirm') {
    return (
      <Dialog open={open} onClose={onClose} dismissable>
        <DialogHeader
          title="이미지 생성을 취소하시겠습니까?"
          description="이미 생성이 시작된 이미지는 취소해도 중단되지 않습니다."
        />
        <DialogBody>
          <div className="space-y-4 text-sm">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                AI가 이미 작업 중인 이미지는 끝까지 생성되어 내 라이브러리에 저장됩니다.
              </li>
              <li>
                이미 생성이 시작된 이미지에 사용된 크레딧은 환불되지 않습니다.
              </li>
              <li>
                아직 생성이 시작되지 않은 이미지는 취소되며 크레딧이 자동 환불됩니다.
              </li>
              <li>
                생성 중 오류가 발생한 이미지는 크레딧이 자동 환불됩니다.
              </li>
            </ul>

            <div className="rounded-md border p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                현재 상태
              </p>
              <ul className="space-y-0.5 tabular-nums">
                <li>
                  총 요청: <strong>{batchSize}장</strong>
                </li>
                <li>
                  생성 완료: <strong>{succeeded}장</strong>
                </li>
                <li>
                  AI 작업 중: <strong>{running}장</strong>
                </li>
                <li className="text-destructive">
                  아직 시작되지 않음: <strong>{waiting}장</strong>
                </li>
              </ul>
            </div>

            <p className="rounded-md bg-muted/50 p-3 text-sm">
              취소하면 아직 시작되지 않은 <strong>{waiting}장</strong>만 취소 및
              환불되며,
              <br />
              AI가 이미 작업 중인 <strong>{running}장</strong>은 계속 생성됩니다.
              <br />
              <strong>정말 취소하시겠습니까?</strong>
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
            생성 취소
          </Button>
        </DialogFooter>
      </Dialog>
    );
  }

  // ===== Phase: pending =====
  if (phase === 'pending') {
    return (
      <Dialog open={open} onClose={onClose} dismissable={false}>
        <DialogHeader title="이미지 생성을 취소하고 있습니다." />
        <DialogBody>
          <div className="space-y-4 text-sm">
            <div className="flex items-start gap-3">
              <Loader2 className="mt-1 h-5 w-5 shrink-0 animate-spin text-primary" />
              <div className="space-y-2">
                <p>아직 시작되지 않은 이미지의 생성은 취소되었습니다.</p>
                <p>
                  AI가 이미 작업 중인 이미지는 계속 처리되며,
                  <br />
                  완료되면 내 라이브러리에 자동 저장됩니다.
                </p>
                <p>
                  작업 중 오류가 발생한 이미지는
                  <br />
                  크레딧이 자동 환불됩니다.
                </p>
                <p className="text-muted-foreground">
                  생성이 완료될 때까지 기다릴 필요는 없습니다.
                  <br />
                  다른 작업을 계속 진행하셔도 됩니다.
                </p>
              </div>
            </div>

            <div className="rounded-md border p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                현재 상태
              </p>
              <ul className="space-y-0.5 tabular-nums">
                <li>
                  생성 완료: <strong>{succeeded}</strong> / {batchSize}장
                </li>
                <li>
                  AI 작업 중: <strong>{running}장</strong>
                </li>
                <li className="text-destructive">
                  취소 및 환불 대기: <strong>{waiting}장</strong>
                </li>
              </ul>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Link
            href="/library"
            onClick={() => {
              onClose();
              setPhase('confirm');
              setTimeout(() => reset(), 0);
            }}
            className={cn(buttonVariants({ variant: 'default', size: 'sm' }))}
          >
            내 라이브러리로 이동
          </Link>
        </DialogFooter>
      </Dialog>
    );
  }

  // ===== Phase: result =====
  // Null-safe guard — handleFinalClose 가 setTimeout 으로 store.reset 을 걸면
  // summary 가 null 로 돌아가지만, phase 도 confirm 으로 복귀되고 dialog 는
  // 이미 unmount 된 뒤. 그래도 방어적으로 처리.
  if (!summary) return null;
  const finalSummary = summary;
  const stillProcessing = Math.max(
    0,
    batchSize - finalSummary.completed - finalSummary.failed,
  );

  return (
    <Dialog open={open} onClose={handleFinalClose} dismissable>
      <DialogHeader title="이미지 생성이 취소되었습니다." />
      <DialogBody>
        <div className="space-y-3 text-sm">
          <div className="inline-flex items-center gap-2 text-primary">
            <CheckCircle2 className="h-4 w-4" />
            <span className="font-medium">정리가 완료됐어요</span>
          </div>
          <ul className="space-y-1 rounded-md border p-3 tabular-nums">
            <li>
              라이브러리에 저장된 이미지 :{' '}
              <strong>{finalSummary.completed}장</strong>
            </li>
            {finalSummary.refundedCredits > 0 && (
              <li>
                되돌아온 크레딧 : <strong>{finalSummary.refundedCredits}크레딧</strong>
              </li>
            )}
            {finalSummary.finalRemainingCredits !== null && (
              <li>
                현재 잔액 : <strong>{finalSummary.finalRemainingCredits}</strong>
              </li>
            )}
          </ul>
          {stillProcessing > 0 && (
            <p className="text-muted-foreground">
              이미 시작된 <strong>{stillProcessing}장</strong>은 완료되는 대로
              라이브러리에 자동 저장돼요.
            </p>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Link
          href="/library"
          onClick={handleFinalClose}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          내 라이브러리로 이동
        </Link>
        <Button type="button" variant="default" size="sm" onClick={handleFinalClose}>
          확인
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
