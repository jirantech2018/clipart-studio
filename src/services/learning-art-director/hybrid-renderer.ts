// Stage 4.2 Hybrid Art Direction renderer.
//
// - 절대 좌표 사용 금지 (지시서 §3.2).
// - PageArtDirection 을 CSS 변수 + modifier class + Grid/Flex variant 로 적용.
// - 콘텐츠 실측 크기를 puppeteer 로 측정해 A4 safe area 를 초과하면 블록을
//   다음 페이지로 자동 재배치 (지시서 §7).
// - 답안 공간·본문 폰트·이미지 비율을 축소해 페이지에 맞추지 않는다.
// - 특정 페이지에 art direction 이 없으면 Stage 4.1 composition renderer 를
//   fallback 으로 사용 (해당 페이지만 대체, 문서 전체는 그대로).

import puppeteer, { type Browser, type Page as PPage } from 'puppeteer-core';

import type { CompositionBlock, CompositionPage, PageCompositionPlan } from '@/services/learning-composition';
import type { LearningDocument, Section } from '@/services/learning-renderer/schema';
import { renderPrimitive, type AnswerVariant, type PrimitiveContext } from '@/services/learning-renderer/primitives';
import { buildBlockToSection } from '@/services/learning-renderer/composition-render';
import { primitiveStyles } from '@/services/learning-renderer/pdf-composition';

import type { BlockArtDirection, HybridQualityIssue, HybridQualityIssueCode, HybridRenderInput, PageArtDirection, PageDensityMetrics } from './types';

