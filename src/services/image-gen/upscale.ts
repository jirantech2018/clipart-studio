// Replicate Real-ESRGAN 기반 이미지 업스케일러. FLUX 어댑터와 동일한 Prediction
// 폴링 패턴을 재사용한다. 인쇄 목적이 주된 use-case 이므로 face_enhance 는
// 기본 off (얼굴 왜곡 최소화, 학교 클립아트는 대개 일러스트).
//
// 실패는 UpscaleUpstreamError 로 감싼다. caller (route) 는 category 로 분기해
// 안전한 error code 를 클라이언트에 반환하고, 서버 로그에는 원본 status /
// body 를 그대로 남긴다.
//
// 토큰 정규화는 services/replicate/token 을 공유해 flux 와 완전히 동일한
// 문자열이 두 경로에 흐르도록 한다. 첫 호출 시 fingerprint 를 로그해 두
// 경로가 같은 토큰을 쓰는지 서버 로그에서 육안 비교 가능.

import {
  ReplicateTokenMissingError,
  replicateToken,
  replicateTokenFingerprint,
} from '@/services/replicate/token';

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

/**
 * caller 가 클라이언트에 반환할 error code 를 결정할 때 사용할 category.
 *   unconfigured    : REPLICATE_API_TOKEN 이 서버에 설정되지 않음 (500)
 *   unauthorized    : Replicate 401 — 토큰이 유효하지 않음 (503)
 *   quota           : Replicate 402 — 계정 크레딧 소진 (503)
 *   request_invalid : Replicate 422 — 입력값 / 모델 스키마 오류 (503)
 *   failed          : 그 외 (Prediction 상태 failed, 출력 다운로드 실패 등)
 */
export type UpscaleUpstreamCategory =
  | 'unconfigured'
  | 'unauthorized'
  | 'quota'
  | 'request_invalid'
  | 'failed';

export class UpscaleUpstreamError extends Error {
  category: UpscaleUpstreamCategory;
  upstreamStatus: number | null;
  constructor(
    message: string,
    category: UpscaleUpstreamCategory,
    upstreamStatus: number | null = null,
  ) {
    super(message);
    this.name = 'UpscaleUpstreamError';
    this.category = category;
    this.upstreamStatus = upstreamStatus;
  }
}

interface Prediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string | string[];
  error?: string;
  urls: { get: string };
}

// 프로세스당 1회만 fingerprint 를 로그. flux · upscale 두 경로가 완전히
// 같은 토큰을 사용하는지 서버 로그로 검증하기 위한 것.
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
