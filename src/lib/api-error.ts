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
  | 'INTERNAL_ERROR';

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
