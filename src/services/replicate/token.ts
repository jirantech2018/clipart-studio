// Replicate API 인증 토큰 공용 접근점.
//
// 이전에는 flux.ts / upscale.ts 가 각자 다른 형태의 token() 을 갖고 있었다:
//   - flux.ts    : process.env.REPLICATE_API_TOKEN 그대로 사용
//   - upscale.ts : trim + wrapping quotes strip 을 거친 값 사용
// 두 경로가 서로 다른 정규화를 거치면 동일한 env 를 봐도 서버에 나가는 값이
// 달라져 진단이 어려워진다. 이 파일이 유일한 정규화 지점이며, 두 caller 는
// 이 함수만 호출해야 한다.
//
// 또한 fingerprint() 는 서버 로그에 안전하게 남길 수 있는 축약 식별자를
// 만든다 (length + prefix 3자 + SHA-256 앞 8자리). 이 값을 flux · upscale
// 두 지점에서 함께 로그하면 "정말 같은 토큰이 나가는가" 를 원문 노출 없이
// 비교할 수 있다.

import { createHash } from 'node:crypto';

/**
 * 시작과 끝이 같은 종류의 따옴표로 감싸진 경우에만 그 한 쌍을 제거.
 * mismatched 인 경우 (예: "abc') 는 손대지 않는다. 토큰 내부 문자열도
 * 절대 변경하지 않는다.
 */
function stripMatchingWrappingQuotes(s: string): string {
  if (s.length < 2) return s;
  const first = s[0];
  const last = s[s.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return s.slice(1, -1);
  }
  return s;
}

export class ReplicateTokenMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplicateTokenMissingError';
  }
}

/**
 * REPLICATE_API_TOKEN 을 정규화해서 반환. 미설정이면 throw.
 * Railway Variables UI 에서 흔히 섞이는 앞뒤 공백 · 줄바꿈 · 감싼 따옴표를
 * 제거한다. 안쪽 문자열은 절대 건드리지 않는다.
 */
export function replicateToken(): string {
  const raw = process.env.REPLICATE_API_TOKEN;
  if (!raw) {
    throw new ReplicateTokenMissingError('REPLICATE_API_TOKEN missing');
  }
  const cleaned = stripMatchingWrappingQuotes(raw.trim());
  if (!cleaned) {
    throw new ReplicateTokenMissingError('REPLICATE_API_TOKEN empty');
  }
  return cleaned;
}

/**
 * 서버 로그에 남길 수 있는 안전한 토큰 식별자. 원문은 절대 로그하지 않는다.
 *   len=<length> prefix=<앞 3자>... sha8=<sha256 앞 8자리>
 *
 * 두 caller (flux · upscale) 에서 이 값을 같이 로그하면 실제로 identical
 * 한 토큰을 보내고 있는지 검증할 수 있다.
 */
export function replicateTokenFingerprint(token: string): string {
  const sha8 = createHash('sha256').update(token).digest('hex').slice(0, 8);
  const prefix = token.slice(0, 3);
  return `len=${token.length} prefix=${prefix}... sha8=${sha8}`;
}
