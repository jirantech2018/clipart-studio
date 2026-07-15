// Design Ref: §9.4 Infrastructure — ImageGenAdapter interface
// Adapter segregation: features/* only know this interface, never the impls.
// This lets us swap gpt-image-1 ↔ FLUX with a one-line change in ./index.ts.

import type { GenerationMode, ImageModel } from '@/types/domain';

export interface ReferenceImage {
  bytes: Buffer;
  contentType: string;
}

export interface GenerateInput {
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  /**
   * Reference images sent to /v1/images/edits. gpt-image-2 accepts up to 16
   * images per request; caller is responsible for staying within that cap.
   * First image is the mask target (per OpenAI docs). Required when
   * mode === 'img2img'.
   *
   * The single-image referenceImage below is retained as a convenience alias
   * so callers migrating from the old signature keep working.
   */
  referenceImages?: ReferenceImage[];
  /** @deprecated Use referenceImages. Kept for backward compat; treated as [it]. */
  referenceImage?: ReferenceImage;
  mode: GenerationMode;
  /** Exact 'WxH' string the API expects (e.g. '1024x1024', '1536x1024'). */
  size?: string;
}

export interface GenerateOutput {
  /** Raw image bytes (PNG or WebP). Caller uploads to R2. */
  imageBytes: Buffer;
  /** MIME type of imageBytes. */
  contentType: string;
  /** Seed actually used (for reproducibility). */
  seed: number;
  /** Model tag stored on the image row. */
  model: ImageModel;
}

export class ImageGenError extends Error {
  constructor(
    message: string,
    public readonly upstream: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ImageGenError';
  }
}

export interface ImageGenAdapter {
  readonly model: ImageModel;
  /** Generates one image. Throws ImageGenError on failure. */
  generate(input: GenerateInput): Promise<GenerateOutput>;
}
