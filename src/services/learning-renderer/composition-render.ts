// Composition-based renderer input.
//
// LearningDocument.sections 는 Content(문항·활동 데이터)를 담고, 그 데이터는
// CompositionBlock.blockId 로 CompositionBlock 과 연결된다. Renderer 는 원본
// section 을 CompositionBlock.primitive 에 따라 재구성해 HTML/PDF 로 출력.

import type {
  AppliedComposition,
  CompositionBlock,
  CompositionPage,
  PageCompositionPlan,
} from '@/services/learning-composition';
import type { LearningDocument, Section } from './schema';

/**
 * Renderer 입력. section 은 audit/데이터 원본, compositionPlan 은 배치 결정.
 * blockId → section itemId 매핑을 명시적으로 넘겨 정합성 보장.
 */
export interface CompositionRenderInput {
  document: LearningDocument;
  compositionPlan: PageCompositionPlan;
  /** blockId → 이 블록의 원본 section (question / activity / matching / ...). */
  blockToSection: Map<string, Section>;
  /** blockId → 실제 배치된 이미지 URL 목록 (visualSlot.needed 인 경우). */
  blockToImages: Map<string, string[]>;
}

/**
 * blockToSection 을 CompositionBlock 이 참조하도록 매핑 구축.
 * Section 은 blockId 를 itemId 로 갖거나 sourceItemIds 를 통해 연결.
 */
export function buildBlockToSection(
  compositionPlan: PageCompositionPlan,
  document: LearningDocument,
): Map<string, Section> {
  const map = new Map<string, Section>();
  for (const page of compositionPlan.pages) {
    for (const block of page.blocks) {
      const sec = findSectionForBlock(block, document.sections);
      if (sec) map.set(block.blockId, sec);
    }
  }
  return map;
}

function findSectionForBlock(block: CompositionBlock, sections: Section[]): Section | undefined {
  // 1) blockId 직접 매칭.
  for (const s of sections) {
    const sid = (s as { itemId?: string }).itemId;
    if (sid === block.blockId) return s;
  }
  // 2) sourceItemIds 를 통한 매칭 (Section.itemId 가 blueprint.itemId 인 경우).
  for (const id of block.sourceItemIds) {
    for (const s of sections) {
      const sid = (s as { itemId?: string }).itemId;
      if (sid === id) return s;
    }
  }
  return undefined;
}

/** AppliedComposition 스냅샷 조립 (감사·검수 입력용). */
export function buildAppliedComposition(
  compositionPlan: PageCompositionPlan,
  document: LearningDocument,
  blockToImages: Map<string, string[]>,
): AppliedComposition {
  const blockToSection = buildBlockToSection(compositionPlan, document);
  const blockToSectionId: Record<string, string> = {};
  for (const [blockId, sec] of blockToSection.entries()) {
    const sid = (sec as { itemId?: string }).itemId;
    if (sid) blockToSectionId[blockId] = sid;
  }
  const imageMap: Record<string, string[]> = {};
  for (const [blockId, urls] of blockToImages.entries()) {
    imageMap[blockId] = urls;
  }
  const predicted = predictPageFillRatios(compositionPlan);
  return {
    compositionPlan,
    blockToSectionId,
    blockToImageUrls: imageMap,
    predictedPageFillRatio: predicted,
  };
}

/** 페이지별 예측 사용률 (0~1). estimatedHeightMm 을 A4 사용 가능 높이로 나눈 값의 합. */
export function predictPageFillRatios(plan: PageCompositionPlan): number[] {
  const AVAILABLE_MM = 250; // A4 세로 297mm - 상하 여백 20mm 씩.
  return plan.pages.map((page) => {
    // 컬럼 병렬 배치 고려: 컬럼별로 누적 후 max.
    const columnUsed = new Array(page.columns).fill(0);
    for (const b of page.blocks) {
      const col = Math.max(0, Math.min(page.columns - 1, b.placement.column - 1));
      columnUsed[col] += b.estimatedHeightMm;
    }
    const maxUse = Math.max(...columnUsed, 0);
    return Math.max(0, Math.min(1.2, maxUse / AVAILABLE_MM));
  });
}

/** 페이지 layout 을 CSS grid-template-columns 문자열로. */
export function layoutToGridColumns(page: CompositionPage): string {
  switch (page.layout) {
    case 'single':
      return '1fr';
    case 'split':
      return `repeat(${page.columns}, 1fr)`;
    case 'grid':
      return `repeat(${page.columns}, 1fr)`;
    case 'sequence':
      return '1fr';
    case 'canvas':
      return '1fr';
    default:
      return '1fr';
  }
}
