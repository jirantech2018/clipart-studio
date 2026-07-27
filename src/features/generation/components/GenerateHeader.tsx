'use client';

// generate 페이지 상단 헤더. h1 좌측 + '새로고침' 우측.
// 항상 표시하되 스트리밍 중일 때만 disabled — 언제나 진입점이 보이는 게
// 사용자 예측 가능성에 좋고, 중간에 취소되는 사고를 막기 위해 스트림 중에는
// 클릭 자체를 막는다.

import { RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useGenerationStore } from '@/lib/store/generationStore';

export function GenerateHeader() {
  const streamStatus = useGenerationStore((s) => s.streamStatus);
  const reset = useGenerationStore((s) => s.reset);

  const isStreaming = streamStatus === 'starting' || streamStatus === 'streaming';

  return (
    <div className="flex items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">+클립아트 만들기</h1>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={reset}
        disabled={isStreaming}
        title={isStreaming ? '생성 중에는 새로고침할 수 없어요' : '새로고침'}
      >
        <RotateCcw className="mr-1 h-3.5 w-3.5" />
        새로고침
      </Button>
    </div>
  );
}
