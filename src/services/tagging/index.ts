// Public entry point for the tagging service. Keep provider selection here so
// pipeline callers don't need to know which model is in use.

import { openaiTaggingAdapter } from './openai';

import type { TaggingAdapter } from './adapter';

export type { TaggingAdapter, TaggingInput, TaggingResult } from './adapter';
export { TaggingError } from './adapter';
export { SCHOOL_CATEGORIES, type SchoolCategory } from './categories';

export function taggingAdapter(): TaggingAdapter {
  // Same key as image generation. If tagging needs a distinct provider later,
  // add TAGGING_PRIMARY env switch here (mirroring IMAGE_GEN_PRIMARY).
  return openaiTaggingAdapter;
}