export interface RenderHybridOptions {
  useLocalChrome?: boolean;
  localChromePath?: string;
  answerVariant?: AnswerVariant;
  grade: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface HybridRenderResult {
  pdf: Buffer;
  /** 실제 렌더된 페이지 수 (reflow 결과 반영). */
  pageCount: number;
  /** 페이지별 밀도 지표. */
  densityMetrics: PageDensityMetrics[];
  /** 구조/완전성 게이트 이슈. 빈 배열이면 통과. */
  issues: HybridQualityIssue[];
  /** 원 composition block 중 실제 렌더된 blockId 집합. */
  renderedBlockIds: Set<string>;
  /** fallback 처리된 페이지 (art direction 미적용). */
  fallbackPageIds: string[];
  /** 실제 페이지 번호 → 소속 block 목록 (measurement 후). */
  pageBlockMap: Array<{ pageIndex: number; blockIds: string[] }>;
  html: string;
}

async function launchBrowser(o: RenderHybridOptions): Promise<Browser> {
  if (o.useLocalChrome) {
    if (!o.localChromePath) throw new Error('useLocalChrome=true 인데 localChromePath 없음');
    return puppeteer.launch({ executablePath: o.localChromePath, headless: true });
  }
  const { default: chromium } = await import('@sparticuz/chromium');
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}

export async function renderHybridArtDirectedPdf(
  input: HybridRenderInput,
  opts: RenderHybridOptions,
): Promise<HybridRenderResult> {
  const variant = opts.answerVariant ?? 'student';
  const { compositionPlan, document: doc, blockToImages, directionByPage } = input;
  const blockToSection = buildBlockToSection(compositionPlan, doc);

  const blockById = new Map<string, CompositionBlock>();
  for (const page of compositionPlan.pages) for (const b of page.blocks) blockById.set(b.blockId, b);

  // 페이지 HTML 생성 (art direction 이 있으면 hybrid, 없으면 fallback).
  const pageSpecs: Array<{
    kind: 'hybrid';
    direction: PageArtDirection;
    blocks: CompositionBlock[];
  } | {
    kind: 'fallback';
    pageId: string;
    blocks: CompositionBlock[];
    reason: string;
  }> = [];
  const fallbackPageIds: string[] = [];
  for (const page of compositionPlan.pages) {
    const dir = directionByPage.get(page.pageId);
    if (dir) {
      pageSpecs.push({ kind: 'hybrid', direction: dir, blocks: page.blocks });
    } else {
      pageSpecs.push({ kind: 'fallback', pageId: page.pageId, blocks: page.blocks, reason: 'no art direction' });
      fallbackPageIds.push(page.pageId);
    }
  }

  const rawPagesHtml: string[] = [];
  for (const spec of pageSpecs) {
    if (spec.kind === 'hybrid') {
      rawPagesHtml.push(await hybridPageHtml(spec.direction, spec.blocks, blockToSection, blockToImages, variant));
    } else {
      rawPagesHtml.push(await fallbackPageHtml(spec.pageId, spec.blocks, blockToSection, blockToImages, variant));
    }
  }

  const fullHtml = buildFullHtml(doc, opts.grade, rawPagesHtml);

  const browser = await launchBrowser(opts);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 1273 });
    await page.setContent(fullHtml, { waitUntil: 'load' });
    await page.evaluate(async () => {
      if ('fonts' in document) {
        await (document as unknown as { fonts: { ready: Promise<void> } }).fonts.ready;
      }
    });

    // 콘텐츠 실측 → overflow 감지 → 페이지 분할 재조정 (블록 이동 계획만 캡처).
    const currentSpecs = await reflowPagination({
      page, initialSpecs: pageSpecs, blockToSection, blockToImages, variant,
    });
    // 재조정된 spec 으로 최종 HTML 을 원본 map 을 사용해 rebuild.
    const finalPagesHtml: string[] = [];
    for (const spec of currentSpecs) {
      if (spec.kind === 'hybrid') {
        finalPagesHtml.push(await hybridPageHtml(spec.direction, spec.blocks, blockToSection, blockToImages, variant));
      } else {
        finalPagesHtml.push(await fallbackPageHtml(spec.pageId, spec.blocks, blockToSection, blockToImages, variant));
      }
    }
    const finalHtml = buildFullHtml(doc, opts.grade, finalPagesHtml);
    await page.setContent(finalHtml, { waitUntil: 'load' });
    await page.evaluate(async () => {
      if ('fonts' in document) {
        await (document as unknown as { fonts: { ready: Promise<void> } }).fonts.ready;
      }
    });

    // 최종 측정 (density + gate).
    const finalMeasurement = await page.evaluate(() => {
      const pages = Array.from(document.querySelectorAll('.hyb-page'));
      return pages.map((p, idx) => {
        const rect = (p as HTMLElement).getBoundingClientRect();
        const pageArea = rect.width * rect.height;
        const usedArea = calcUsedArea(p as HTMLElement, rect);
        const responseArea = calcAreaByClass(p as HTMLElement, '.pr-response, .cg-choice, .mb-container, .wg-grid, .cp-cell', rect);
        const visualArea = calcAreaByClass(p as HTMLElement, 'img', rect);
        const topHalfArea = calcAreaInBand(p as HTMLElement, rect, 0, 0.5);
        const bottomHalfArea = calcAreaInBand(p as HTMLElement, rect, 0.5, 1.0);
        const largestEmpty = calcLargestEmptyRegion(p as HTMLElement, rect);
        // Block-level overflow / clipping detection.
        const blocks = Array.from(p.querySelectorAll('[data-hyb-block]'));
        const overflowIds: string[] = [];
        const clippedIds: string[] = [];
        for (const b of blocks) {
          const br = (b as HTMLElement).getBoundingClientRect();
          const id = (b as HTMLElement).getAttribute('data-hyb-block') ?? '';
          if (br.right > rect.right + 1 || br.bottom > rect.bottom + 1 || br.left < rect.left - 1) {
            clippedIds.push(id);
          }
          if ((b as HTMLElement).scrollHeight > (b as HTMLElement).clientHeight + 1) overflowIds.push(id);
        }
        // Duplicate block detection.
        const seen = new Set<string>();
        const duplicates: string[] = [];
        for (const b of blocks) {
          const id = (b as HTMLElement).getAttribute('data-hyb-block') ?? '';
          if (seen.has(id)) duplicates.push(id);
          seen.add(id);
        }
        return {
          pageIndex: idx,
          pageArea,
          usedRatio: usedArea / pageArea,
          responseRatio: responseArea / pageArea,
          visualRatio: visualArea / pageArea,
          topHalfRatio: topHalfArea / (pageArea / 2),
          bottomHalfRatio: bottomHalfArea / (pageArea / 2),
          largestEmptyRatio: largestEmpty / pageArea,
          overflowIds,
          clippedIds,
          duplicates,
          blockIds: blocks.map((b) => (b as HTMLElement).getAttribute('data-hyb-block') ?? ''),
        };

        function calcUsedArea(root: HTMLElement, pageRect: DOMRect): number {
          const contentEls = Array.from(root.querySelectorAll('.hyb-block, .hyb-content-el'));
          let total = 0;
          for (const el of contentEls) {
            const r = (el as HTMLElement).getBoundingClientRect();
            const w = Math.max(0, Math.min(r.right, pageRect.right) - Math.max(r.left, pageRect.left));
            const h = Math.max(0, Math.min(r.bottom, pageRect.bottom) - Math.max(r.top, pageRect.top));
            total += w * h;
          }
          return total;
        }
        function calcAreaByClass(root: HTMLElement, sel: string, pageRect: DOMRect): number {
          const els = Array.from(root.querySelectorAll(sel));
          let total = 0;
          for (const el of els) {
            const r = (el as HTMLElement).getBoundingClientRect();
            const w = Math.max(0, Math.min(r.right, pageRect.right) - Math.max(r.left, pageRect.left));
            const h = Math.max(0, Math.min(r.bottom, pageRect.bottom) - Math.max(r.top, pageRect.top));
            total += w * h;
          }
          return total;
        }
        function calcAreaInBand(root: HTMLElement, pageRect: DOMRect, from: number, to: number): number {
          const bandTop = pageRect.top + (pageRect.height * from);
          const bandBottom = pageRect.top + (pageRect.height * to);
          const els = Array.from(root.querySelectorAll('.hyb-block'));
          let total = 0;
          for (const el of els) {
            const r = (el as HTMLElement).getBoundingClientRect();
            const top = Math.max(r.top, bandTop);
            const bottom = Math.min(r.bottom, bandBottom);
            if (bottom > top) total += r.width * (bottom - top);
          }
          return total;
        }
        function calcLargestEmptyRegion(root: HTMLElement, pageRect: DOMRect): number {
          // 단순화: 페이지 5개 세로 스트립으로 분할, 각 스트립에서 마지막 콘텐츠
          // 이후 남는 세로 여백 * 스트립 폭 중 최대.
          const strips = 5;
          const stripW = pageRect.width / strips;
          const els = Array.from(root.querySelectorAll('.hyb-block'));
          let maxEmpty = 0;
          for (let s = 0; s < strips; s += 1) {
            const stripLeft = pageRect.left + s * stripW;
            const stripRight = stripLeft + stripW;
            let stripBottom = pageRect.top;
            for (const el of els) {
              const r = (el as HTMLElement).getBoundingClientRect();
              if (r.right < stripLeft || r.left > stripRight) continue;
              if (r.bottom > stripBottom) stripBottom = r.bottom;
            }
            const emptyH = Math.max(0, pageRect.bottom - stripBottom);
            const emptyArea = emptyH * stripW;
            if (emptyArea > maxEmpty) maxEmpty = emptyArea;
          }
          return maxEmpty;
        }
      });
    });

    const pdfBuf = await page.pdf({
      format: 'A4',
      margin: { top: '18mm', right: '15mm', bottom: '18mm', left: '15mm' },
      printBackground: true,
    });

    // Aggregate metrics + issues.
    const densityMetrics: PageDensityMetrics[] = finalMeasurement.map((m) => ({
      pageIndex: m.pageIndex,
      usedContentAreaRatio: clamp01(m.usedRatio),
      largestEmptyRegionRatio: clamp01(m.largestEmptyRatio),
      responseSpaceRatio: clamp01(m.responseRatio),
      visualAssetAreaRatio: clamp01(m.visualRatio),
      topHalfUsageRatio: clamp01(m.topHalfRatio),
      bottomHalfUsageRatio: clamp01(m.bottomHalfRatio),
    }));

    const issues: HybridQualityIssue[] = [];
    for (const m of finalMeasurement) {
      for (const id of m.clippedIds) {
        issues.push({ code: 'BLOCK_CLIPPED', where: `page[${m.pageIndex}] block=${id}`, detail: '블록이 페이지 safe area 를 초과.' });
      }
      for (const id of m.duplicates) {
        issues.push({ code: 'BLOCK_RENDERED_TWICE', where: `page[${m.pageIndex}] block=${id}`, detail: '같은 blockId 가 두 번 렌더링됨.' });
      }
      for (const id of m.overflowIds) {
        // 별도 overflow flag — clipping 과 유사하지만 scrollHeight 기준.
        if (!m.clippedIds.includes(id)) {
          issues.push({ code: 'BLOCK_CLIPPED', where: `page[${m.pageIndex}] block=${id}`, detail: 'block content overflow.' });
        }
      }
    }

    const renderedBlockIds = new Set<string>();
    const pageBlockMap: Array<{ pageIndex: number; blockIds: string[] }> = finalMeasurement.map((m) => {
      for (const id of m.blockIds) if (id) renderedBlockIds.add(id);
      return { pageIndex: m.pageIndex, blockIds: m.blockIds.filter(Boolean) };
    });

    // 누락 block 감지 (원 composition 에는 있으나 최종에 없음).
    for (const [id] of blockById) {
      if (!renderedBlockIds.has(id)) {
        issues.push({
          code: 'BLOCK_CLIPPED',
          where: `block=${id}`,
          detail: '원본 composition block 이 최종 렌더에 존재하지 않음 (누락).',
        });
      }
    }

    return {
      pdf: Buffer.from(pdfBuf),
      pageCount: finalMeasurement.length,
      densityMetrics,
      issues,
      renderedBlockIds,
      fallbackPageIds,
      pageBlockMap,
      html: finalHtml,
    };
  } finally {
    await browser.close();
  }
}

