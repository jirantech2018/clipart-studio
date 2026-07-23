// Design Ref: §2.2 Batch generation data flow + §4.2 SSE spec
// Plan SC: FR-20 SSE streaming, FR-06 diversity, FR-17 school profile inject
// Behavior: chunk-parallel generation, per-slot refund on failure, final job status update.
//
// Runs on Railway (Node runtime, no serverless timeout). 60초 넘는 배치도 그대로 흘러간다.
export const runtime = 'nodejs';

import { publicUrl } from '@/services/r2/upload';
import { fetchReferenceImage, fetchReferenceImageByKey, runOne } from '@/services/image-gen/pipeline';
import { refundCredits } from '@/services/credit';
import {
  composeKnowledgePrompt,
  matchKnowledgeForPrompt,
} from '@/services/knowledge';
import { structurePrompt } from '@/services/prompt-structuring';
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/services/supabase/server';

import type { ReferenceImage } from '@/services/image-gen';
import type { KnowledgeMatch } from '@/services/knowledge';
import type { StructuredPrompt } from '@/services/prompt-structuring';
import type { GenerationJob, SchoolProfile } from '@/types/domain';

const CHUNK_SIZE = 5;
// Chunk 병렬 처리 중에는 image_ready 이벤트가 안 나가므로, 그 사이 프록시가
// idle timeout 으로 SSE 연결을 끊지 못하도록 15초마다 comment 라인을 보낸다.
const HEARTBEAT_INTERVAL_MS = 15_000;

// Server-Sent Events framing
function sseEvent(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// SSE comment line — 클라이언트는 무시하지만 연결을 살아있게 유지한다.
function sseComment(msg: string): Uint8Array {
  return new TextEncoder().encode(`: ${msg}\n\n`);
}

// snake_case DB row → GenerationJob domain shape
function jobFromRow(row: Record<string, unknown>): GenerationJob {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    prompt: row.prompt as string,
    batchSize: row.batch_size as number,
    diversityLevel: row.diversity_level as number,
    referenceImageId: (row.reference_image_id as string) ?? null,
    customReferenceR2Key: (row.custom_reference_r2_key as string) ?? null,
    schoolProfileApplied: row.school_profile_applied as boolean,
    aspectRatio: (row.aspect_ratio as GenerationJob['aspectRatio']) ?? 'square',
    reservedCredits: row.reserved_credits as number,
    refundedCredits: row.refunded_credits as number,
    status: row.status as GenerationJob['status'],
    error: (row.error as string) ?? null,
    createdAt: row.created_at as string,
    completedAt: (row.completed_at as string) ?? null,
    orgId: (row.org_id as string) ?? null,
  };
}

