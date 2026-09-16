// Layout Primitive 렌더러 (13종).
//
// 각 primitive 는 서로 다른 정보 배치·컬럼·이미지 위치·답안 공간·시선 흐름을 갖는다.
// 카드 wrapper 를 공유하지 않는다.

import { loadImage } from './image-loader';
import type { CompositionBlock, VisualSlotPlan, ResponseSpacePlan } from '@/services/learning-composition';
import type { Section } from './schema';

export type AnswerVariant = 'student' | 'teacher' | 'combined';

export interface PrimitiveContext {
  block: CompositionBlock;
  section?: Section;
  imageUrls: string[];
  variant: AnswerVariant;
}

export async function renderPrimitive(ctx: PrimitiveContext): Promise<string> {
  switch (ctx.block.primitive) {
    case 'instruction-strip':
      return await renderInstructionStrip(ctx);
    case 'concept-panel':
      return await renderConceptPanel(ctx);
    case 'example-panel':
      return await renderExamplePanel(ctx);
    case 'matching-board':
      return await renderMatchingBoard(ctx);
    case 'choice-grid':
      return await renderChoiceGrid(ctx);
    case 'image-observation':
      return await renderImageObservation(ctx);
    case 'compare-panel':
      return await renderComparePanel(ctx);
    case 'sequence-steps':
      return await renderSequenceSteps(ctx);
    case 'writing-practice':
      return await renderWritingPractice(ctx);
    case 'calculation-practice':
      return await renderCalculationPractice(ctx);
    case 'open-response':
      return await renderOpenResponse(ctx);
    case 'reflection-strip':
      return await renderReflectionStrip(ctx);
    case 'visual-canvas':
      return await renderVisualCanvas(ctx);
  }
}

// ============================================================
// 헬퍼
// ============================================================
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function embedImage(url: string, opts: { maxW?: string; maxH?: string } = {}): Promise<string> {
  try {
    const img = await loadImage(url);
    const w = opts.maxW ?? '100%';
    const h = opts.maxH ?? 'auto';
    return `<img src="${img.dataUrl}" style="max-width:${w}; max-height:${h}; width:auto; height:auto;" alt="" />`;
  } catch {
    return `<span class="img-fail">[이미지 실패]</span>`;
  }
}

function responseArea(rs: ResponseSpacePlan): string {
  switch (rs.type) {
    case 'none':
      return '';
    case 'line': {
      const lines = rs.lines ?? sizeToLines(rs.size);
      const arr: string[] = [];
      for (let i = 0; i < lines; i++) arr.push('<div class="rs-line"></div>');
      return `<div class="rs-lines">${arr.join('')}</div>`;
    }
    case 'box': {
      const h = sizeToBoxHeight(rs.size);
      return `<div class="rs-box" style="height:${h}mm;"></div>`;
    }
    case 'grid': {
      const cells = rs.cells ?? (rs.size === 'large' ? 10 : rs.size === 'small' ? 4 : 6);
      const cellArr: string[] = [];
      for (let i = 0; i < cells; i++) cellArr.push('<div class="rs-cell"></div>');
      return `<div class="rs-grid" style="grid-template-columns: repeat(${Math.min(cells, 10)}, 1fr);">${cellArr.join('')}</div>`;
    }
    case 'manuscript': {
      const cells = rs.cells ?? 10;
      const rows = 3;
      const cellArr: string[] = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cells; c++) cellArr.push('<div class="rs-manuscript-cell"></div>');
      return `<div class="rs-manuscript" style="grid-template-columns: repeat(${cells}, 1fr);">${cellArr.join('')}</div>`;
    }
    case 'drawing': {
      const h = sizeToDrawHeight(rs.size);
      return `<div class="rs-drawing" style="height:${h}mm;"></div>`;
    }
  }
}

function sizeToLines(size?: string): number {
  return size === 'large' ? 6 : size === 'small' ? 2 : 4;
}
function sizeToBoxHeight(size?: string): number {
  return size === 'large' ? 60 : size === 'small' ? 25 : 40;
}
function sizeToDrawHeight(size?: string): number {
  return size === 'large' ? 90 : size === 'small' ? 35 : 60;
}