// ============================================================
// HTML builders
// ============================================================
type PageSpec =
  | { kind: 'hybrid'; direction: PageArtDirection; blocks: CompositionBlock[] }
  | { kind: 'fallback'; pageId: string; blocks: CompositionBlock[]; reason: string };

async function hybridPageHtml(
  direction: PageArtDirection,
  blocks: CompositionBlock[],
  blockToSection: Map<string, Section>,
  blockToImages: Map<string, string[]>,
  variant: AnswerVariant,
): Promise<string> {
  // reading order 로 정렬.
  const orderMap = new Map(direction.readingOrder.map((id, i) => [id, i]));
  const orderedBlocks = [...blocks].sort((a, b) => (orderMap.get(a.blockId) ?? 999) - (orderMap.get(b.blockId) ?? 999));

  const cssVars = paletteVars(direction);
  const modifiers = pageModifiers(direction).join(' ');
  const layoutClass = `layout--${direction.pageIntent}`;

  const blockDirections = new Map(direction.blocks.map((b) => [b.sourceBlockId, b] as const));
  const blockHtmlList: string[] = [];
  for (const block of orderedBlocks) {
    const bd = blockDirections.get(block.blockId);
    blockHtmlList.push(await hybridBlockHtml(block, bd, blockToSection, blockToImages, variant));
  }

  return `<section class="hyb-page ${layoutClass} ${modifiers}" style="${cssVars}" data-page-id="${escapeHtml(direction.pageId)}" data-style-family="${escapeHtml(direction.styleFamily)}">
    <div class="hyb-page-grid">${blockHtmlList.join('\n')}</div>
  </section>`;
}

