// Phase 0 이미지 로더 — sample 산출물에 들어갈 클립아트/로고를 로컬 파일에서
// buffer 로 읽는다. 실서비스 (Phase 1+) 에서는 R2 URL 을 fetch 하도록 확장.
//
// image.source 별 해석 규칙 (Phase 0):
//   - 'external' : file:// URL 또는 http(s) URL. 로컬 절대·상대 경로도 허용.
//   - 'clipart'  : Phase 1 에서 images 테이블 조회 후 R2 URL 로 매핑. 지금은 파일 경로 fallback.
//   - 'ai'       : Phase 1 에서 generation 조회. 지금은 파일 경로 fallback.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface LoadedImage {
  buffer: Buffer;
  mime: ImageMime;
  /** base64 data URL — HTML/PPTX 에 삽입할 때 사용. */
  dataUrl: string;
}

function detectMime(assetRef: string): ImageMime {
  const ext = path.extname(assetRef).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

export async function loadImage(assetRef: string): Promise<LoadedImage> {
  // http(s) 이면 fetch, 아니면 로컬 파일 읽기.
  if (assetRef.startsWith('http://') || assetRef.startsWith('https://')) {
    const res = await fetch(assetRef);
    if (!res.ok) throw new Error(`이미지 로드 실패: ${assetRef} (${res.status})`);
    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const mime = detectMime(assetRef);
    return { buffer, mime, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
  }

  // 로컬 파일 — 프로젝트 루트 기준으로 해석.
  const absPath = path.isAbsolute(assetRef)
    ? assetRef
    : path.resolve(process.cwd(), assetRef);
  const buffer = await readFile(absPath);
  const mime = detectMime(absPath);
  return { buffer, mime, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
}
