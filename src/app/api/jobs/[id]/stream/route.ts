// Design Ref: §2.2 Batch generation data flow + §4.2 SSE spec
// Plan SC: FR-20 SSE streaming, FR-06 diversity, FR-17 school profile inject
// Behavior: chunk-parallel generation, per-slot refund on failure, final job status update.
//
// Vercel serverless functions default to 10s on Hobby plan; force the maximum
// available (60s Hobby / 300s Pro) so a full 5-image chunk can finish streaming.
export const runtime = 'nodejs';
export const maxDuration = 60;

import { publicUrl } from '@/services/r2/upload';
import { fetchReferenceImage, fetchReferenceImageByKey, runOne } from '@/services/image-gen/pipeline';
import { refundCredits } from '@/services/credit';
import { structurePrompt } from '@/services/prompt-structuring';
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/services/supabase/server';

import type { ReferenceImage } from '@/services/image-gen';
import type { StructuredPrompt } from '@/services/prompt-structuring';
import type { GenerationJob, SchoolProfile } from '@/types/domain';

const CHUNK_SIZE = 5;

// Server-Sent Events framing
function sseEvent(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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
                isDiversityChunk: isDiversity,
                referenceImage,
                structuredPrompt,
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