async function hybridBlockHtml(
  block: CompositionBlock,
  bd: BlockArtDirection | undefined,
  blockToSection: Map<string, Section>,
  blockToImages: Map<string, string[]>,
  variant: AnswerVariant,
): Promise<string> {
  const section = blockToSection.get(block.blockId);
  const imageUrls = blockToImages.get(block.blockId) ?? [];
  const ctx: PrimitiveContext = { block, section, imageUrls, variant };
  const primitiveHtml = await renderPrimitive(ctx);
  const modifiers = bd ? blockModifiers(bd).join(' ') : '';
  const layoutClass = bd ? `layout--${bd.layoutIntent}` : 'layout--stacked';
  const cols = bd?.preferredColumns ? `--hyb-columns:${bd.preferredColumns};` : '';
  return `<div class="hyb-block ${layoutClass} ${modifiers}" data-hyb-block="${escapeHtml(block.blockId)}" style="${cols}">
    ${primitiveHtml}
  </div>`;
}

async function fallbackPageHtml(
  pageId: string,
  blocks: CompositionBlock[],
  blockToSection: Map<string, Section>,
  blockToImages: Map<string, string[]>,
  variant: AnswerVariant,
): Promise<string> {
  const parts: string[] = [];
  for (const block of blocks) {
    const section = blockToSection.get(block.blockId);
    const imageUrls = blockToImages.get(block.blockId) ?? [];
    parts.push(`<div class="hyb-block" data-hyb-block="${escapeHtml(block.blockId)}">${await renderPrimitive({ block, section, imageUrls, variant })}</div>`);
  }
  return `<section class="hyb-page hyb-fallback" data-page-id="${escapeHtml(pageId)}" data-fallback="true">
    <div class="hyb-page-grid">${parts.join('\n')}</div>
  </section>`;
}

