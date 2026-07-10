'use client';

// Small IntersectionObserver hook — call `callback` whenever the returned ref
// element enters the viewport. Used by infinite-scroll sentinels.

import { useEffect, useRef } from 'react';

interface Options {
  rootMargin?: string;
  enabled?: boolean;
}

export function useIntersection(
  callback: () => void,
  { rootMargin = '400px', enabled = true }: Options = {},
) {
  const ref = useRef<HTMLDivElement | null>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) callbackRef.current();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, rootMargin]);

  return ref;
}
