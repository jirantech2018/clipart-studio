'use client';

// /api/prompt-suggestions 래퍼. 입력 프롬프트를 debounce 해서 gpt-4o-mini
// 추천 호출을 최소화한다. 프롬프트가 2글자 미만이면 서버가 fallback 5개를 즉시 돌려준다.

import { useQuery } from '@tanstack/react-query';

import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';

interface Response {
  suggestions: string[];
  source: 'ai' | 'fallback';
}

async function fetchSuggestions(prompt: string): Promise<Response> {
  const res = await fetch('/api/prompt-suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error('prompt-suggestions failed');
  const json = (await res.json()) as { data: Response };
  return json.data;
}

export function usePromptSuggestions(prompt: string) {
  const debouncedPrompt = useDebouncedValue(prompt.trim(), 800);
  return useQuery({
    queryKey: ['prompt-suggestions', debouncedPrompt],
    queryFn: () => fetchSuggestions(debouncedPrompt),
    staleTime: 60_000,
  });
}
