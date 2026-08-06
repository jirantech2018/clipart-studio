// Replicate Real-ESRGAN 기반 AI 업스케일 어댑터.
//
// 현재 default provider 는 lanczos. 이 파일은 삭제하지 않고 유지한다.
// Railway Variables 에 UPSCALE_PROVIDER=replicate 를 설정하면 index.ts
// 의 primaryUpscaler() 가 이 어댑터를 선택한다.
//
// FLUX 어댑터와 동일한 Prediction 폴링 패턴 · 동일한 replicateToken()
// 정규화 경로를 사용. 첫 호출 시 fingerprint 를 서버 로그에 남겨 flux 와
// 완전히 같은 토큰을 쓰는지 진단 가능.

import {
  ReplicateTokenMissingError,
  replicateToken,
  replicateTokenFingerprint,
} from '@/services/replicate/token';

import {
  UpscaleUpstreamError,
  type UpscaleAdapter,
  type UpscaleInput,
  type UpscaleResult,
  type UpscaleUpstreamCategory,
} from './adapter';

const REPLICATE_URL = 'https://api.replicate.com/v1/predictions';
// nightmareai/real-esrgan — 오랜기간 안정적으로 유지되는 4x 슈퍼 리솔루션 모델.
// scale param 으로 2 / 4 를 선택할 수 있다.
const REAL_ESRGAN_VERSION =
  '350d32041630ffbe63c8352783a26d94126809164e54085352f8326e53999085';

const REPLICATE_TIMEOUT_MS = 120_000; // 4x 는 20-40초 걸리는 편, 여유 있게 2분

interface Prediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string | string[];
  error?: string;
  urls: { get: string };
}

let fingerprintLogged = false;

function token(): string {
  try {
    const t = replicateToken();
    if (!fingerprintLogged) {
      fingerprintLogged = true;
      console.log(
        '[replicate/upscale] token fingerprint',
        replicateTokenFingerprint(t),
      );
    }
    return t;
  } catch (err) {
    if (err instanceof ReplicateTokenMissingError) {
      throw new UpscaleUpstreamError(err.message, 'unconfigured');
    }
    throw err;
  }
}

function categoryFromStatus(status: number): UpscaleUpstreamCategory {
  if (status === 401) return 'unauthorized';
  if (status === 402) return 'quota';
  if (status === 422) return 'request_invalid';
  return 'failed';
}

async function pollUntilDone(pred: Prediction): Promise<Prediction> {
  if (pred.status === 'succeeded' || pred.status === 'failed') return pred;
  const start = Date.now();
  let current = pred;
  while (
    (current.status === 'starting' || current.status === 'processing') &&
    Date.now() - start < REPLICATE_TIMEOUT_MS
  ) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(current.urls.get, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!res.ok) {
      throw new UpscaleUpstreamError(
        `Replicate poll failed: ${res.status}`,
        categoryFromStatus(res.status),
        res.status,
      );
    }
    current = (await res.json()) as Prediction;
  }
  return current;
}

async function upscaleFromUrl(imageUrl: string, scale: 2 | 4): Promise<UpscaleResult> {
  const startRes = await fetch(REPLICATE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      Prefer: 'wait',
    },
    body: JSON.stringify({
      version: REAL_ESRGAN_VERSION,
      input: {
        image: imageUrl,
        scale,
        face_enhance: false,
      },
    }),
  });

  if (!startRes.ok) {
    const text = await startRes.text().catch(() => '');
    throw new UpscaleUpstreamError(
      `Replicate start failed: ${startRes.status} ${text.slice(0, 300)}`,
      categoryFromStatus(startRes.status),
      startRes.status,
    );
  }

  let pred = (await startRes.json()) as Prediction;
  pred = await pollUntilDone(pred);
  if (pred.status !== 'succeeded') {
    throw new UpscaleUpstreamError(
      `upscale status=${pred.status} error=${pred.error ?? 'unknown'}`,
      'failed',
    );
  }

  const outUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!outUrl) {
    throw new UpscaleUpstreamError('upscale output missing', 'failed');
  }
  const dl = await fetch(outUrl);
  if (!dl.ok) {
    throw new UpscaleUpstreamError(
      `upscale output download failed: ${dl.status}`,
      'failed',
      dl.status,
    );
  }
  const bytes = Buffer.from(await dl.arrayBuffer());
  return { bytes, contentType: 'image/png' };
}

export const replicateUpscaler: UpscaleAdapter = {
  name: 'replicate-real-esrgan',
  creditCost(scale) {
    return scale === 2 ? 1 : 2;
  },
  upscale({ imageUrl, scale }: UpscaleInput) {
    return upscaleFromUrl(imageUrl, scale);
  },
};
