// Stage 4.2 Art Direction 계약 검증.
//
// 지시서 §4.3: blocks[].sourceBlockId 는 반드시 해당 페이지의 기존 composition
// block ID 중 하나여야 하고, 하나의 block ID 는 한 번만 등장. 누락·중복·정의
// 안 된 ID 가 있으면 art direction 을 1회 재시도, 그래도 실패하면 Stage 4.1
// fallback + 사유 기록. fallback 과정에서 새 문항이나 open-response 를 만들지
// 않는다.

import type { CompositionPage } from '@/services/learning-composition';
import type { DirectionContractReport, PageArtDirection } from './types';

export function verifyArtDirectionContract(
  direction: PageArtDirection,
  page: CompositionPage,
): DirectionContractReport {
  const validIds = new Set(page.blocks.map((b) => b.blockId));
  const seen = new Map<string, number>();
  const unknown: string[] = [];
  for (const b of direction.blocks) {
    seen.set(b.sourceBlockId, (seen.get(b.sourceBlockId) ?? 0) + 1);
    if (!validIds.has(b.sourceBlockId)) unknown.push(b.sourceBlockId);
  }
  const duplicates = Array.from(seen.entries())
    .filter(([, n]) => n > 1)
    .map(([id]) => id);
  const missing = [...validIds].filter((id) => !seen.has(id));

  const readingOrderIds = new Set(direction.readingOrder);
  const missingInOrder = [...validIds].filter((id) => !readingOrderIds.has(id));

  const pass =
    unknown.length === 0 &&
    duplicates.length === 0 &&
    missing.length === 0 &&
    missingInOrder.length === 0;

  return {
    pass,
    missingBlockIds: missing.concat(missingInOrder.filter((id) => !missing.includes(id))),
    duplicateBlockIds: duplicates,
    unknownBlockIds: unknown,
    hasReadingOrder: direction.readingOrder.length > 0,
  };
}