function teacherOverlay(block: CompositionBlock, variant: AnswerVariant): string {
  if (variant !== 'teacher') return '';
  const t = block.teacherOverlay;
  if (!t) return '';
  const parts: string[] = [];
  if (t.answerNote) parts.push(`<span class="to-answer">정답: ${esc(t.answerNote)}</span>`);
  if (t.guidanceNote) parts.push(`<span class="to-guide">${esc(t.guidanceNote)}</span>`);
  if (parts.length === 0) return '';
  return `<div class="teacher-overlay">${parts.join(' · ')}</div>`;
}

function instructionHeader(block: CompositionBlock): string {
  const text = block.instruction || '';
  if (!text) return '';
  return `<p class="pr-instruction">${esc(text)}</p>`;
}

// ============================================================
// 1. instruction-strip
// ============================================================
async function renderInstructionStrip(ctx: PrimitiveContext): Promise<string> {
  const { block, imageUrls } = ctx;
  let img = '';
  if (block.visualSlot.needed && imageUrls[0]) {
    img = await embedImage(imageUrls[0], { maxH: '20mm' });
  }
  return `<section class="prim prim-instruction-strip" data-block="${esc(block.blockId)}">
  <div class="ins-inner">
    ${img ? `<div class="ins-img">${img}</div>` : ''}
    <div class="ins-text">${esc(block.instruction || '')}</div>
  </div>
  ${teacherOverlay(block, ctx.variant)}
</section>`;
}

// ============================================================
// 2. concept-panel
// ============================================================
async function renderConceptPanel(ctx: PrimitiveContext): Promise<string> {
  const { block, section, imageUrls, variant } = ctx;
  const bodyText = (section && 'stem' in section && typeof section.stem === 'string' ? section.stem : block.instruction) || '';
  let img = '';
  if (block.visualSlot.needed && imageUrls[0]) {
    const wf = block.visualSlot.widthFraction ?? 0.3;
    img = await embedImage(imageUrls[0], { maxW: `${Math.round(wf * 100)}%`, maxH: '55mm' });
  }
  const side = block.visualSlot.placement === 'side' || block.visualSlot.placement === 'inline';
  return `<section class="prim prim-concept-panel" data-block="${esc(block.blockId)}">
  <h3 class="cp-title">${esc(block.instruction || '')}</h3>
  <div class="cp-body ${side ? 'cp-side' : 'cp-stack'}">
    ${img ? `<div class="cp-img">${img}</div>` : ''}
    <p class="cp-text">${esc(bodyText)}</p>
  </div>
  ${teacherOverlay(block, variant)}
</section>`;
}

// ============================================================
// 3. example-panel
// ============================================================
async function renderExamplePanel(ctx: PrimitiveContext): Promise<string> {
  const { block, section, variant } = ctx;
  const s = section as (Section & { kind: 'guided-practice' }) | undefined;
  let example = '';
  let steps: string[] = [];
  let practice: Array<{ problem: string; answer?: string }> = [];
  if (s && s.kind === 'guided-practice') {
    example = s.workedExample?.problem ?? '';
    steps = s.workedExample?.solutionSteps ?? [];
    practice = s.practiceProblems ?? [];
  }
  const stepList = steps.map((st, i) => `<li><span class="ep-step-num">${i + 1}</span> ${esc(st)}</li>`).join('');
  const practiceList = practice
    .map((p) => {
      const ans =
        variant === 'teacher' && p.answer
          ? `<span class="ep-answer">= ${esc(p.answer)}</span>`
          : `<span class="ep-answer-blank"></span>`;
      return `<li><span class="ep-prob">${esc(p.problem)}</span>${ans}</li>`;
    })
    .join('');
  return `<section class="prim prim-example-panel" data-block="${esc(block.blockId)}">
  ${instructionHeader(block)}
  <div class="ep-example">
    <div class="ep-example-label">예시</div>
    <div class="ep-example-body">
      <div class="ep-example-problem">${esc(example)}</div>
      <ol class="ep-steps">${stepList}</ol>
    </div>
  </div>
  <div class="ep-practice">
    <div class="ep-practice-label">직접 풀어 봅시다</div>
    <ol class="ep-practice-list">${practiceList}</ol>
  </div>
  ${teacherOverlay(block, variant)}
</section>`;
}

