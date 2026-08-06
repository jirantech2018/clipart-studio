// Lanczos3 기반 무료 업스케일 어댑터.
//
// Sharp (libvips) 의 Lanczos3 리샘플링 커널을 사용한다. AI 모델과 달리
// 새 픽셀을 만들어내지 않지만, 학교 클립아트처럼 벡터적 특성이 강한 소재는
// Lanczos3 만으로도 인쇄 표준 (약 4096px) 까지 충분한 품질이 나온다.
// CPU 만 사용해 밀리초 수준으로 끝난다 (외부 요금 없음).
//
// 안전 상한:
//   - 출력 한 변이 8192px 를 넘으면 request_invalid 로 거부.
//     Railway 컨테이너 메모리 안정성 확보. 원본이 gpt-image-1 최대
//     (1024x1536) 이면 4x=6144 로 상한 안쪽에 안전하게 들어온다.
//   - PNG 인코딩 시 알파 채널은 sharp 가 자동 유지.

import sharp from 'sharp';

import {
  UpscaleUpstreamError,
  type UpscaleAdapter,
  type UpscaleInput,
  type UpscaleResult,
} from './adapter';

const MAX_OUTPUT_DIMENSION = 8192;

async function fetchSource(imageUrl: string): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetch(imageUrl);
  } catch (err) {
    throw new UpscaleUpstreamError(
      `source fetch failed: ${err instanceof Error ? err.message : 'unknown'}`,
      'failed',
    );
  }
  if (!res.ok) {
    throw new UpscaleUpstreamError(
      `source download failed: ${res.status}`,
      'failed',
      res.status,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

export const lanczosUpscaler: UpscaleAdapter = {
  name: 'lanczos',
  creditCost() {
    return 0;
  },
  async upscale({ imageUrl, scale }: UpscaleInput): Promise<UpscaleResult> {
    const source = await fetchSource(imageUrl);

    let sourceWidth: number;
    let sourceHeight: number;
    try {
      const meta = await sharp(source).metadata();
      if (!meta.width || !meta.height) {
        throw new UpscaleUpstreamError('source metadata missing', 'failed');
      }
      sourceWidth = meta.width;
      sourceHeight = meta.height;
    } catch (err) {
      if (err instanceof UpscaleUpstreamError) throw err;
      throw new UpscaleUpstreamError(
        `sharp metadata failed: ${err instanceof Error ? err.message : 'unknown'}`,
        'failed',
      );
    }

    const targetWidth = sourceWidth * scale;
    const targetHeight = sourceHeight * scale;

    if (targetWidth > MAX_OUTPUT_DIMENSION || targetHeight > MAX_OUTPUT_DIMENSION) {
      throw new UpscaleUpstreamError(
        `output size ${targetWidth}x${targetHeight} exceeds limit ${MAX_OUTPUT_DIMENSION}`,
        'request_invalid',
      );
    }

    try {
      const bytes = await sharp(source)
        .resize({
          width: targetWidth,
          height: targetHeight,
          kernel: 'lanczos3',
          fit: 'fill',
        })
        .png({ compressionLevel: 6 })
        .toBuffer();
      return { bytes, contentType: 'image/png' };
    } catch (err) {
      throw new UpscaleUpstreamError(
        `sharp resize failed: ${err instanceof Error ? err.message : 'unknown'}`,
        'failed',
      );
    }
  },
};
