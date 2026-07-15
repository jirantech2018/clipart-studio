// Design Ref: §2.2 Data Flow — batch generation pipeline
// Given a job spec, run one image end-to-end: generate → upload → insert row.
// Isolated here so routes can call it in chunks without duplicating orchestration.

import { randomUUID } from 'node:crypto';

import { primaryAdapter, applyDiversityHint, mergePrompt } from '@/services/image-gen';
import { composeKnowledgePrompt } from '@/services/knowledge';
import { composeRules } from '@/services/prompt-rules';
import { assembleFinalPrompt } from '@/services/prompt-structuring';
import { publicUrl, putObject } from '@/services/r2/upload';
import { createSupabaseServiceClient } from '@/services/supabase/server';
import { taggingAdapter } from '@/services/tagging';
import { ASPECT_RATIO_DIMENSIONS, aspectRatioSizeString } from '@/types/domain';

import type { ReferenceImage } from '@/services/image-gen';
import type { KnowledgeMatch } from '@/services/knowledge';
import type { StructuredPrompt } from '@/services/prompt-structuring';
import type { GenerationJob, PromptRule, SchoolProfile } from '@/types/domain';

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
  /** Preloaded structured prompt for the batch; caller runs structurePrompt() once. */
  structuredPrompt?: StructuredPrompt | null;
  /**
   * Knowledge matches for this batch (Phase C). When present and non-empty,
   * Knowledge composer takes over: description + negative_prompt from each
   * matched Knowledge is injected, and the primary positive image of each
   * (up to KNOWLEDGE_API_IMAGE_LIMIT) is loaded from R2 and attached to
   * gpt-image-2 /edits alongside the user's own reference image.
   */
  knowledgeMatches?: KnowledgeMatch[];
  /** Preloaded knowledge reference image bytes (parallel to the R2 keys in
   * composeKnowledgePrompt().referenceImageKeys). Fetched once per batch. */
  knowledgeReferenceImages?: ReferenceImage[];
  /** Active prompt rules — used only when Knowledge yields zero matches. */
  promptRules?: PromptRule[];
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

  return fetchReferenceImageByKey(row.r2_key as string);
}

/**
 * Load reference bytes directly from an R2 key. Used for user-uploaded
 * reference slots where the job stores the R2 key snapshot instead of a
 * library image id.
 */
export async function fetchReferenceImageByKey(r2Key: string): Promise<ReferenceImage> {
  const url = publicUrl(r2Key);
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
  structuredPrompt,
  knowledgeMatches,
  knowledgeReferenceImages,
  promptRules,
}: RunOneParams): Promise<PipelineResult> {
  const adapter = primaryAdapter();

  const merged = mergePrompt(job.prompt, schoolProfile, job.schoolProfileApplied);
  // 사용자 자연어를 structurePrompt 결과로 라벨링된 형식으로 재조립. structuredPrompt
  // 없으면 원본 그대로.
  const userSection = structuredPrompt
    ? assembleFinalPrompt(merged, structuredPrompt)
    : merged;

  // 조합 우선순위 (Phase C):
  //   1) Knowledge 매칭이 있으면 → Knowledge 시스템 사용 (description + negative
  //      + positive 대표 이미지 첨부)
  //   2) 매칭 0개면 → prompt_rules 시스템 (기존 흐름) 그대로 유지
  //   3) prompt_rules 도 비어 있으면 → 옛 admin_settings.system_prompt fallback
  let finalPrompt: string;
  const usingKnowledge = !!knowledgeMatches && knowledgeMatches.length > 0;
  if (usingKnowledge) {
    const composed = composeKnowledgePrompt(knowledgeMatches!, userSection);
    finalPrompt = composed.prompt;
    console.log(
      `[knowledge] job=${job.id} order=${order} applied=[${composed.appliedKnowledgeIds.join(',')}] refImages=${composed.referenceImageKeys.length} len=${composed.prompt.length}`,
    );
  } else if (promptRules && promptRules.length > 0) {
    const composed = composeRules({ rules: promptRules, userSection });
    finalPrompt = composed.prompt;
    console.log(
      `[prompt-rules] job=${job.id} order=${order} applied=[${composed.appliedRuleIds.join(',')}] dropped=[${composed.droppedRuleIds.join(',')}] len=${composed.prompt.length}`,
    );
  } else {
    const settingsClient = createSupabaseServiceClient();
    const legacyAdminPrompt = await fetchAdminSystemPrompt(settingsClient);
    finalPrompt = legacyAdminPrompt
      ? `${legacyAdminPrompt}\n\n${userSection}`
      : userSection;
  }

  if (isDiversityChunk) {
    finalPrompt = applyDiversityHint(finalPrompt, order);
  }

  const chaining = !!job.referenceImageId;
  const customReference = !!job.customReferenceR2Key;
  const userProvidedReference = chaining || customReference;

  // 이미지 배열 조립: 사용자의 참고 이미지가 있으면 그것을 첫 번째로 (mask 대상),
  // 그 뒤에 Knowledge positive 대표 이미지들을 append.
  const referenceImages: ReferenceImage[] = [];
  if (userProvidedReference) {
    if (!referenceImage) {
      throw new Error('img2img job requires referenceImage bytes');
    }
    referenceImages.push(referenceImage);
  }
  if (usingKnowledge && knowledgeReferenceImages) {
    for (const img of knowledgeReferenceImages) {
      referenceImages.push(img);
    }
  }

  const imgToImg = referenceImages.length > 0;

  const size = aspectRatioSizeString(job.aspectRatio);
  const dims = ASPECT_RATIO_DIMENSIONS[job.aspectRatio];

  const gen = await adapter.generate({
    prompt: finalPrompt,
    mode: imgToImg ? 'img2img' : 'text2img',
    referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
    size,
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
    generation_mode: imgToImg ? 'img2img' : 'text2img',
    reference_image_id: job.referenceImageId,
    parent_image_id: job.referenceImageId,
    school_profile_applied: job.schoolProfileApplied,
    status: 'saved',
    pending_expires_at: null,
    width: dims.width,
    height: dims.height,
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