// ============================================================
// 4. matching-board
// ============================================================
async function renderMatchingBoard(ctx: PrimitiveContext): Promise<string> {
  const { block, section, imageUrls, variant } = ctx;
  const s = section as (Section & { kind: 'matching' }) | undefined;
  const left = s?.leftColumn ?? [];
  const right = s?.rightColumn ?? [];
  const pairs = s?.correctPairs ?? [];
  const shortItem = (t?: string) => (t && t.length <= 3);
  const leftIsShort = left.every((x) => shortItem(x.text));
  const rightIsShort = right.every((x) => shortItem(x.text));
  const renderCol = async (col: typeof left, side: 'left' | 'right') => {
    const items: string[] = [];
    for (let i = 0; i < col.length; i++) {
      const it = col[i]!;
      const img = it.imageAssetRef && imageUrls[i]
        ? await embedImage(imageUrls[i]!, { maxH: '22mm' })
        : it.imageAssetRef
          ? await embedImage(it.imageAssetRef, { maxH: '22mm' })
          : '';
      const isShort = side === 'left' ? leftIsShort : rightIsShort;
      const badgeCls = side === 'left' ? 'mb-badge-left' : 'mb-badge-right';
      const wordCls = side === 'left' ? 'mb-word-left' : 'mb-word-right';
      if (isShort && it.text) {
        items.push(`<li class="mb-row mb-${side}"><span class="mb-badge ${badgeCls}">${esc(it.text)}</span><span class="mb-anchor mb-anchor-${side}"></span></li>`);
      } else {
        const label = it.text ? `<span class="mb-word ${wordCls}">${esc(it.text)}</span>` : '';
        items.push(`<li class="mb-row mb-${side}"><div class="mb-content">${img}${label}</div><span class="mb-anchor mb-anchor-${side}"></span></li>`);
      }
    }
    return items.join('');
  };
  const leftHtml = await renderCol(left, 'left');
  const rightHtml = await renderCol(right, 'right');
  const teacher =
    variant === 'teacher' && pairs.length > 0
      ? `<div class="teacher-overlay"><strong>정답 짝</strong>: ${pairs.map((p) => `${esc(p[0])}↔${esc(p[1])}`).join(', ')}</div>`
      : teacherOverlay(block, variant);
  return `<section class="prim prim-matching-board" data-block="${esc(block.blockId)}">
  ${instructionHeader(block)}
  <div class="mb-container">
    <ul class="mb-col mb-col-left">${leftHtml}</ul>
    <div class="mb-space"></div>
    <ul class="mb-col mb-col-right">${rightHtml}</ul>
  </div>
  ${teacher}
</section>`;
}

// ============================================================
// 5. choice-grid
// ============================================================
async function renderChoiceGrid(ctx: PrimitiveContext): Promise<string> {
  const { block, section, imageUrls, variant } = ctx;
  const s = section as (Section & { kind: 'picture-choice' }) | undefined;
  const choices = s?.choices ?? [];
  const answer = s?.answer ?? '';
  const items: string[] = [];
  for (let i = 0; i < choices.length; i++) {
    const c = choices[i]!;
    const url = c.imageAssetRef || imageUrls[i];
    const img = url ? await embedImage(url, { maxH: '35mm' }) : '';
    const label = c.label ? `<div class="cg-label">${esc(c.label)}</div>` : '';
    items.push(`<div class="cg-choice"><span class="cg-num">${i + 1}</span>${img}${label}</div>`);
  }
  const cols = Math.min(choices.length, 4);
  const teacher =
    variant === 'teacher' && answer
      ? `<div class="teacher-overlay"><strong>정답 ${esc(answer)}</strong></div>`
      : teacherOverlay(block, variant);
  return `<section class="prim prim-choice-grid" data-block="${esc(block.blockId)}">
  ${instructionHeader(block)}
  <div class="cg-grid" style="grid-template-columns: repeat(${cols}, 1fr);">${items.join('')}</div>
  ${teacher}
</section>`;
}

