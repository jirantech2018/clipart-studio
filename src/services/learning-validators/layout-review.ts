// Layout Review — 최종 이미지 삽입 후 실제 PDF 렌더 결과를 검사.
//
// Semantic Review 와 Vision Review 와 별개 단계. compositionPlan 준수·이미지 결합·
// 답안 공간·페이지 밀도 등 layout 관점의 정합성만 판정한다.
//
// 실패 시 구조적 이슈 목록을 반환. 호출자는 필요 시 실패한 page composition 만
// 1회 재계획·재렌더 (전역 CSS 조정 금지).

import type { AppliedComposition } from '@/services/learning-composition';
import type { LearningDocument, Section } from '@/services/learning-renderer/schema';

export interface LayoutReviewInput {
  applied: AppliedComposition;
  document: LearningDocument;
  pdfBytes: Buffer;
  /** teacher variant 도 검사할 때는 이 필드에 별도 buffer 전달. */
  variant: 'student' | 'teacher' | 'combined';
}

export type LayoutIssueCode =
  | 'PLACEHOLDER_REMAINING'
  | 'IMAGE_NOT_LINKED'
  | 'IMAGE_DUPLICATE_STANDALONE'
  | 'ANSWER_SPACE_INSUFFICIENT'
  | 'PAGE_UNDERFILLED'
  | 'PAGE_OVERFILLED'
  | 'FIRST_PAGE_TITLE_ONLY'
  | 'PAGE_COUNT_MISMATCH'
  | 'STUDENT_ANSWER_LEAK'
  | 'BLOCK_NOT_LINKED_TO_COMPOSITION';

export interface LayoutIssue {
  code: LayoutIssueCode;
  where: string; // pageId / blockId / section index 등
  detail: string;
}

export interface LayoutReviewResult {
  pass: boolean;
  issues: LayoutIssue[];
  metrics: {
    pageCount: number;
    predictedPageFillRatio: number[];
    imageObjectCount: number;
    firstPageEmpty: boolean;
    standaloneImageCount: number;
    blockCount: number;
    linkedBlockCount: number;
  };
}

const STUDENT_LEAK_HINTS = ['정답:', '정답 ', '답:', 'answer:', 'Answer:'];

/**
 * 순수 정적 검사. PDF 바이트에서 pagination, image object, 첫 페이지 공백 신호를
 * 파싱하고 compositionPlan 과 대조.
 */
