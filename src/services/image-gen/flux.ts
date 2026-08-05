// Design Ref: §8.1 AI (2순위) FLUX schnell via Replicate — cost fallback
//
// 공용 Replicate 토큰 헬퍼 (services/replicate/token) 를 사용해 upscale.ts
// 와 완전히 동일한 정규화·인증 경로를 공유한다. Authorization 스키마도
// Replicate 공식 문서에 맞춰 Bearer 로 통일.

import { ImageGenError } from './adapter';
import {
  ReplicateTokenMissingError,
  replicateToken,
  replicateTokenFingerprint,
} from '@/services/replicate/token';

import type { GenerateInput, GenerateOutput, ImageGenAdapter } from './adapter';

const REPLICATE_URL = 'https://api.replicate.com/v1/predictions';
const FLUX_MODEL_VERSION = 'black-forest-labs/flux-schnell';

// 프로세스당 1회만 fingerprint 를 로그해서 flux · upscale 의 값을 비교하기
// 쉽게 한다. 매 요청마다 노이즈를 남기지 않도록 module-level flag.
let fingerprintLogged = false;

function token(): string {
  try {
    const t = replicateToken();
    if (!fingerprintLogged) {
      fingerprintLogged = true;
      console.log(
        '[replicate/flux] token fingerprint',
        replicateTokenFingerprint(t),
      );
    }
    return t;
  } catch (err) {
    if (err instanceof ReplicateTokenMissingError) {
      // FLUX caller 는 ImageGenError 로 흐름을 이어받는다 (retryable=false).
      throw new ImageGenError(err.message, false);
    }
    throw err;
  }
}

interface Prediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string[] | string;
  error?: string;
  urls: { get: string };
}

async function startPrediction(input: GenerateInput): Promise<Prediction> {
  const res = await fetch(REPLICATE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      Prefer: 'wait',
    },
    body: JSON.stringify({
      model: FLUX_MODEL_VERSION,
      input: {
        prompt: input.prompt,
        seed: input.seed,
        num_outputs: 1,
        aspect_ratio: '1:1',
        output_format: 'webp',
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ImageGenError(
      `Replicate start failed: ${res.status} ${text.slice(0, 300)}`,
      res.status >= 500 || res.status === 429,
    );
  }
  return (await res.json()) as Prediction;
}

async function pollUntilDone(pred: Prediction, timeoutMs = 60_000): Promise<Prediction> {
  if (pred.status === 'succeeded' || pred.status === 'failed') return pred;
  const start = Date.now();
  let current = pred;
  while (
    (current.status === 'starting' || current.status === 'processing') &&
    Date.now() - start < timeoutMs
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(current.urls.get, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!res.ok) throw new ImageGenError(`Replicate poll failed: ${res.status}`, true);
    current = (await res.json()) as Prediction;
  }
  return current;
}

async function downloadOutput(pred: Prediction): Promise<Buffer> {
  const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!url) throw new ImageGenError('FLUX output missing', false);
  const r = await fetch(url);
  if (!r.ok) throw new ImageGenError(`Output download failed: ${r.status}`, true);
  return Buffer.from(await r.arrayBuffer());
}

export const fluxImageGen: ImageGenAdapter = {
  model: 'flux-schnell',
  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const seed = input.seed ?? Math.floor(Math.random() * 2 ** 31);
    let pred = await startPrediction({ ...input, seed });
    pred = await pollUntilDone(pred);
    if (pred.status !== 'succeeded') {
      throw new ImageGenError(`FLUX status=${pred.status} error=${pred.error}`, true);
    }
    const imageBytes = await downloadOutput(pred);
    return {
      imageBytes,
      contentType: 'image/webp',
      seed,
      model: 'flux-schnell',
    };
  },
};