// ============================================================
// 6. image-observation
// ============================================================
async function renderImageObservation(ctx: PrimitiveContext): Promise<string> {
  const { block, section, imageUrls, variant } = ctx;
  const s = section as (Section & { kind: 'observation' }) | undefined;
  const url = imageUrls[0] || (s?.imageAssetRef ?? '');
  const img = url ? await embedImage(url, { maxW: '60%', maxH: '80mm' }) : '';
  const prompts = s?.observationPrompts ?? [];
  const promptList = prompts
    .map((p) => {
      const ans =
        variant === 'teacher' && p.answer
          ? `<div class="io-answer">${esc(p.answer)}</div>`
          : `<div class="io-answer-line"></div>`;
      return `<li><div class="io-prompt">${esc(p.prompt)}</div>${ans}</li>`;
    })
    .join('');
  return `<section class="prim prim-image-observation" data-block="${esc(block.blockId)}">
  ${instructionHeader(block)}
  <div class="io-container">
    <div class="io-image">${img}</div>
    <ol class="io-prompts">${promptList}</ol>
  </div>
  ${teacherOverlay(block, variant)}
</section>`;
}

// ============================================================
// 7. compare-panel
// ============================================================
async function renderComparePanel(ctx: PrimitiveContext): Promise<string> {
  const { block, section, imageUrls, variant } = ctx;
  // classification 을 좌우 두 카테고리 비교로 변환.
  const s = section as (Section & { kind: 'classification' }) | undefined;
  const cats = s?.categories ?? [];
  const items = s?.items ?? [];
  const bucketCols: string[] = [];
  const displayCats = cats.length > 0 ? cats.slice(0, 3) : ['A', 'B'];
  for (let ci = 0; ci < displayCats.length; ci++) {
    const cat = displayCats[ci]!;
    const catItems = items.filter((x) => x.correctCategory === cat);
    const chips = await Promise.all(
      catItems.map(async (it) => {
        const url = it.imageAssetRef;
        const img = url ? await embedImage(url, { maxH: '18mm' }) : '';
        return `<div class="cmp-item">${img}${it.text ? esc(it.text) : ''}</div>`;
      }),
    );
    bucketCols.push(`<div class="cmp-col">
      <div class="cmp-cat-title">${esc(cat)}</div>
      <div class="cmp-cat-body">${chips.join('')}</div>
    </div>`);
  }
  // 답안 공간: 학생이 항목 이름을 카테고리에 쓸 수 있도록 각 컬럼에 라인 추가.
  const teacher =
    variant === 'teacher' && items.length > 0
      ? `<div class="teacher-overlay"><strong>정답 분류</strong>: ${items.map((it) => `${esc(it.text ?? it.id)}→${esc(it.correctCategory)}`).join(' · ')}</div>`
      : teacherOverlay(block, variant);
  return `<section class="prim prim-compare-panel" data-block="${esc(block.blockId)}">
  ${instructionHeader(block)}
  <div class="cmp-container" style="grid-template-columns: repeat(${displayCats.length}, 1fr);">${bucketCols.join('')}</div>
  ${teacher}
</section>`;
}

// ============================================================
// 8. sequence-steps
// ============================================================
async function renderSequenceSteps(ctx: PrimitiveContext): Promise<string> {
  const { block, section, imageUrls, variant } = ctx;
  const s = section as (Section & { kind: 'sequence' }) | undefined;
  const items = s?.items ?? [];
  const order = s?.correctOrder ?? [];
  const cards: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const url = it.imageAssetRef || imageUrls[i];
    const img = url ? await embedImage(url, { maxH: '30mm' }) : '';
    const label = it.text ? `<div class="ss-text">${esc(it.text)}</div>` : '';
    cards.push(`<li class="ss-card">${img}${label}<div class="ss-slot">순서: __</div></li>`);
  }
  const teacher =
    variant === 'teacher' && order.length > 0
      ? `<div class="teacher-overlay"><strong>정답 순서</strong>: ${order.map(esc).join(' → ')}</div>`
      : teacherOverlay(block, variant);
  return `<section class="prim prim-sequence-steps" data-block="${esc(block.blockId)}">
  ${instructionHeader(block)}
  <ol class="ss-container">${cards.join('')}</ol>
  ${teacher}
</section>`;
}

