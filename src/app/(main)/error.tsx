'use client';

// Next.js App Router route-level error boundary for the (main) group.
// 특정 페이지의 client-side exception 이 나면 여기서 잡아서 페이지 전체
// crash ("Application error: a client-side exception has occurred") 대신
// 재시도 UI 를 보여준다.
//
// digest 는 Next.js 가 서버 로그와 매핑용으로 부여하는 안전한 식별자 (에러
// 원문은 노출하지 않음).

import { AlertTriangle, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

export default function MainRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 디버깅용. 브라우저 콘솔 + Railway 서버 로그 양쪽에서 찾을 수 있게 남긴다.
    // eslint-disable-next-line no-console
    console.error('[main/error boundary]', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-lg border border-destructive/30 bg-card p-6 text-sm">
      <div className="inline-flex items-center gap-2 text-destructive">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        <span className="font-semibold">일시적인 오류가 발생했어요</span>
      </div>
      <p className="text-muted-foreground">
        페이지를 표시하는 중 문제가 생겼습니다. 잠시 후 다시 시도하거나 새로고침해주세요.
        문제가 반복되면 관리자에게 아래 코드를 알려주시면 원인 파악에 도움이 됩니다.
      </p>
      {error.digest && (
        <div className="rounded-md bg-muted/60 px-3 py-2 text-xs">
          <span className="text-muted-foreground">error digest:</span>{' '}
          <span className="font-mono">{error.digest}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          다시 시도
        </button>
        <Link
          href="/organizations"
          className="inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm hover:bg-accent"
        >
          워크스페이스로 이동
        </Link>
      </div>
    </div>
  );
}
