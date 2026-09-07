// Phase 0 이미지 로더 — sample 산출물에 들어갈 클립아트/로고를 로컬 파일에서
// buffer 로 읽는다. 실서비스 (Phase 1+) 에서는 R2 URL 을 fetch 하도록 확장.
//
// v2 (Phase 0.5): 원본 너비/높이를 함께 반환 → 세 렌더러가 원본 비율을 유지
// 하며 목표 폭에 맞춰 높이를 자동 계산할 수 있게 한다.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface LoadedImage {
  buffer: Buffer;
  mime: ImageMime;
  /** base64 data URL — HTML/PPTX 에 삽입할 때 사용. */
  dataUrl: string;
  /** 원본 픽셀 크기 (비율 유지에 필수). */
  width: number;
  height: number;
}

function detectMime(assetRef: string): ImageMime {
  const ext = path.extname(assetRef).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

export async function loadImage(assetRef: string): Promise<LoadedImage> {
  let buffer: Buffer;
  let mime: ImageMime;
  if (assetRef.startsWith('http://') || assetRef.startsWith('https://')) {
    const res = await fetch(assetRef);
    if (!res.ok) throw new Error(`이미지 로드 실패: ${assetRef} (${res.status})`);
    buffer = Buffer.from(await res.arrayBuffer());
    mime = detectMime(assetRef);
  } else {
    const absPath = path.isAbsolute(assetRef)
      ? assetRef
      : path.resolve(process.cwd(), assetRef);
    buffer = await readFile(absPath);
    mime = detectMime(absPath);
  }

  // 원본 dimensions — sharp 는 프로젝트에 이미 있음.
  const meta = await sharp(buffer).metadata();
  const width = meta.width ?? 800;
  const height = meta.height ?? 600;

  return {
    buffer,
    mime,
    dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
    width,
    height,
  };
}

/**
 * 대상 폭(픽셀)이 주어졌을 때 원본 비율을 유지하는 픽셀 높이를 반환.
 * maxHeight 를 초과하면 높이 기준으로 재계산해 폭도 축소.
 */
export function fitDimensions(
  original: { width: number; height: number },
  targetWidthPx: number,
  maxHeightPx?: number,
): { width: number; height: number } {
  const ratio = original.height / original.width;
  let w = targetWidthPx;
  let h = Math.round(targetWidthPx * ratio);
  if (maxHeightPx && h > maxHeightPx) {
    h = maxHeightPx;
    w = Math.round(maxHeightPx / ratio);
  }
  return { width: w, height: h };
}
