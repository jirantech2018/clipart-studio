'use client';

// generate 페이지 상단 헤더. h1 좌측 + '새로고침' (=이전 '새 생성 시작') 우측.
// 새로고침 버튼은 스트리밍이 끝난 뒤 (done / error) 에만 노출된다.

import { RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useGenerationStore } from '@/lib/store/generationStore';

export function GenerateHeader() {
  const streamStatus = useGenerationStore((s) => s.streamStatus);
  const reset = useGenerationStore((s) => s.reset);

  const isIdle = streamStatus === 'idle';
  const isStreaming = streamStatus === 'starting' || streamStatus === 'streaming';
  const canReset = !isIdle && !isStreaming;

  return (
    <div className="flex items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">+클립아트 만들기</h1>
      {canReset && (
        <Button type="button" variant="outline" size="sm" onClick={reset}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          새로고침
        </Button>
      )}
    </div>
  );
}
