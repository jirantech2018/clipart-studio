// v2 전용 최근 Prompt 추출 유틸.
//
// Conversation 안의 Block 배열에서 "실제 생성이 시작되었거나 종료된"
// Block 의 Prompt 만 최신 순으로 뽑아 최대 RECENT_PROMPT_MAX 개까지 반환한다.
//
// 판정 규칙:
//   - draft 상태(아직 생성 요청 없음) 는 제외
//   - queued / generating / completed / failed / unknown 은 포함
//   - 앞뒤 공백 제거 + 연속 공백 정리 후 동일 문자열이면 중복으로 간주
//   - 중복 시 최신 항목만 유지 (뒤에서 앞으로 순회)
//   - 표시용 원본 문자열은 trim 만 적용 (내부 공백/줄바꿈 보존)
//
// 새 API/DB/Store 없이 conversationStore 의 Block 배열만 소비한다.

import type { Block } from '@/lib/store/conversationStore';

import { RECENT_PROMPT_MAX } from '../config';

const NON_DRAFT_STATUSES: ReadonlySet<Block['status']> = new Set([
  'queued',
  'generating',
  'completed',
  'failed',
  'unknown',
]);

export function normalizePromptForCompare(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

export function extractRecentPrompts(blocks: readonly Block[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (!b) continue;
    if (!NON_DRAFT_STATUSES.has(b.status)) continue;
    const key = normalizePromptForCompare(b.prompt);
    if (key.length === 0) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b.prompt.trim());
    if (out.length >= RECENT_PROMPT_MAX) break;
  }
  return out;
}
