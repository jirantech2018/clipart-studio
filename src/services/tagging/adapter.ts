// Design Ref: §8.1 Tagging adapter interface — swap-in point for provider changes.
// The tagger receives the original user prompt (+ optional school context) and
// returns a small set of Korean tags plus 1-2 fixed school categories.

import type { SchoolCategory } from './categories';

export interface TaggingInput {
  /** Original user prompt (before merge/diversity). */
  prompt: string;
  /** School Profile stylistic hint if the user opted in on this job. */
  schoolContext?: string | null;
}

export interface TaggingResult {
  /** 3-7 free-form Korean tags. Deduplicated, trimmed. */
  tags: string[];
  /** 1-2 categories from the fixed SCHOOL_CATEGORIES list. */
  categories: SchoolCategory[];
}

export interface TaggingAdapter {
  /** Provider name for logging / model column. */
  provider: string;
  tag(input: TaggingInput): Promise<TaggingResult>;
}

export class TaggingError extends Error {
  constructor(
    message: string,
    public recoverable = false,
  ) {
    super(message);
    this.name = 'TaggingError';
  }
}
