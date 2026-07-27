// Replicate Real-ESRGAN 기반 이미지 업스케일러. FLUX 어댑터와 동일한 Prediction
// 폴링 패턴을 재사용한다. 인쇄 목적이 주된 use-case 이므로 face_enhance 는
// 기본 off (얼굴 왜곡 최소화, 학교 클립아트는 대개 일러스트).

const REPLICATE_URL = 'https://api.replicate.com/v1/predictions';
// nightmareai/real-esrgan — 오랜기간 안정적으로 유지되는 4x 슈퍼 리솔루션 모델.
// scale param 으로 2 / 4 를 선택할 수 있다.
const REAL_ESRGAN_VERSION =
  '350d32041630ffbe63c8352783a26d94126809164e54085352f8326e53999085';

const REPLICATE_TIMEOUT_MS = 120_000; // 4x 는 20-40초 걸리는 편, 여유 있게 2분

export type UpscaleScale = 2 | 4;

export interface UpscaleResult {
  bytes: Buffer;
  contentType: 'image/png';
}

interface Prediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string | string[];
  error?: string;
  urls: { get: string };
}

function token(): string {
  const t = process.env.REPLICATE_API_TOKEN;
  if (!t) throw new Error('REPLICATE_API_TOKEN missing');
  return t;
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
      headers: { Authorization: `Token ${token()}` },
    });
    if (!res.ok) throw new Error(`Replicate poll failed: ${res.status}`);
    current = (await res.json()) as Prediction;
  }
  return current;
}

/**
 * 이미지 URL 을 Real-ESRGAN 으로 업스케일. 결과는 PNG buffer.
 * 소스 URL 은 Replicate 가 직접 가져가므로 R2 public URL 을 그대로 넘긴다.
 */
export async function upscaleFromUrl(
  imageUrl: string,
  scale: UpscaleScale,
): Promise<UpscaleResult> {
  const startRes = await fetch(REPLICATE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Token ${token()}`,
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
    throw new Error(`Replicate start failed: ${startRes.status} ${text.slice(0, 300)}`);
  }

  let pred = (await startRes.json()) as Prediction;
  pred = await pollUntilDone(pred);
  if (pred.status !== 'succeeded') {
    throw new Error(`upscale status=${pred.status} error=${pred.error ?? 'unknown'}`);
  }

  const outUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!outUrl) throw new Error('upscale output missing');
  const dl = await fetch(outUrl);
  if (!dl.ok) throw new Error(`upscale output download failed: ${dl.status}`);
  const bytes = Buffer.from(await dl.arrayBuffer());
  return { bytes, contentType: 'image/png' };
}
