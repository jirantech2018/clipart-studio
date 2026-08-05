// Design Ref: §6.1 Error Code Definition — unified server error responses

import { NextResponse } from 'next/server';

import type { ApiError } from '@/types/api';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INSUFFICIENT_CREDITS'
  | 'ACTIVE_JOB_EXISTS'
  | 'UPSTREAM_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  // Package job 전용 세분화. 서버 콘솔에는 supabase 상세를 기록하되
  // 클라이언트에는 아래 안전 코드만 노출한다.
  | 'PACKAGE_JOB_INSERT_FAILED'
  | 'PACKAGE_SLOT_INSERT_FAILED'
  | 'PACKAGE_SCHEMA_NOT_READY'
  // Upscale (Replicate Real-ESRGAN) 전용. 서버 로그에는 Replicate 원본 status
  // / body 를 남기되 클라이언트에는 아래 안전 코드 + 공통 안내 메시지만.
  | 'UPSCALE_UPSTREAM_UNCONFIGURED'
  | 'UPSCALE_UPSTREAM_UNAUTHORIZED'
  | 'UPSCALE_UPSTREAM_QUOTA'
  | 'UPSCALE_REQUEST_INVALID'
  | 'UPSCALE_UPSTREAM_FAILED';

const STATUS_MAP: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INSUFFICIENT_CREDITS: 402,
  ACTIVE_JOB_EXISTS: 409,
  UPSTREAM_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  PACKAGE_JOB_INSERT_FAILED: 500,
  PACKAGE_SLOT_INSERT_FAILED: 500,
  PACKAGE_SCHEMA_NOT_READY: 503,
  UPSCALE_UPSTREAM_UNCONFIGURED: 500,
  UPSCALE_UPSTREAM_UNAUTHORIZED: 503,
  UPSCALE_UPSTREAM_QUOTA: 503,
  UPSCALE_REQUEST_INVALID: 503,
  UPSCALE_UPSTREAM_FAILED: 503,
};

export function apiError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
) {
  const body: { error: ApiError } = { error: { code, message, ...(details && { details }) } };
  return NextResponse.json(body, { status: STATUS_MAP[code] });
}

export function apiOk<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}
