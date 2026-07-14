// gpt-image-2 /images/edits 는 PNG/WebP만 받고 4MB 이하만 허용한다.
// 사용자가 업로드한 임의의 이미지를 그 제약에 맞춰 변환한다:
//   - JPG/AVIF/HEIC 등 → PNG로 재인코딩
//   - 4MB 초과 시 긴 변 최대 2048px로 리사이즈
//   - EXIF 회전 정보 반영 후 스트립
//
// 반환은 항상 PNG 바이너리. width/height는 최종 픽셀 값을 그대로 돌려준다.

import sharp from 'sharp';

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_LONG_EDGE = 2048;

export interface NormalizedReference {
  bytes: Buffer;
  contentType: 'image/png';
  width: number;
  height: number;
}

export async function normalizeReferenceImage(input: Buffer): Promise<NormalizedReference> {
  let pipeline = sharp(input, { failOn: 'none' }).rotate();

  const meta = await pipeline.metadata();
  if (!meta.width || !meta.height) {
    throw new Error('이미지 크기를 읽지 못했어요');
  }

  const longEdge = Math.max(meta.width, meta.height);
  if (longEdge > MAX_LONG_EDGE) {
    pipeline = pipeline.resize({
      width: meta.width >= meta.height ? MAX_LONG_EDGE : undefined,
      height: meta.height > meta.width ? MAX_LONG_EDGE : undefined,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  let bytes = await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });

  if (bytes.data.byteLength > MAX_BYTES) {
    const shrinkFactor = Math.sqrt(MAX_BYTES / bytes.data.byteLength);
    const nextLongEdge = Math.max(512, Math.floor(longEdge * shrinkFactor));
    bytes = await sharp(input, { failOn: 'none' })
      .rotate()
      .resize({
        width: meta.width >= meta.height ? nextLongEdge : undefined,
        height: meta.height > meta.width ? nextLongEdge : undefined,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
  }

  return {
    bytes: bytes.data,
    contentType: 'image/png',
    width: bytes.info.width,
    height: bytes.info.height,
  };
}
