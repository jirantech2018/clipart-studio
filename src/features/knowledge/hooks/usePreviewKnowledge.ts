'use client';

// Preview API 래퍼. mutation 으로 두어서 사용자가 버튼을 눌러야만 실행되게 한다.

import { useMutation } from '@tanstack/react-query';

export interface PreviewMatch {
  knowledgeId: string;
  knowledgeName: string;
  priority: number;
  matchedTriggers: string[];
  triggerScore: number;
  llmScore: number | null;
  reason: string;
  primaryImageUrl: string | null;
}

export interface PreviewResult {
  matches: PreviewMatch[];
  finalPrompt: string;
  finalLength: number;
  appliedKnowledgeIds: string[];
  referenceImageUrls: string[];
}

export function usePreviewKnowledge() {
  return useMutation({
    mutationFn: async (prompt: string): Promise<PreviewResult> => {
      const res = await fetch('/api/admin/knowledge/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(json?.error?.message ?? '미리보기 실패');
      }
      const json = (await res.json()) as { data: PreviewResult };
      return json.data;
    },
  });
}
