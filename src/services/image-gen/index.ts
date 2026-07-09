// Design Ref: §8.1 model selector — single point to swap primary/fallback
// Prompt merge helper honors §9 Behavior Rule 3 (School Profile applied only
// when the row exists AND the caller opts in).

import { fluxImageGen } from './flux';
import { openaiImageGen } from './openai';

import type { ImageGenAdapter } from './adapter';
import type { SchoolProfile } from '@/types/domain';

export type { ImageGenAdapter, GenerateInput, GenerateOutput } from './adapter';
export { ImageGenError } from './adapter';

/**
 * Primary adapter used unless caller specifies otherwise.
 * Selection order:
 *   1. IMAGE_GEN_PRIMARY env ('openai' | 'flux') — explicit override
 *   2. OPENAI_API_KEY present → OpenAI (Design §8.1 1순위)
 *   3. REPLICATE_API_TOKEN present → FLUX fallback
 *   4. OpenAI (will throw on generate() with a clear error)
 */
export function primaryAdapter(): ImageGenAdapter {
  const override = process.env.IMAGE_GEN_PRIMARY?.toLowerCase();
  if (override === 'flux') return fluxImageGen;
  if (override === 'openai') return openaiImageGen;
  if (process.env.OPENAI_API_KEY) return openaiImageGen;
  if (process.env.REPLICATE_API_TOKEN) return fluxImageGen;
  return openaiImageGen;
}

/** Fallback adapter used when primary is unavailable (e.g. UPSTREAM_UNAVAILABLE). */
export function fallbackAdapter(): ImageGenAdapter {
  return fluxImageGen;
}

/** Merge user prompt with School Profile context when enabled. */
export function mergePrompt(
  userPrompt: string,
  schoolProfile: SchoolProfile | null,
  applied: boolean,
): string {
  if (!applied || !schoolProfile) return userPrompt;

  const parts: string[] = [userPrompt];
  if (schoolProfile.styleDesc) parts.push(`Style: ${schoolProfile.styleDesc}`);
  if (schoolProfile.mascotDesc) parts.push(`Mascot context: ${schoolProfile.mascotDesc}`);
  if (schoolProfile.basePrompt) parts.push(schoolProfile.basePrompt);
  return parts.join('. ');
}

/** Simple variation prompts appended when diversity is boosted. */
const DIVERSITY_HINTS = [
  'different angle',
  'different pose',
  'different lighting',
  'wider composition',
  'closer view',
];

export function applyDiversityHint(basePrompt: string, chunkIndex: number): string {
  const hint = DIVERSITY_HINTS[chunkIndex % DIVERSITY_HINTS.length];
  return `${basePrompt}. ${hint}`;
}
