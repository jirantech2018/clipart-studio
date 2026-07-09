// Design Ref: §8.1 AI (1순위) OpenAI gpt-image-1
// Supports text2img and img2img. Uses fetch directly (no SDK) to keep bundle lean
// and to make it trivial to swap the base URL for a proxy (e.g. sk-jiran- gateway).

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

async function callGenerations(body: unknown) {
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

  const json = (await res.json()) as { data: Array<{ b64_json?: string; url?: string }> };
  const first = json.data?.[0];
  if (!first) throw new ImageGenError('OpenAI empty response', false);
  return first;
}

async function toBytes(payload: { b64_json?: string; url?: string }): Promise<Buffer> {
  if (payload.b64_json) return Buffer.from(payload.b64_json, 'base64');
  if (payload.url) {
    const r = await fetch(payload.url);
    if (!r.ok) throw new ImageGenError(`Image download failed: ${r.status}`, true);
    return Buffer.from(await r.arrayBuffer());
  }
  throw new ImageGenError('OpenAI response missing image data', false);
}

export const openaiImageGen: ImageGenAdapter = {
  model: 'gpt-image-1',
  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const seed = input.seed ?? randomSeed();
    const body = {
      model: 'gpt-image-1',
      prompt: input.prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
    };
    // Note: gpt-image-1 currently ignores explicit seeds; we still record one
    // for local traceability and for compatibility with adapters that honor it.
    const payload = await callGenerations(body);
    const imageBytes = await toBytes(payload);
    return {
      imageBytes,
      contentType: 'image/png',
      seed,
      model: 'gpt-image-1',
    };
  },
};
