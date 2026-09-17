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
  | 'PLACEHOLDER_TEXT_LEAKED'
  | 'IMAGE_NOT_LINKED'
  | 'IMAGE_DUPLICATE_STANDALONE'
  | 'ANSWER_SPACE_INSUFFICIENT'
  | 'PAGE_UNDERFILLED'
  | 'PAGE_OVERFILLED'
  | 'FIRST_PAGE_TITLE_ONLY'
  | 'PAGE_COUNT_MISMATCH'
  | 'STUDENT_ANSWER_LEAK'
  | 'BLOCK_NOT_LINKED_TO_COMPOSITION'
  | 'CHOICE_INCOMPLETE'
  | 'MATCHING_COLUMN_INCOMPLETE'
  | 'OBSERVATION_IMAGE_MISSING'
  | 'SEQUENCE_ITEMS_TOO_FEW'
  | 'WRITING_CONFIG_INCOMPLETE'
  | 'INSTRUCTION_TRIVIAL';

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

// 학생이 문서에서 마주치면 안 되는 placeholder 텍스트 패턴. 실제 낱말·이미지가
// 있어야 할 자리에 이런 문자열이 남으면 활동이 성립하지 않는다.
const PLACEHOLDER_TEXT_PATTERNS: RegExp[] = [
  /\(그림\)/,
  /\(사진\)/,
  /\(이미지\)/,
  /\(image\)/i,
  /\(picture\)/i,
  /\[image\]/i,
  /\bTODO\b/,
  /\bTBD\b/,
  /placeholder/i,
  /\(임시\)/,
  /\.\.\.그림/,
  /그림\s*\)/, // "기차 그림)" 처럼 그림이란 단어로 이미지 자리를 대체한 흔적
  /\(.*?그림.*?\)/, // "(기차 그림)"
];

function looksLikePlaceholder(text: string | undefined | null): boolean {
  if (!text) return false;
  const t = text.trim();
  if (t.length === 0) return false;
  return PLACEHOLDER_TEXT_PATTERNS.some((re) => re.test(t));
}

