// Composition Linking Contract Validator.
//
// ContentPlan (blueprint.itemId) → WorksheetPlan (block.sourceItemIds)
//   → PageCompositionPlan (block.sourceItemIds) → LearningDocument (section.itemId)
//
// 네 단계가 동일한 ID 계보를 사용해야 한다. 이 검증기는 다음을 판정:
//   1. 존재하지 않는 sourceItemId (unknownSourceItemIds)
//   2. 필요한 blueprint 가 composition 에 누락 (missingBlueprintIds)
//   3. 하나의 blueprint 가 여러 composition block 에 의도 없이 중복 배치
//      (duplicateItemPlacements)
//   4. Document section 이 composition block 과 연결되지 않음
//      (unlinkedSectionIds — question/activity/matching 등 재생성 가능 kind 만)
//
// 실패 시 handler 는 불일치한 block/section 만 한 번 재생성하고, 그래도
// 실패하면 저장·렌더하지 않고 failedStage='composition-linking' 으로 종료.

import type { ContentPlan } from '@/services/learning-generation/types';
import type { LearningDocument, Section } from '@/services/learning-renderer/schema';
import type { WorksheetPlan } from '@/services/learning-worksheet';

import type { PageCompositionPlan } from './types';

export interface LinkingContractReport {
  pass: boolean;
  missingBlueprintIds: string[];
  unknownSourceItemIds: string[];
  unlinkedSectionIds: string[];
  duplicateItemPlacements: Array<{ itemId: string; blockIds: string[] }>;
}

// itemId 를 갖고 composition 과 대응해야 하는 section kind.
const LINKABLE_KINDS = new Set<Section['kind']>([
  'question',
  'activity',
  'picture-choice',
  'matching',
  'classification',
  'fill-blank',
  'writing-grid',
  'guided-practice',
  'independent-practice',
  'sequence',
  'observation',
  'open-response',
]);

export function verifyCompositionLinkingContract(input: {
  contentPlan: ContentPlan;
  worksheetPlan: WorksheetPlan;
  compositionPlan: PageCompositionPlan;
  document: LearningDocument;
}): LinkingContractReport {
  const { contentPlan, worksheetPlan, compositionPlan, document } = input;

  const blueprintIds = new Set(contentPlan.itemBlueprints.map((b) => b.itemId));
  const worksheetIds = new Set<string>();
  for (const page of worksheetPlan.pages) {
    for (const block of page.blocks) {
      for (const id of block.sourceItemIds ?? []) worksheetIds.add(id);
    }
  }
  const compositionIds = new Set<string>();
  const compositionSourceById = new Map<string, string[]>();
  for (const page of compositionPlan.pages) {
    for (const block of page.blocks) {
      for (const id of block.sourceItemIds) {
        compositionIds.add(id);
        const arr = compositionSourceById.get(id) ?? [];
        arr.push(block.blockId);
        compositionSourceById.set(id, arr);
      }
    }
  }

  // 1. unknownSourceItemIds: composition 이 참조하는데 blueprint 에 없는 ID.
  //    worksheet 참조도 함께 검증 (composition 은 worksheet 를 잇는 계층).
  const unknown = new Set<string>();
  for (const id of compositionIds) if (!blueprintIds.has(id)) unknown.add(id);
  for (const id of worksheetIds) if (!blueprintIds.has(id)) unknown.add(id);

  // 2. missingBlueprintIds: blueprint 인데 composition 에 없는 ID.
  const missing: string[] = [];
  for (const id of blueprintIds) if (!compositionIds.has(id)) missing.push(id);

  // 3. duplicateItemPlacements: 하나의 blueprint 가 여러 block 에 배치.
  //    참고: 의도적 다중 배치는 사례상 매우 드물다. matching-board 등에서
  //    한 blueprint 가 leftColumn + rightColumn 이 아니라 서로 다른 activity
  //    로 반복되는 상황을 감지.
  const duplicates: Array<{ itemId: string; blockIds: string[] }> = [];
  for (const [id, blockIds] of compositionSourceById.entries()) {
    if (blockIds.length > 1) duplicates.push({ itemId: id, blockIds });
  }

  // 4. unlinkedSectionIds: Section 중 재생성 가능 kind 인데 itemId 가 없거나
  //    composition 이 참조하는 어떤 blueprintId 와도 매칭 안 됨.
  //    (composition 이 참조하는 itemId 는 blueprintIds ∩ compositionIds)
  const covered = new Set<string>();
  for (const id of compositionIds) if (blueprintIds.has(id)) covered.add(id);
  const unlinkedSectionIds: string[] = [];
  for (const [i, sec] of document.sections.entries()) {
    if (!LINKABLE_KINDS.has(sec.kind)) continue;
    const sid = (sec as { itemId?: string }).itemId;
    if (!sid) {
      unlinkedSectionIds.push(`section[${i}] kind=${sec.kind}`);
      continue;
    }
    // Section itemId 는 (a) 어떤 blueprint id, 또는 (b) 어떤 composition blockId
    // 와 매칭돼야 한다. composition block 은 sourceItemIds 를 통해 blueprint 에
    // 되짚어질 수 있으므로 두 경로 모두 검증.
    const matchesBlueprint = blueprintIds.has(sid);
    const matchesBlockId = compositionPlan.pages.some((p) =>
      p.blocks.some((b) => b.blockId === sid),
    );
    if (!matchesBlueprint && !matchesBlockId) {
      unlinkedSectionIds.push(sid);
    }
  }

  const pass =
    unknown.size === 0 &&
    missing.length === 0 &&
    duplicates.length === 0 &&
    unlinkedSectionIds.length === 0;

  return {
    pass,
    missingBlueprintIds: missing,
    unknownSourceItemIds: Array.from(unknown),
    unlinkedSectionIds,
    duplicateItemPlacements: duplicates,
  };
}
