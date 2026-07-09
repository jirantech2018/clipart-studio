// Design Ref: §2.2 Data Flow — batch generation pipeline
// Given a job spec, run one image end-to-end: generate → upload → insert row.
// Isolated here so routes can call it in chunks without duplicating orchestration.

import { randomUUID } from 'node:crypto';

import { primaryAdapter, applyDiversityHint, mergePrompt } from '@/services/image-gen';
import { putObject } from '@/services/r2/upload';
import { createSupabaseServiceClient } from '@/services/supabase/server';

import type { GenerationJob, SchoolProfile } from '@/types/domain';

const PENDING_TTL_HOURS = 24;

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
 * Generate one image, upload to R2, insert an images row (status='pending').
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

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from('images').insert({
    id: imageId,
    user_id: job.userId,
    prompt: job.prompt, // store user's original, not merged
    model: gen.model,
    seed: gen.seed,
    r2_key: r2Key,
    batch_id: job.id,
    generation_mode: job.referenceImageId ? 'img2img' : 'text2img',
    reference_image_id: job.referenceImageId,
    school_profile_applied: job.schoolProfileApplied,
    status: 'pending',
    pending_expires_at: new Date(Date.now() + PENDING_TTL_HOURS * 3600_000).toISOString(),
  });

  if (error) throw new Error(`insert images failed: ${error.message}`);

  return { imageId, r2Key, order };
}
