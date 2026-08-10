// 운영 통계 timezone 은 Asia/Seoul 로 고정.
// UTC Date 를 반환하되, 반환값은 그 시각을 KST 로 해석했을 때의 boundary.
//
// 예 (현재 시각이 2026-08-10 05:00 UTC = 14:00 KST 일 때):
//   startOfKstDay()  → 2026-08-09 15:00 UTC ( = 2026-08-10 00:00 KST )
//   startOfKstWeek() → 그 주 월요일 00:00 KST 를 UTC 로
//   startOfKstMonth()→ 그 달 1일 00:00 KST 를 UTC 로
//
// 사용처: Supabase 조회 필터 `created_at >= boundary.toISOString()`

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function nowInKst(): Date {
  return new Date(Date.now() + KST_OFFSET_MS);
}

function toUtcFromKstFields(y: number, mZeroBased: number, d: number): Date {
  // KST 로 표기된 값 (y-m-d 00:00) 을 UTC 시각으로 되돌린다.
  return new Date(Date.UTC(y, mZeroBased, d, 0, 0, 0) - KST_OFFSET_MS);
}

export function startOfKstDay(): Date {
  const kst = nowInKst();
  return toUtcFromKstFields(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
}

export function startOfKstWeek(): Date {
  // 월요일 기준 (ISO 8601). getUTCDay(): 0=일, 1=월, ..., 6=토.
  const kst = nowInKst();
  const day = kst.getUTCDay();
  const daysToMonday = day === 0 ? 6 : day - 1;
  return toUtcFromKstFields(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate() - daysToMonday,
  );
}

export function startOfKstMonth(): Date {
  const kst = nowInKst();
  return toUtcFromKstFields(kst.getUTCFullYear(), kst.getUTCMonth(), 1);
}