// ============================================================
// 9. writing-practice
// ============================================================
async function renderWritingPractice(ctx: PrimitiveContext): Promise<string> {
  const { block, section, imageUrls } = ctx;
  const s = section as (Section & { kind: 'writing-grid' }) | undefined;
  const cellsPerRow = s?.cellsPerRow ?? 10;
  const rowCount = s?.rowCount ?? 3;
  const tracing = s?.tracingText ?? '';
  const cells: string[] = [];
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < cellsPerRow; c++) {
      const trace = r === 0 && tracing ? esc(tracing.charAt(c) ?? '') : '';
      cells.push(`<div class="wp-cell">${trace}</div>`);
    }
  }
  const guideImg = block.visualSlot.needed && imageUrls[0]
    ? await embedImage(imageUrls[0], { maxH: '35mm' })
    : '';
  return `<section class="prim prim-writing-practice" data-block="${esc(block.blockId)}">
  ${instructionHeader(block)}
  <div class="wp-container">
    ${guideImg ? `<div class="wp-guide">${guideImg}</div>` : ''}
    <div class="wp-grid" style="grid-template-columns: repeat(${cellsPerRow}, 1fr);">${cells.join('')}</div>
  </div>
  ${teacherOverlay(block, ctx.variant)}
</section>`;
}

// ============================================================
// 10. calculation-practice
// ============================================================
async function renderCalculationPractice(ctx: PrimitiveContext): Promise<string> {
  const { block, section, variant } = ctx;
  const s = section as (Section & { kind: 'independent-practice' }) | undefined;
  const problems = s?.problems ?? [];
  const cells: string[] = [];
  for (const p of problems) {
    const ans =
      variant === 'teacher' && p.answer
        ? `<span class="cp-ans-teacher">${esc(p.answer)}</span>`
        : `<span class="cp-ans-blank"></span>`;
    cells.push(`<div class="calc-cell">
      <div class="calc-problem">${esc(p.problem)}</div>
      <div class="calc-answer">답: ${ans}</div>
    </div>`);
  }
  const cols = Math.min(problems.length, 3);
  return `<section class="prim prim-calculation-practice" data-block="${esc(block.blockId)}">
  ${instructionHeader(block)}
  <div class="calc-grid" style="grid-template-columns: repeat(${cols}, 1fr);">${cells.join('')}</div>
  ${teacherOverlay(block, variant)}
</section>`;
}

// ============================================================
// 11. open-response
// ============================================================
async function renderOpenResponse(ctx: PrimitiveContext): Promise<string> {
  const { block, section, variant } = ctx;
  const s = section as (Section & { kind: 'open-response' }) | undefined;
  const rs: ResponseSpacePlan = block.responseSpace.type !== 'none'
    ? block.responseSpace
    : { type: s?.responseMode === 'box' ? 'box' : 'line', size: 'medium', lines: s?.lineCount };
  return `<section class="prim prim-open-response" data-block="${esc(block.blockId)}">
  ${instructionHeader(block)}
  <div class="or-container">${responseArea(rs)}</div>
  ${teacherOverlay(block, variant)}
</section>`;
}

// ============================================================
// 12. reflection-strip
// ============================================================
async function renderReflectionStrip(ctx: PrimitiveContext): Promise<string> {
  const { block } = ctx;
  const question = block.instruction || '오늘 활동을 스스로 완성했나요?';
  return `<section class="prim prim-reflection-strip" data-block="${esc(block.blockId)}">
  <div class="ref-inner">
    <span class="ref-label">오늘의 확인</span>
    <span class="ref-question">${esc(question)}</span>
    <span class="ref-options">
      <span class="ref-option">잘했어요</span>
      <span class="ref-option">더 연습이 필요해요</span>
    </span>
  </div>
</section>`;
}

// ============================================================
// 13. visual-canvas
// ============================================================
async function renderVisualCanvas(ctx: PrimitiveContext): Promise<string> {
  const { block, imageUrls, variant } = ctx;
  const url = imageUrls[0];
  const img = url ? await embedImage(url, { maxW: '100%', maxH: '150mm' }) : '';
  return `<section class="prim prim-visual-canvas" data-block="${esc(block.blockId)}">
  ${instructionHeader(block)}
  <div class="vc-container">${img}</div>
  ${teacherOverlay(block, variant)}
</section>`;
}

// unused-vars 방지 위한 export
export const __PRIMITIVE_KEYS__: VisualSlotPlan['placement'][] = [
  'inline', 'side', 'background', 'choice-grid', 'top', 'bottom',
];
