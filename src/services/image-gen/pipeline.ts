// Design Ref: §2.2 Data Flow — batch generation pipeline
// Given a job spec, run one image end-to-end: generate → upload → insert row.
// Isolated here so routes can call it in chunks without duplicating orchestration.

import { randomUUID } from 'node:crypto';

import { primaryAdapter, applyDiversityHint, mergePrompt } from '@/services/image-gen';
import { publicUrl, putObject } from '@/services/r2/upload';
import { createSupabaseServiceClient } from '@/services/supabase/server';
import { taggingAdapter } from '@/services/tagging';

import type { ReferenceImage } from '@/services/image-gen';
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
  /** Preloaded reference bytes for chaining; caller fetches once per batch. */
  referenceImage?: ReferenceImage | null;
}

/**
 * Preload the reference image once for a chaining batch. Callers should invoke
 * this before the runOne loop and pass the result into each runOne call.
 */
export async function fetchReferenceImage(referenceImageId: string): Promise<ReferenceImage> {
  const supabase = createSupabaseServiceClient();
  const { data: row } = await supabase
    .from('images')
    .select('r2_key')
    .eq('id', referenceImageId)
    .maybeSingle();
  if (!row) throw new Error(`reference image not found: ${referenceImageId}`);

  const url = publicUrl(row.r2_key as string);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`R2 fetch failed: ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') ?? 'image/png';
  return { bytes, contentType };
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
  referenceImage,
}: RunOneParams): Promise<PipelineResult> {
  const adapter = primaryAdapter();

  // Admin-controlled global directive (Korean-context enforcement). Prepended to
  // every prompt including chaining (i2i) — the base image handles style, this
  // handles semantic guidance (ethnicity, setting details, symbols like 태극기).
  const settingsClient = createSupabaseServiceClient();
  const adminPrompt = await fetchAdminSystemPrompt(settingsClient);

  const merged = mergePrompt(job.prompt, schoolProfile, job.schoolProfileApplied);
  const withAdmin = adminPrompt ? `${adminPrompt}\n\n${merged}` : merged;
  const finalPrompt = isDiversityChunk ? applyDiversityHint(withAdmin, order) : withAdmin;

  const chaining = !!job.referenceImageId;
  if (chaining && !referenceImage) {
    throw new Error('chaining job requires referenceImage bytes');
  }

  const gen = await adapter.generate({
    prompt: finalPrompt,
    mode: chaining ? 'img2img' : 'text2img',
    referenceImage: referenceImage ?? undefined,
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
    generation_mode: chaining ? 'img2img' : 'text2img',
    reference_image_id: job.referenceImageId,
    parent_image_id: job.referenceImageId,
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

async function fetchAdminSystemPrompt(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
): Promise<string> {
  const { data } = await supabase
    .from('admin_settings')
    .select('system_prompt')
    .eq('id', 1)
    .maybeSingle();
  return ((data?.system_prompt as string) ?? '').trim();
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
