'use client';

// 패키지 모드 AI 추천 훅.
//
// - 사용자 입력 (목적 / 주제 / 대상 / 스타일 / 요청 + userAdded/Removed 키워드)
//   을 debounce (800ms) 후 /api/package-plan 에 던진다.
// - 최소 조건 (목적 · 대상 · 스타일 3개 필수) 미달이면 API 호출 자체를 안 함.
// - 응답 도착 시 상위 (컴포넌트) 가 mergeAiPlanIntoBlockOptions 로 store 를
//   갱신한다. 이 훅은 데이터 반환만 담당.
//
// prompt-suggestions 훅과 동일한 React Query 패턴.

import { useQuery } from '@tanstack/react-query';

import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';

import type {
  PackagePlanRequest,
  PackagePlanResponse,
} from '@/features/generation-v2/lib/packagePlanTypes';

export interface UsePackagePlanInput {
  purpose: string;
  topicOrEvent: string;
  target: string;
  styleTone: string;
  additionalRequest: string;
  userAddedKeywords: readonly string[];
  userRemovedKeywords: readonly string[];
}

async function fetchPlan(
  input: PackagePlanRequest,
): Promise<PackagePlanResponse> {
  const res = await fetch('/api/package-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('package-plan failed');
  const json = (await res.json()) as { data: PackagePlanResponse };
  return json.data;
}

/** debounce 후 캐시 key. 필드가 하나라도 바뀌면 새 요청. */
function makeQueryKey(input: UsePackagePlanInput): unknown[] {
  return [
    'package-plan',
    input.purpose,
    input.topicOrEvent,
    input.target,
    input.styleTone,
    input.additionalRequest,
    input.userAddedKeywords.join('|'),
    input.userRemovedKeywords.join('|'),
  ];
}

export function usePackagePlan(input: UsePackagePlanInput) {
  const debouncedInput = useDebouncedValue(input, 800);

  const hasRequired =
    debouncedInput.purpose.trim().length > 0 &&
    debouncedInput.target.trim().length > 0 &&
    debouncedInput.styleTone.trim().length > 0;

  return useQuery({
    queryKey: makeQueryKey(debouncedInput),
    queryFn: () =>
      fetchPlan({
        purpose: debouncedInput.purpose,
        topicOrEvent: debouncedInput.topicOrEvent,
        target: debouncedInput.target,
        styleTone: debouncedInput.styleTone,
        additionalRequest: debouncedInput.additionalRequest,
        userAddedKeywords: [...debouncedInput.userAddedKeywords],
        userRemovedKeywords: [...debouncedInput.userRemovedKeywords],
      }),
    enabled: hasRequired,
    staleTime: 60_000,
    // 이전 성공 응답을 계속 표시 (API 실패 시 화면 깨지지 않도록).
    placeholderData: (previous) => previous,
  });
}
