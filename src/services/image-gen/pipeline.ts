// Design Ref: §2.2 Data Flow — batch generation pipeline
// Given a job spec, run one image end-to-end: generate → upload → insert row.
// Isolated here so routes can call it in chunks without duplicating orchestration.

import { randomUUID } from 'node:crypto';

import { primaryAdapter, applyDiversityHint, mergePrompt } from '@/services/image-gen';
import { putObject } from '@/services/r2/upload';
import { createSupabaseServiceClient } from '@/services/supabase/server';
import { taggingAdapter } from '@/services/tagging';

import type { GenerationJob, SchoolProfile } from '@/types/domain';

export interface PipelineResult {
  imageId: string;
  r2Key: string;
  order: number;
}

interface RunOneParams {
  job: GenerationJob;
  order: number; // 0-based within the batch
  schoolProfile: SchoolProfile | null;
  isDiversityChunk: boolean;
}

/**
 * Generate one image, upload to R2, insert an images row (status='saved').
 * Throws on any step failure — caller refunds credit for this slot.
 */
export async function runOne({
  job,
  order,
  schoolProfile,
  isDiversityChunk,
}: RunOneParams): Promise<PipelineResult> {
  const adapter = primaryAdapter();

  const merged = mergePrompt(job.prompt, schoolProfile, job.schoolProfileApplied);
  const finalPrompt = isDiversityChunk ? applyDiversityHint(merged, order) : merged;

  const gen = await adapter.generate({
    prompt: finalPrompt,
    mode: job.referenceImageId ? 'img2img' : 'text2img',
  });

  const imageId = randomUUID();
  const ext = gen.contentType === 'image/webp' ? 'webp' : 'png';
  const r2Key = `users/${job.userId}/${imageId}.${ext}`;

  await putObject({
    key: r2Key,
    body: gen.imageBytes,
    contentType: gen.contentType,
  });

  // Policy: generated images become permanent library assets on creation.
  // No pending/discarded lifecycle — user cannot delete, no TTL cleanup.
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from('images').insert({
    id: imageId,
    user_id: job.userId,
    prompt: job.prompt,
    model: gen.model,
    seed: gen.seed,
    r2_key: r2Key,
    batch_id: job.id,
    generation_mode: job.referenceImageId ? 'img2img' : 'text2img',
    reference_image_id: job.referenceImageId,
    school_profile_applied: job.schoolProfileApplied,
    status: 'saved',
    pending_expires_at: null,
  });

  if (error) throw new Error(`insert images failed: ${error.message}`);

  // Best-effort auto-tagging. Failure MUST NOT fail the image itself — the user
  // already paid a credit and got the R2 asset. Log and move on.
  await runTagging({
    supabase,
    imageId,
    prompt: job.prompt,
    schoolContext: schoolProfile?.styleDesc ?? null,
  }).catch((err: unknown) => {
    console.error(
      `[pipeline] tagging failed for image ${imageId}:`,
      err instanceof Error ? err.stack ?? err.message : err,
    );
  });

  return { imageId, r2Key, order };
}

interface RunTaggingParams {
  supabase: ReturnType<typeof createSupabaseServiceClient>;
  imageId: string;
  prompt: string;
  schoolContext: string | null;
}

async function runTagging({
  supabase,
  imageId,
  prompt,
  schoolContext,
}: RunTaggingParams): Promise<void> {
  const result = await taggingAdapter().tag({ prompt, schoolContext });

  if (result.tags.length > 0) {
    const rows = result.tags.map((tag) => ({ image_id: imageId, tag }));
    const { error: tagErr } = await supabase.from('image_tags').insert(rows);
    if (tagErr) throw new Error(`insert image_tags failed: ${tagErr.message}`);
  }

  if (result.categories.length > 0) {
    const rows = result.categories.map((category) => ({ image_id: imageId, category }));
    const { error: catErr } = await supabase.from('image_categories').insert(rows);
    if (catErr) throw new Error(`insert image_categories failed: ${catErr.message}`);
  }
}
