// 이미지 생성 취소 — 사용자가 확인 팝업에서 승인한 뒤 호출.
//
// POST /api/jobs/[jobId]/cancel
//
// 흐름:
//   1. 소유권 + 현재 status 조회
//   2. status ∈ (queued, running) 인 경우에만 CAS UPDATE 로 'canceled' 로 전환
//      - 실패(다른 세션이 이미 canceled/done/failed) 시 alreadyResolved=true 로 응답
//   3. CAS 성공 시 예상 환불량을 낙관적으로 계산해 응답
//      (실제 정산은 stream 루프의 finally 가 수행 — 그래야 진행 중 슬롯 결과에
//       따른 refund/success 도 함께 반영됨)
//   4. 클라이언트는 SSE 의 'done' 이벤트에서 최종 counts + refundedCredits 를
//      받아 완료 팝업에 반영한다.
//
// 정산 규칙 (double refund 방지):
//   - Cancel API 는 refund 를 직접 수행하지 않는다 (status 만 바꿈).
//   - Stream 각 슬롯 실패 시 refund → generation_jobs.refunded_credits 는 UI 표시용
//     이지만 실제 refund 는 refund_credits RPC 로만.
//   - Stream finally 가 untouched slots = batchSize - succeeded - failed 를
//     최종 refund. Cancel 로 인해 loop 를 조기 종료해도 이 계산이 자동으로 맞아
//     떨어진다.

import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

import type { JobStatus } from '@/types/domain';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  // 소유권 확인 + 현재 상태 조회 (RLS 는 user_id 로 filter 되어 있음).
  const { data: jobRow } = await supabase
    .from('generation_jobs')
    .select('id, user_id, status, batch_size, refunded_credits')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!jobRow) return apiError('NOT_FOUND', '작업을 찾을 수 없어요');

  const job = jobRow as {
    id: string;
    user_id: string;
    status: JobStatus;
    batch_size: number;
    refunded_credits: number;
  };

  // 이미 종료된 상태면 idempotent 로 응답 (팝업 흐름을 자연스럽게 마무리).
  if (job.status !== 'queued' && job.status !== 'running') {
    // 성공한 이미지 수는 참조용으로만 조회.
    const { count: succeeded } = await supabase
      .from('images')
      .select('id', { count: 'exact', head: true })
      .eq('batch_id', job.id)
      .eq('user_id', user.id);
    return apiOk({
      alreadyResolved: true,
      status: job.status,
      batchSize: job.batch_size,
      succeededCount: succeeded ?? 0,
      refundedCredits: job.refunded_credits,
    });
  }

  // CAS: (queued|running) → canceled. Stream 루프가 매 chunk 시작 전 status 를
  // 조회하기 때문에 이 UPDATE 가 반영되는 순간부터 새 슬롯 실행이 차단된다.
  const service = createSupabaseServiceClient();
  const { data: casRows, error: casError } = await service
    .from('generation_jobs')
    .update({ status: 'canceled' })
    .eq('id', job.id)
    .in('status', ['queued', 'running'])
    .select('id, batch_size, refunded_credits');

  if (casError) {
    console.error(`[jobs/${job.id}/cancel] CAS update failed`, casError);
    return apiError('INTERNAL_ERROR', '취소 처리에 실패했어요');
  }

  const wasCanceled = casRows && casRows.length > 0;
  const { count: succeededSnapshot } = await supabase
    .from('images')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', job.id)
    .eq('user_id', user.id);
  const succeeded = succeededSnapshot ?? 0;
  const alreadyRefunded = job.refunded_credits;

  // 낙관적 예상 환불량: 아직 시작 안 한 슬롯 = batch - 성공한 것 - 이미 환불된 것.
  // 정확한 값은 stream finally 가 계산해서 done 이벤트로 내려준다.
  const estimatedRefund = Math.max(0, job.batch_size - succeeded - alreadyRefunded);

  return apiOk({
    canceled: wasCanceled,
    alreadyResolved: !wasCanceled,
    status: 'canceled' as JobStatus,
    batchSize: job.batch_size,
    succeededCount: succeeded,
    estimatedRefund,
  });
}