function hasMeaningfulContent(text: string | undefined | null, minLen = 1): boolean {
  if (!text) return false;
  const t = text.trim();
  if (t.length < minLen) return false;
  if (looksLikePlaceholder(t)) return false;
  return true;
}

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

  // ============================================================
  // 활동 완전성 (Content Completeness) — 골든 대비 실행 가능성 기준.
  //
  // 각 primitive 는 최소한의 콘텐츠 조건을 만족해야 학생이 실제로 활동을
  // 수행할 수 있다. 이 검사가 없으면 (그림) 같은 placeholder 텍스트가
  // 실제 이미지 자리를 대체해도 통과되어 문서가 무용지물이 된다.
  // ============================================================
  for (const [i, sec] of document.sections.entries()) {
    // 지시문 자체가 너무 짧거나 placeholder 냄새.
    const stem = (sec as { stem?: string; instruction?: string }).stem
      ?? (sec as { instruction?: string }).instruction;
    if (stem !== undefined && (stem.trim().length < 5 || looksLikePlaceholder(stem))) {
      issues.push({
        code: 'INSTRUCTION_TRIVIAL',
        where: `section[${i}] kind=${sec.kind}`,
        detail: `지시문이 너무 짧거나 placeholder 로 판정됨: "${stem.trim().slice(0, 60)}"`,
      });
    }

    // picture-choice — 각 선택지는 실제 image URL 또는 실질 텍스트가 있어야 한다.
    if (sec.kind === 'picture-choice') {
      const blockId = (sec as { itemId?: string }).itemId ?? '';
      const imageUrls = applied.blockToImageUrls[blockId] ?? [];
      for (const [ci, choice] of sec.choices.entries()) {
        const hasRealImage =
          Boolean(imageUrls[ci]) ||
          (choice.imageAssetRef && choice.imageAssetRef.startsWith('http'));
        const hasRealLabel = hasMeaningfulContent(choice.label, 1);
        if (!hasRealImage && !hasRealLabel) {
          issues.push({
            code: 'CHOICE_INCOMPLETE',
            where: `section[${i}] choice[${ci}]`,
            detail: `picture-choice 선택지에 실제 이미지도 실질 label 도 없음 (label="${choice.label ?? ''}").`,
          });
        }
      }
    }

    // matching — 좌·우 각 항목은 실제 이미지 또는 실질 텍스트가 있어야 한다.
    //   placeholder 표기 ("(기차 그림)" 등) 는 실질 텍스트로 인정하지 않는다.
    if (sec.kind === 'matching') {
      const blockId = (sec as { itemId?: string }).itemId ?? '';
      const urls = applied.blockToImageUrls[blockId] ?? [];
      const check = (col: Array<{ id: string; text?: string; imageAssetRef?: string }>, side: string) => {
        for (const [ci, item] of col.entries()) {
          const hasRealImage =
            Boolean(urls[ci]) ||
            (item.imageAssetRef && item.imageAssetRef.startsWith('http'));
          const hasRealText = hasMeaningfulContent(item.text, 1);
          if (!hasRealImage && !hasRealText) {
            issues.push({
              code: 'MATCHING_COLUMN_INCOMPLETE',
              where: `section[${i}] ${side}[${ci}]`,
              detail: `matching ${side} 항목이 이미지도 실질 텍스트도 없음 (text="${item.text ?? ''}").`,
            });
          }
        }
      };
      check(sec.leftColumn, 'leftColumn');
      check(sec.rightColumn, 'rightColumn');
      // 짝 수 부족.
      const pairs = sec.correctPairs ?? [];
      const cols = Math.min(sec.leftColumn.length, sec.rightColumn.length);
      if (pairs.length === 0 || pairs.length < cols) {
        issues.push({
          code: 'MATCHING_COLUMN_INCOMPLETE',
          where: `section[${i}]`,
          detail: `correctPairs 가 ${pairs.length}개로 컬럼 수(${cols})보다 적어 학생이 정답 검증 불가.`,
        });
      }
    }

    // observation — 이미지는 필수.
    if (sec.kind === 'observation') {
      const blockId = (sec as { itemId?: string }).itemId ?? '';
      const urls = applied.blockToImageUrls[blockId] ?? [];
      const hasRealImage =
        urls.length > 0 ||
        (sec.imageAssetRef && sec.imageAssetRef.startsWith('http'));
      if (!hasRealImage) {
        issues.push({
          code: 'OBSERVATION_IMAGE_MISSING',
          where: `section[${i}]`,
          detail: 'observation section 에 실제 이미지 URL 이 없음. 관찰 활동은 이미지가 필수.',
        });
      }
      if (!sec.observationPrompts || sec.observationPrompts.length === 0) {
        issues.push({
          code: 'INSTRUCTION_TRIVIAL',
          where: `section[${i}]`,
          detail: 'observation 에 observationPrompts 가 없음 (학생 질문 유도 필수).',
        });
      }
    }

    // sequence — 최소 3개 항목이 있어야 순서 매기기가 의미.
    if (sec.kind === 'sequence') {
      const items = sec.items ?? [];
      if (items.length < 3) {
        issues.push({
          code: 'SEQUENCE_ITEMS_TOO_FEW',
          where: `section[${i}]`,
          detail: `sequence 항목이 ${items.length}개 — 순서 매기기는 최소 3개 필요.`,
        });
      }
      for (const [ci, it] of items.entries()) {
        const blockId = (sec as { itemId?: string }).itemId ?? '';
        const urls = applied.blockToImageUrls[blockId] ?? [];
        const hasImage = Boolean(urls[ci]) || (it.imageAssetRef && it.imageAssetRef.startsWith('http'));
        const hasText = hasMeaningfulContent(it.text, 1);
        if (!hasImage && !hasText) {
          issues.push({
            code: 'CHOICE_INCOMPLETE',
            where: `section[${i}] sequence[${ci}]`,
            detail: `sequence 항목에 이미지도 텍스트도 없음.`,
          });
        }
      }
    }

    // writing-grid — 격자·라인·원고지 중 하나가 완전히 구성돼야 한다.
    if (sec.kind === 'writing-grid') {
      const cellsPerRow = (sec as { cellsPerRow?: number }).cellsPerRow;
      const rowCount = (sec as { rowCount?: number }).rowCount;
      const gridType = (sec as { gridType?: string }).gridType;
      if (!gridType || !cellsPerRow || cellsPerRow < 1 || !rowCount || rowCount < 1) {
        issues.push({
          code: 'WRITING_CONFIG_INCOMPLETE',
          where: `section[${i}]`,
          detail: `writing-grid 설정 불완전 (gridType=${gridType} cellsPerRow=${cellsPerRow} rowCount=${rowCount}).`,
        });
      }
    }

    // classification — items 최소 3개, 모든 items 는 correctCategory 를 가져야.
    if (sec.kind === 'classification') {
      const items = sec.items ?? [];
      if (items.length < 3) {
        issues.push({
          code: 'SEQUENCE_ITEMS_TOO_FEW',
          where: `section[${i}]`,
          detail: `classification 항목이 ${items.length}개 — 분류 활동은 최소 3개 필요.`,
        });
      }
      for (const [ci, it] of items.entries()) {
        if (!it.text || !hasMeaningfulContent(it.text, 1)) {
          issues.push({
            code: 'CHOICE_INCOMPLETE',
            where: `section[${i}] item[${ci}]`,
            detail: `classification 항목 text 가 실질적이지 않음 (text="${it.text ?? ''}").`,
          });
        }
        if (!it.correctCategory) {
          issues.push({
            code: 'CHOICE_INCOMPLETE',
            where: `section[${i}] item[${ci}]`,
            detail: `classification 항목에 correctCategory 없음 — 학생 답 검증 불가.`,
          });
        }
      }
    }
  }

  // 문서 전체 placeholder 텍스트 (renderer 가 이미 시각적으로 노출)
  const flatText = collectTextsForPlaceholderScan(document);
  const leakedFragments = flatText.filter(looksLikePlaceholder);
  if (leakedFragments.length > 0) {
    // 중복 제거 후 요약.
    const uniq = Array.from(new Set(leakedFragments)).slice(0, 5);
    issues.push({
      code: 'PLACEHOLDER_TEXT_LEAKED',
      where: 'document.sections',
      detail: `placeholder 문자열이 학생 문서에 남아있음 (예: ${uniq.map((s) => `"${s.trim().slice(0, 30)}"`).join(' · ')}).`,
    });
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

function collectTextsForPlaceholderScan(document: LearningDocument): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim().length > 0) out.push(v);
  };
  for (const sec of document.sections) {
    const s = sec as Record<string, unknown>;
    push(s.stem);
    push(s.instruction);
    // 하위 배열 안의 text/label 필드까지 훑는다.
    for (const key of ['choices', 'leftColumn', 'rightColumn', 'items', 'sentences', 'practiceProblems', 'problems']) {
      const arr = s[key];
      if (Array.isArray(arr)) {
        for (const el of arr) {
          if (el && typeof el === 'object') {
            const eo = el as Record<string, unknown>;
            push(eo.label);
            push(eo.text);
            push(eo.template);
            push(eo.problem);
          }
        }
      }
    }
  }
  return out;
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
