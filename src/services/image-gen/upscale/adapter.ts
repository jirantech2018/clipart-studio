// Upscale Provider 공통 인터페이스.
//
// 지금은 Lanczos (Sharp) 가 기본 provider. 향후 Replicate (Real-ESRGAN)
// 로 되돌리려면 route 코드는 그대로 두고 index.ts 의 primaryUpscaler() 가
// UPSCALE_PROVIDER env 를 보고 어댑터만 교체한다.
//
// UpscaleUpstreamError 는 두 provider 공용. Lanczos 는 category='failed'
// 또는 'request_invalid' 만 사용하고, Replicate 는 401/402/422 에 대응하는
// unauthorized/quota/request_invalid 를 함께 사용한다.

export type UpscaleScale = 2 | 4;

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

export interface UpscaleInput {
  imageUrl: string;
  scale: UpscaleScale;
}

export interface UpscaleResult {
  bytes: Buffer;
  contentType: 'image/png';
}

export interface UpscaleAdapter {
  /** 로그 · 관측용 provider 식별자. */
  readonly name: string;
  /**
   * scale 별 소모 크레딧. Lanczos 는 항상 0 (외부 비용 없음).
   * Replicate 는 { 2:1, 4:2 }. Route 는 이 값이 0 이면 reserve/refund 를
   * 완전히 건너뛴다.
   */
  creditCost(scale: UpscaleScale): number;
  upscale(input: UpscaleInput): Promise<UpscaleResult>;
}