function buildFullHtml(doc: LearningDocument, grade: number, pagesHtml: string[]): string {
  const title = escapeHtml(doc.meta.title);
  const subject = escapeHtml(doc.meta.subject);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8" /><title>${title}</title>
<style>${baseStyles(grade)}</style>
</head><body>
${pagesHtml.map((h, i) => `<section class="hyb-page-wrap" data-page-no="${i + 1}">
  <header class="hyb-header"><span>${subject} · ${grade}학년</span><span class="hyb-title">${title}</span><span>${i + 1} / ${pagesHtml.length}</span></header>
  ${h}
</section>`).join('\n')}
</body></html>`;
}

// ============================================================
// Reflow — 실측 후 overflow 발생 시 블록을 다음 페이지로 이동.
// 매 이터레이션마다 실제 blockToSection/blockToImages 를 사용해 HTML 을
// 완전히 rebuild 하여 정확한 크기로 재측정한다.
// ============================================================
async function reflowPagination(args: {
  page: PPage;
  initialSpecs: PageSpec[];
  blockToSection: Map<string, Section>;
  blockToImages: Map<string, string[]>;
  variant: AnswerVariant;
}): Promise<PageSpec[]> {
  const { page, initialSpecs, blockToSection, blockToImages, variant } = args;
  // deep-ish copy blocks arrays.
  let currentSpecs: PageSpec[] = initialSpecs.map((s) =>
    s.kind === 'hybrid'
      ? { kind: 'hybrid', direction: s.direction, blocks: [...s.blocks] }
      : { kind: 'fallback', pageId: s.pageId, blocks: [...s.blocks], reason: s.reason },
  );
  const MAX_ITER = 4;
  for (let iter = 0; iter < MAX_ITER; iter += 1) {
    const overflowInfo = await page.evaluate(() => {
      const pageEls = Array.from(document.querySelectorAll('.hyb-page-wrap'));
      const info: Array<{ pageIndex: number; overflowingBlockIds: string[] }> = [];
      for (let i = 0; i < pageEls.length; i += 1) {
        const wrap = pageEls[i] as HTMLElement;
        const pageRect = wrap.getBoundingClientRect();
        const blocks = Array.from(wrap.querySelectorAll('[data-hyb-block]'));
        const overflowing: string[] = [];
        for (const b of blocks) {
          const br = (b as HTMLElement).getBoundingClientRect();
          if (br.bottom > pageRect.bottom + 1) {
            overflowing.push((b as HTMLElement).getAttribute('data-hyb-block') ?? '');
          }
        }
        if (overflowing.length > 0) info.push({ pageIndex: i, overflowingBlockIds: overflowing });
      }
      return info;
    });
    if (overflowInfo.length === 0) return currentSpecs;

    let mutated = false;
    for (const info of overflowInfo) {
      const spec = currentSpecs[info.pageIndex];
      if (!spec || spec.blocks.length <= 1) continue;
      const lastId = info.overflowingBlockIds[info.overflowingBlockIds.length - 1];
      const idx = spec.blocks.findIndex((b) => b.blockId === lastId);
      if (idx < 0) continue;
      const [moved] = spec.blocks.splice(idx, 1);
      if (!moved) continue;
      const next = currentSpecs[info.pageIndex + 1];
      if (next) {
        next.blocks.unshift(moved);
      } else {
        currentSpecs.push({
          kind: 'fallback',
          pageId: `overflow-${moved.blockId}`,
          blocks: [moved],
          reason: 'reflow-continued',
        });
      }
      mutated = true;
    }
    if (!mutated) return currentSpecs;

    // 재빌드.
    const pagesHtml: string[] = [];
    for (const s of currentSpecs) {
      if (s.kind === 'hybrid') {
        pagesHtml.push(await hybridPageHtml(s.direction, s.blocks, blockToSection, blockToImages, variant));
      } else {
        pagesHtml.push(await fallbackPageHtml(s.pageId, s.blocks, blockToSection, blockToImages, variant));
      }
    }
    // grade 를 알 필요 없이 최소 HTML 로 재검사 (측정만 목적).
    const html = `<!doctype html><html><head><style>@page{size:A4;margin:18mm 15mm}html,body{margin:0;padding:0;font-family:'Malgun Gothic',sans-serif;font-size:12pt;line-height:1.55}</style></head><body>${pagesHtml
      .map((h, i) => `<section class="hyb-page-wrap">${h}</section>`)
      .join('\n')}</body></html>`;
    await page.setContent(html, { waitUntil: 'load' });
  }
  return currentSpecs;
}

// ============================================================
// Styling
// ============================================================
function paletteVars(d: PageArtDirection): string {
  const p = d.paletteRoles;
  return [
    `--art-page-background:${p.pageBackground}`,
    `--art-surface:${p.surface}`,
    `--art-surface-alt:${p.surfaceAlt}`,
    `--art-primary:${p.primary}`,
    `--art-secondary:${p.secondary}`,
    `--art-accent:${p.accent}`,
    `--art-text-primary:${p.textPrimary}`,
    `--art-text-secondary:${p.textSecondary}`,
    `--art-answer-area:${p.answerArea}`,
    `--art-border:${p.border}`,
  ].join(';') + ';';
}

function pageModifiers(d: PageArtDirection): string[] {
  return [
    `art-density--${d.density}`,
    `art-decoration--${d.decorationLevel}`,
    `art-radius--${d.shapeRoles.radiusScale}`,
    `art-badge--${d.shapeRoles.badgeStyle}`,
    `art-border--${d.shapeRoles.borderStyle}`,
    `art-shadow--${d.shapeRoles.shadowLevel}`,
    `art-display--${d.typographyRoles.displayScale}`,
    `art-instruction--${d.typographyRoles.instructionScale}`,
    `art-body--${d.typographyRoles.bodyScale}`,
    `art-weight--${d.typographyRoles.weightContrast}`,
    `art-style--${cssSafe(d.styleFamily)}`,
  ];
}

function blockModifiers(bd: BlockArtDirection): string[] {
  return [
    `hierarchy--${bd.hierarchy}`,
    `image-scale--${bd.imageScale}`,
    `response-space--${bd.responseSpace}`,
    `card-emphasis--${bd.cardEmphasis}`,
    `image-position--${bd.imagePosition ?? 'inline'}`,
    `decoration--${bd.decorationRole ?? 'none'}`,
  ];
}

function cssSafe(s: string): string {
  return s.replace(/[^a-zA-Z0-9-]+/g, '-').toLowerCase();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1.5) return 1.5;
  return n;
}

function baseStyles(grade: number): string {
  // 학년별 최소 폰트 크기 (지시서 §10 사이 게이트).
  const bodyFont = grade <= 2 ? '13pt' : grade <= 4 ? '11.5pt' : '10.5pt';
  const bodyLine = grade <= 2 ? '1.65' : grade <= 4 ? '1.55' : '1.5';
  return `
@page { size: A4; margin: 18mm 15mm; }
html, body { margin: 0; padding: 0; font-family: 'Malgun Gothic', 'Noto Sans KR', system-ui, sans-serif; color: var(--art-text-primary, #111827); background: var(--art-page-background, #ffffff); font-size: ${bodyFont}; line-height: ${bodyLine}; }
.hyb-page-wrap { page-break-after: always; padding: 0; }
.hyb-page-wrap:last-child { page-break-after: auto; }
.hyb-header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid var(--art-border, #e5e7eb); padding-bottom: 3mm; margin-bottom: 5mm; font-size: 9pt; color: var(--art-text-secondary, #6b7280); }
.hyb-header .hyb-title { color: var(--art-text-primary, #111827); font-weight: 700; font-size: 12pt; }
.hyb-page { display: block; background: var(--art-page-background, #ffffff); }
.hyb-page-grid { display: grid; grid-template-columns: 1fr; gap: var(--content-gap, 6mm); }
.hyb-block { break-inside: avoid; padding: var(--section-pad, 3mm); border-radius: var(--radius-md, 14px); background: var(--art-surface, transparent); }

/* Density */
.art-density--airy { --content-gap: 10mm; --section-pad: 6mm; }
.art-density--comfortable { --content-gap: 6mm; --section-pad: 4mm; }
.art-density--compact { --content-gap: 4mm; --section-pad: 2mm; }

/* Radius */
.art-radius--small { --radius-md: 6px; --radius-lg: 10px; }
.art-radius--medium { --radius-md: 14px; --radius-lg: 22px; }
.art-radius--large { --radius-md: 22px; --radius-lg: 30px; }

/* Layout intent (page-level) */
.layout--stacked > .hyb-page-grid { grid-template-columns: 1fr; }
.layout--balanced-split > .hyb-page-grid { grid-template-columns: 1fr 1fr; }
.layout--activity-grid > .hyb-page-grid { grid-template-columns: repeat(2, 1fr); }
.layout--hero-then-practice > .hyb-page-grid { grid-template-columns: 1fr; grid-template-rows: auto auto; }
.layout--comparison-pair > .hyb-page-grid { grid-template-columns: 1fr 1fr; }
.layout--sequence-flow > .hyb-page-grid { grid-template-columns: 1fr; }
.layout--image-left-response-right > .hyb-page-grid,
.layout--image-right-response-left > .hyb-page-grid { grid-template-columns: 1fr 1fr; }
.layout--image-top-response-bottom > .hyb-page-grid { grid-template-columns: 1fr; }

/* Block-level layout intents when nested inside hyb-block */
.hyb-block.layout--image-left-response-right .prim { display: grid; grid-template-columns: 45% 1fr; gap: 6mm; align-items: start; }
.hyb-block.layout--image-right-response-left .prim { display: grid; grid-template-columns: 1fr 45%; gap: 6mm; align-items: start; }
.hyb-block.layout--balanced-split .prim { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
.hyb-block.layout--activity-grid .prim { display: grid; grid-template-columns: repeat(var(--hyb-columns, 3), 1fr); gap: 4mm; }
.hyb-block.layout--comparison-pair .prim { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }

/* Hierarchy */
.hierarchy--hero { font-size: 1.05em; }
.hierarchy--hero .pr-instruction { font-size: 14pt; }
.hierarchy--high .pr-instruction { font-size: 12.5pt; }
.hierarchy--medium .pr-instruction { font-size: 11.5pt; }
.hierarchy--low .pr-instruction { font-size: 11pt; opacity: 0.95; }

/* Image scale */
.image-scale--hero img { max-width: 100% !important; max-height: 95mm !important; }
.image-scale--large img { max-width: 90% !important; max-height: 75mm !important; }
.image-scale--medium img { max-width: 70% !important; max-height: 55mm !important; }
.image-scale--small img { max-width: 55% !important; max-height: 38mm !important; }

/* Response space */
.response-space--large .io-answer-line, .response-space--large .or-line-answer, .response-space--large .cp-line { min-height: 12mm; }
.response-space--medium .io-answer-line, .response-space--medium .or-line-answer, .response-space--medium .cp-line { min-height: 8mm; }
.response-space--small .io-answer-line, .response-space--small .or-line-answer, .response-space--small .cp-line { min-height: 5mm; }
.response-space--none .io-answer-line, .response-space--none .or-line-answer, .response-space--none .cp-line { display: none; }

/* Card emphasis */
.card-emphasis--soft { background: var(--art-surface-alt); }
.card-emphasis--primary { background: color-mix(in srgb, var(--art-primary) 12%, white); border: 1px solid color-mix(in srgb, var(--art-primary) 30%, transparent); }
.card-emphasis--contrast { background: var(--art-primary); color: #ffffff; }
.card-emphasis--contrast .pr-instruction { color: #ffffff; }
.card-emphasis--none { background: transparent; }

/* Badge style */
.art-badge--circle .cg-num, .art-badge--circle .ep-step-num { border-radius: 999px; }
.art-badge--pill .cg-num, .art-badge--pill .ep-step-num { border-radius: 999px; padding: 2pt 8pt; }
.art-badge--rounded-square .cg-num, .art-badge--rounded-square .ep-step-num { border-radius: 6px; }

/* Border style */
.art-border--none .prim { border: none; }
.art-border--soft .prim { border: 1px solid var(--art-border); }
.art-border--clear .prim { border: 1.5px solid color-mix(in srgb, var(--art-primary) 45%, var(--art-border)); }

/* Shadow */
.art-shadow--soft .prim { box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.art-shadow--none .prim { box-shadow: none; }

/* Decoration */
.art-decoration--minimal .prim::before { display: none; }
.art-decoration--soft .card-emphasis--primary { position: relative; }
.art-decoration--playful .card-emphasis--primary::after { content: ''; position: absolute; width: 12mm; height: 12mm; border-radius: 999px; background: color-mix(in srgb, var(--art-accent) 45%, transparent); top: -4mm; right: -4mm; z-index: 0; }

/* Fallback pages */
.hyb-fallback .hyb-page-grid { grid-template-columns: 1fr; gap: 6mm; }

${primitiveStyles()}
`;
}