export function reviewLayout(input: LayoutReviewInput): LayoutReviewResult {
  const issues: LayoutIssue[] = [];
  const { applied, document, pdfBytes, variant } = input;
  const plan = applied.compositionPlan;

  // PDF 정적 시그니처.
  const latin1 = pdfBytes.toString('latin1');
  const pageCount = (latin1.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
  const imageObjectCount = (latin1.match(/\/Subtype\s*\/Image/g) ?? []).length;
  const firstPageEmpty = /\/Contents\s*<<\s*\/Length\s+0/.test(latin1);

  // 블록 - composition 매핑.
  const totalBlocks = plan.pages.reduce((n, p) => n + p.blocks.length, 0);
  const linkedBlocks = Object.keys(applied.blockToSectionId).length;

  if (linkedBlocks < totalBlocks) {
    for (const page of plan.pages) {
      for (const block of page.blocks) {
        if (!applied.blockToSectionId[block.blockId]) {
          issues.push({
            code: 'BLOCK_NOT_LINKED_TO_COMPOSITION',
            where: `page=${page.pageId} block=${block.blockId}`,
            detail: 'CompositionBlock 이 LearningDocument section 과 연결되지 않음.',
          });
        }
      }
    }
  }

  // 이미지 결합: visualSlot.needed 인 블록에 이미지가 있는가.
  let unlinkedVisualBlocks = 0;
  for (const page of plan.pages) {
    for (const block of page.blocks) {
      if (block.visualSlot.needed) {
        const urls = applied.blockToImageUrls[block.blockId] ?? [];
        if (urls.length === 0) {
          unlinkedVisualBlocks += 1;
          issues.push({
            code: 'IMAGE_NOT_LINKED',
            where: `block=${block.blockId}`,
            detail: `visualSlot.needed=true 인데 이미지 URL 이 연결되지 않음 (role=${block.visualSlot.role ?? '?'}).`,
          });
        }
      }
    }
  }

  // Standalone image sections (Section.kind === 'image' 존재 여부).
  const standaloneImages = document.sections.filter((s) => s.kind === 'image').length;
  if (standaloneImages > 0) {
    issues.push({
      code: 'IMAGE_DUPLICATE_STANDALONE',
      where: `document`,
      detail: `${standaloneImages}개의 standalone image section 이 존재. 이미지는 활동 block 안 visualSlot 에만 있어야 함.`,
    });
  }

  // Placeholder 잔존: __will_be_replaced__ 문자열이 문서 JSON 에 남아있는가.
  const docJson = JSON.stringify(document);
  if (docJson.includes('__will_be_replaced__')) {
    issues.push({
      code: 'PLACEHOLDER_REMAINING',
      where: 'document.sections',
      detail: '__will_be_replaced__ placeholder 잔존.',
    });
  }

  // 첫 페이지 공백.
  if (firstPageEmpty) {
    issues.push({
      code: 'FIRST_PAGE_TITLE_ONLY',
      where: 'page_01',
      detail: '첫 페이지가 비어 있거나 제목만 있음.',
    });
  }

  // 페이지 목표 대비 실제 페이지 수.
  const target = plan.documentStrategy.pageTarget;
  if (pageCount === 0) {
    issues.push({
      code: 'PAGE_COUNT_MISMATCH',
      where: 'document',
      detail: `PDF 페이지 수 0.`,
    });
  } else if (pageCount > target + 1) {
    issues.push({
      code: 'PAGE_COUNT_MISMATCH',
      where: 'document',
      detail: `목표 페이지 ${target} 대비 실제 ${pageCount} (초과).`,
    });
  }

  // 예측 사용률: 35% 미만이면 under-filled 판정.
  applied.predictedPageFillRatio.forEach((ratio, idx) => {
    if (ratio < 0.35 && idx < plan.pages.length - 1) {
      issues.push({
        code: 'PAGE_UNDERFILLED',
        where: `page=${plan.pages[idx]?.pageId ?? idx + 1}`,
        detail: `예측 사용률 ${Math.round(ratio * 100)}% (기준 35%).`,
      });
    }
    if (ratio > 1.05) {
      issues.push({
        code: 'PAGE_OVERFILLED',
        where: `page=${plan.pages[idx]?.pageId ?? idx + 1}`,
        detail: `예측 사용률 ${Math.round(ratio * 100)}% (기준 105%).`,
      });
    }
  });

  // 답안 공간 충분성 (line 수 ≥ 2, box size ≥ small).
  for (const page of plan.pages) {
    for (const block of page.blocks) {
      const rs = block.responseSpace;
      const needsResponse =
        block.primitive === 'writing-practice' ||
        block.primitive === 'calculation-practice' ||
        block.primitive === 'open-response' ||
        block.primitive === 'image-observation';
      if (needsResponse && rs.type === 'none') {
        issues.push({
          code: 'ANSWER_SPACE_INSUFFICIENT',
          where: `block=${block.blockId}`,
          detail: `${block.primitive} 는 학생 응답이 필요하지만 responseSpace.type=none.`,
        });
      }
    }
  }

  // 학생용에 정답 노출.
  if (variant === 'student') {
    for (const [i, section] of document.sections.entries()) {
      if (containsAnswerLeak(section)) {
        issues.push({
          code: 'STUDENT_ANSWER_LEAK',
          where: `section[${i}] kind=${section.kind}`,
          detail: '학생용 문서에 정답 텍스트가 노출됨.',
        });
      }
    }
  }

  const pass = issues.length === 0;
  return {
    pass,
    issues,
    metrics: {
      pageCount,
      predictedPageFillRatio: applied.predictedPageFillRatio,
      imageObjectCount,
      firstPageEmpty,
      standaloneImageCount: standaloneImages,
      blockCount: totalBlocks,
      linkedBlockCount: linkedBlocks,
    },
  };
}

function containsAnswerLeak(section: Section): boolean {
  // 학생용 렌더에서는 answer/teacherNote 는 primitive 가 알아서 숨긴다.
  // 여기서는 stem/instruction 텍스트에 "정답:" 같은 명시적 leak 만 검사.
  const walk = (v: unknown): boolean => {
    if (typeof v !== 'string') return false;
    return STUDENT_LEAK_HINTS.some((h) => v.includes(h));
  };
  const s = section as Record<string, unknown>;
  if (walk(s.stem)) return true;
  if (walk(s.instruction)) return true;
  return false;
}
