'use client';

// 값이 delay 만큼 안정된 뒤에야 리렌더에 반영되는 hook.
// prompt 처럼 사용자가 계속 타이핑하는 값을 upstream 호출용으로 낮은 주기로 샘플링할 때.

import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}
