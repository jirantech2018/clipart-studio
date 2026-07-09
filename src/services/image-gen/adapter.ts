// Design Ref: §9.4 Infrastructure — ImageGenAdapter interface
// Adapter segregation: features/* only know this interface, never the impls.
// This lets us swap gpt-image-1 ↔ FLUX with a one-line change in ./index.ts.

import type { GenerationMode, ImageModel } from '@/types/domain';

export interface GenerateInput {
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  /** Reference image bytes for img2img (base64 data URL or raw base64). */
  referenceImage?: string;
  mode: GenerationMode;
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
