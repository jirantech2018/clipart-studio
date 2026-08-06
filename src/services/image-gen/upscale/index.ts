// Upscale provider selector.
//
// UPSCALE_PROVIDER env 를 읽어 lanczos / replicate 어댑터를 선택.
// Route 는 이 함수만 호출하고, 크레딧 비용 결정 · 실제 확대 로직은 모두
// 어댑터가 담당.
//
// 값 인식 규칙:
//   - 미설정 → 'lanczos' (운영 기본값)
//   - trim + lowercase 후 'replicate' → replicate adapter
//   - 그 외 (오타 · 예상 밖 값) → 'lanczos' 로 안전하게 fallback

import { lanczosUpscaler } from './lanczos';
import { replicateUpscaler } from './replicate';

import type { UpscaleAdapter } from './adapter';

export * from './adapter';
export { lanczosUpscaler, replicateUpscaler };

export function primaryUpscaler(): UpscaleAdapter {
  const raw = process.env.UPSCALE_PROVIDER?.trim().toLowerCase() ?? '';
  if (raw === 'replicate') return replicateUpscaler;
  return lanczosUpscaler;
}
