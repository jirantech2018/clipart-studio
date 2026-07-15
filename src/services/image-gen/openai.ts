// Design Ref: §8.1 AI (1순위) OpenAI gpt-image-2 (upgraded from gpt-image-1 on 2026-04-21 release)
// Supports text2img (/v1/images/generations) and img2img (/v1/images/edits).
// Uses fetch directly (no SDK) to keep bundle lean and to make it trivial to
// swap the base URL for a proxy.

import { ImageGenError } from './adapter';

import type { GenerateInput, GenerateOutput, ImageGenAdapter } from './adapter';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

function baseUrl() {
  return process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
}

function apiKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new ImageGenError('OPENAI_API_KEY missing', false);
  return key;
}

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

type ImagePayload = { b64_json?: string; url?: string };

async function callGenerations(body: unknown): Promise<ImagePayload> {
  const res = await fetch(`${baseUrl()}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ImageGenError(
      `OpenAI generations failed: ${res.status} ${text.slice(0, 300)}`,
      res.status >= 500 || res.status === 429,
    );
  }

  const json = (await res.json()) as { data: ImagePayload[] };
  const first = json.data?.[0];
  if (!first) throw new ImageGenError('OpenAI empty response', false);
  return first;
}

async function callEdits(form: FormData): Promise<ImagePayload> {
  const res = await fetch(`${baseUrl()}/images/edits`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      // Content-Type is set by fetch automatically for FormData (multipart boundary)
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ImageGenError(
      `OpenAI edits failed: ${res.status} ${text.slice(0, 300)}`,
      res.status >= 500 || res.status === 429,
    );
  }

  const json = (await res.json()) as { data: ImagePayload[] };
  const first = json.data?.[0];
  if (!first) throw new ImageGenError('OpenAI empty edits response', false);
  return first;
}

async function toBytes(payload: ImagePayload): Promise<Buffer> {
  if (payload.b64_json) return Buffer.from(payload.b64_json, 'base64');
  if (payload.url) {
    const r = await fetch(payload.url);
    if (!r.ok) throw new ImageGenError(`Image download failed: ${r.status}`, true);
    return Buffer.from(await r.arrayBuffer());
  }
  throw new ImageGenError('OpenAI response missing image data', false);
}

export const openaiImageGen: ImageGenAdapter = {
  model: 'gpt-image-2',
  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const seed = input.seed ?? randomSeed();

    const size = input.size ?? '1024x1024';

    let payload: ImagePayload;
    if (input.mode === 'img2img') {
      const refs =
        input.referenceImages && input.referenceImages.length > 0
          ? input.referenceImages
          : input.referenceImage
            ? [input.referenceImage]
            : [];
      if (refs.length === 0) {
        throw new ImageGenError('img2img requires at least one reference image', false);
      }
      const form = new FormData();
      form.append('model', 'gpt-image-2');
      form.append('prompt', input.prompt);
      form.append('n', '1');
      form.append('size', size);
      // gpt-image-2 /images/edits accepts multiple images by repeating the
      // `image` field. First image is the mask target per docs.
      refs.forEach((ref, i) => {
        const ext = ref.contentType === 'image/webp' ? 'webp' : 'png';
        const filename = `reference-${i}.${ext}`;
        const blob = new Blob([new Uint8Array(ref.bytes)], { type: ref.contentType });
        form.append('image', blob, filename);
      });
      payload = await callEdits(form);
    } else {
      // gpt-image-2 returns b64_json by default and rejects response_format.
      payload = await callGenerations({
        model: 'gpt-image-2',
        prompt: input.prompt,
        n: 1,
        size,
      });
    }

    const imageBytes = await toBytes(payload);
    return {
      imageBytes,
      contentType: 'image/png',
      seed,
      model: 'gpt-image-2',
    };
  },
};
