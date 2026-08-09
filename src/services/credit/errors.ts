// Plan v0.2.8 §M3-3: Credit Service 신규 에러 계층.
//
// 원칙: 서버가 검증된 Job.organization_id 를 기준으로 Pool 을 resolve 한다.
// 클라이언트가 pool_id 를 넘기지 않는다.

export class InsufficientPoolBalanceError extends Error {
  constructor(public readonly organizationId?: string) {
    super('INSUFFICIENT_POOL_BALANCE');
    this.name = 'InsufficientPoolBalanceError';
  }
}

export class PoolNotFoundError extends Error {
  constructor(public readonly organizationId?: string) {
    super('POOL_NOT_FOUND');
    this.name = 'PoolNotFoundError';
  }
}

/**
 * @deprecated Legacy 호출부 호환. 신규 코드는 InsufficientPoolBalanceError 를
 * 사용한다. Legacy wrapper 는 이 예외 형태를 그대로 던져 기존 호출자와의
 * 시그니처 호환을 유지한다.
 */
export class InsufficientCreditsError extends Error {
  constructor() {
    super('INSUFFICIENT_CREDITS');
    this.name = 'InsufficientCreditsError';
  }
}
