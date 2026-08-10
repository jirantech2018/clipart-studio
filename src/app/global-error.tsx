'use client';

// Next.js App Router root-level error boundary. layout 자체가 crash 하는
// 극단적인 경우 (예: ChunkLoadError 로 layout chunk 로딩 실패) 에 이 파일이
// 최종 fallback 이 된다. body/html 을 직접 렌더해야 한다.
//
// 일반적인 페이지 crash 는 (main)/error.tsx 가 먼저 잡는다.

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[global error boundary]', error);
  }, [error]);

  return (
    <html lang="ko">
      <body
        style={{
          fontFamily:
            'Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          margin: 0,
          padding: '48px 16px',
          background: '#f8fafc',
          color: '#0f172a',
        }}
      >
        <div
          style={{
            maxWidth: 480,
            margin: '0 auto',
            padding: 24,
            border: '1px solid #fecaca',
            borderRadius: 12,
            background: '#fff',
          }}
        >
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#b91c1c' }}>
            페이지를 표시할 수 없어요
          </h1>
          <p style={{ marginTop: 8, fontSize: 14, color: '#475569' }}>
            앱을 불러오는 중 문제가 생겼습니다. 새로고침하거나 잠시 후 다시 시도해주세요.
          </p>
          {error.digest && (
            <p
              style={{
                marginTop: 8,
                fontSize: 12,
                color: '#64748b',
                fontFamily: 'monospace',
              }}
            >
              error digest: {error.digest}
            </p>
          )}
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                height: 36,
                padding: '0 12px',
                borderRadius: 8,
                border: 'none',
                background: '#2d2f77',
                color: '#fff',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              다시 시도
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                height: 36,
                padding: '0 12px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                background: '#fff',
                color: '#0f172a',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              새로고침
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