function schoolProfileFromRow(row: Record<string, unknown> | null): SchoolProfile | null {
  if (!row) return null;
  return {
    userId: row.user_id as string,
    schoolName: row.school_name as string,
    homepageUrl: (row.homepage_url as string) ?? null,
    logoUrl: (row.logo_url as string) ?? null,
    primaryColor: (row.primary_color as string) ?? null,
    mascotDesc: (row.mascot_desc as string) ?? null,
    mascotRefUrl: (row.mascot_ref_url as string) ?? null,
    buildingRefUrl: (row.building_ref_url as string) ?? null,
    styleDesc: (row.style_desc as string) ?? null,
    basePrompt: (row.base_prompt as string) ?? null,
    schoolLevel: (row.school_level as SchoolProfile['schoolLevel']) ?? null,
    updatedAt: row.updated_at as string,
  };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 });
  }

  const { data: jobRow, error: jobErr } = await supabase
    .from('generation_jobs')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();

  if (jobErr || !jobRow) {
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), { status: 404 });
  }

  const job = jobFromRow(jobRow);
  if (job.status !== 'queued' && job.status !== 'running') {
    return new Response(JSON.stringify({ error: { code: 'JOB_ALREADY_COMPLETE' } }), {
      status: 409,
    });
  }

  const { data: spRow } = await supabase
    .from('school_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  const schoolProfile = schoolProfileFromRow(spRow);

  // 조직 컨텍스트 job 이면 조직 base_prompt 스냅샷 로드 (job.orgId 는 생성
  // 시점에 활성 조직으로 확정). 조직이 그 사이 삭제됐다면 (FK ON DELETE
  // SET NULL 로 org_id 가 NULL 이 되어 있거나 organizations 조회가 miss)
  // 조직 힌트 없이 개인 컨텍스트처럼 진행.
  let orgBasePrompt: string | null = null;
  if (job.orgId) {
    const orgService = createSupabaseServiceClient();
    const { data: orgRow } = await orgService
      .from('organizations')
      .select('base_prompt')
      .eq('id', job.orgId)
      .maybeSingle();
    orgBasePrompt = (orgRow as { base_prompt: string | null } | null)?.base_prompt ?? null;
  }

  const service = createSupabaseServiceClient();
  await service
    .from('generation_jobs')
    .update({ status: 'running' })
    .eq('id', job.id);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let succeeded = 0;
      let failed = 0;
      let fatal: Error | null = null;

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(sseComment('keepalive'));
        } catch {
          // 클라이언트가 이미 끊었거나 stream 이 닫힌 상태 — 조용히 무시.
        }
      }, HEARTBEAT_INTERVAL_MS);

      try {
        // Preload the reference image once per batch when the job is img2img
        // (either library chaining or user-uploaded reference slot), so we don't
        // fetch it from R2 for every runOne call inside the chunks.
        let referenceImage: ReferenceImage | null = null;
        if (job.referenceImageId) {
          referenceImage = await fetchReferenceImage(job.referenceImageId);
        } else if (job.customReferenceR2Key) {
          referenceImage = await fetchReferenceImageByKey(job.customReferenceR2Key);
        }

        // 배치당 1회만 gpt-4o-mini 호출해 프롬프트를 구조화. 30장 배치도 이 비용은 상수.
        // 실패 시 structurePrompt 가 빈 구조체를 돌려주고, pipeline 은 원본 프롬프트로 fallback.
        const structuredPrompt: StructuredPrompt = await structurePrompt({
          prompt: job.prompt,
          hasReferenceImage: !!referenceImage,
          schoolContext: schoolProfile?.styleDesc ?? null,
        });

        // Knowledge 자동 매칭. 배치당 1회 실행.
        // 매칭이 없으면 pipeline 이 사용자 프롬프트를 그대로 사용.
        const knowledgeMatches: KnowledgeMatch[] = await matchKnowledgeForPrompt(job.prompt);
        console.log(
          `[knowledge] job=${job.id} matched=${knowledgeMatches.length}${
            knowledgeMatches.length === 0 ? '' : ` ids=[${knowledgeMatches.map((m) => m.knowledge.id).join(',')}]`
          }`,
        );

        // 매칭된 Knowledge 의 positive 대표 이미지 R2 keys 를 미리 계산하고
        // 실제 바이트를 병렬로 preload. 여기서 실패한 이미지는 조용히 스킵.
        let knowledgeReferenceImages: ReferenceImage[] = [];
        if (knowledgeMatches.length > 0) {
          const composedPreview = composeKnowledgePrompt(knowledgeMatches, job.prompt);
          const results = await Promise.allSettled(
            composedPreview.referenceImageKeys.map((key) => fetchReferenceImageByKey(key)),
          );
          knowledgeReferenceImages = results
            .filter(
              (r): r is PromiseFulfilledResult<ReferenceImage> => r.status === 'fulfilled',
            )
            .map((r) => r.value);
          console.log(
            `[knowledge] job=${job.id} preloadedImages=${knowledgeReferenceImages.length}/${composedPreview.referenceImageKeys.length}`,
          );
        }

        const totalSlots = job.batchSize;
        const chunkCount = Math.ceil(totalSlots / CHUNK_SIZE);

        for (let chunk = 0; chunk < chunkCount; chunk += 1) {
          const chunkStart = chunk * CHUNK_SIZE;
          const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalSlots);
          const isDiversity = chunk < job.diversityLevel;

          const results = await Promise.allSettled(
            Array.from({ length: chunkEnd - chunkStart }, (_, i) =>
              runOne({
                job,
                order: chunkStart + i,
                schoolProfile,
                orgBasePrompt,
                isDiversityChunk: isDiversity,
                referenceImage,
                structuredPrompt,
                knowledgeMatches,
                knowledgeReferenceImages,
              }),
            ),
          );

          for (const [i, result] of results.entries()) {
            const order = chunkStart + i;
            if (result.status === 'fulfilled') {
              succeeded += 1;
              controller.enqueue(
                sseEvent('image_ready', {
                  imageId: result.value.imageId,
                  thumbnailUrl: publicUrl(result.value.r2Key),
                  order,
                }),
              );
            } else {
              failed += 1;
              const err = result.reason as Error;
              console.error(
                `[jobs/${job.id}/stream] runOne failed at order ${order}:`,
                err?.stack ?? err,
              );
              controller.enqueue(
                sseEvent('chunk_failed', {
                  order,
                  error: err?.message ?? 'unknown',
                  refundedCredits: 1,
                }),
              );
              await refundCredits(job.userId, 1);
            }
          }
        }
      } catch (err) {
        fatal = err as Error;
        console.error(`[jobs/${job.id}/stream] fatal error:`, fatal?.stack ?? fatal);
      } finally {
        clearInterval(heartbeat);

        // Refund any slots we never got to (e.g. fatal error mid-batch)
        const untouched = job.batchSize - succeeded - failed;
        if (untouched > 0) {
          try {
            await refundCredits(job.userId, untouched);
          } catch (refundErr) {
            console.error(
              `[jobs/${job.id}/stream] refund failed for ${untouched} untouched slots:`,
              refundErr,
            );
          }
          failed += untouched;
        }

        // Always resolve job.status so the partial-unique index unblocks retries
        const finalStatus = fatal
          ? 'failed'
          : failed === 0
            ? 'done'
            : succeeded === 0
              ? 'failed'
              : 'partial';

        const { data: finalProfile } = await service
          .from('profiles')
          .select('credits')
          .eq('id', job.userId)
          .single();

        await service
          .from('generation_jobs')
          .update({
            status: finalStatus,
            refunded_credits: failed,
            error: fatal?.message ?? null,
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id);

        try {
          controller.enqueue(
            sseEvent('done', {
              jobId: job.id,
              completed: succeeded,
              failed,
              refundedCredits: failed,
              finalRemainingCredits: finalProfile?.credits ?? null,
            }),
          );
          // done 이벤트가 클라이언트에 도달해 EventSource.close() 를 부를 시간을
          // 확보한 뒤 서버측 close. 이 delay 가 없으면 브라우저가 자동 재접속을
          // 시도해서 이미 완료된 job 에 대해 409 를 받고 onerror 를 trigger 한다.
          await new Promise((resolve) => setTimeout(resolve, 500));
          controller.close();
        } catch {
          // Client already disconnected — ignore enqueue/close errors
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
