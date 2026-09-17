// Composition-driven PDF renderer.
//
// Renderer 는 PageCompositionPlan.pages 순서대로 CSS grid layout 을 emit 하고
// 각 CompositionBlock 을 primitive 로 dispatch 한다. 골든 헤더/명찰/자기평가는
// primitive (instruction-strip / reflection-strip) 로 표현되며, renderer 가
// 무조건 삽입하지 않는다.

import puppeteer, { type Browser } from 'puppeteer-core';

import type { PageCompositionPlan } from '@/services/learning-composition';
import { layoutToGridColumns } from './composition-render';
import { renderPrimitive, type AnswerVariant } from './primitives';
import type { CompositionRenderInput } from './composition-render';

export interface RenderCompositionPdfOptions {
  useLocalChrome?: boolean;
  localChromePath?: string;
  answerVariant?: AnswerVariant;
}

async function launchBrowser(options: RenderCompositionPdfOptions): Promise<Browser> {
  if (options.useLocalChrome) {
    if (!options.localChromePath)
      throw new Error('useLocalChrome=true 인데 localChromePath 가 지정되지 않았어요');
    return puppeteer.launch({
      executablePath: options.localChromePath,
      headless: true,
    });
  }
  const { default: chromium } = await import('@sparticuz/chromium');
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}

export async function renderCompositionPdf(
  input: CompositionRenderInput,
  options: RenderCompositionPdfOptions = {},
): Promise<Buffer> {
  const variant = options.answerVariant ?? 'combined';
  const html = await compositionToHtml(input, variant);
  const browser = await launchBrowser(options);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(async () => {
      if ('fonts' in document) {
        await (document as unknown as { fonts: { ready: Promise<void> } }).fonts.ready;
      }
    });
    const buffer = await page.pdf({
      format: 'A4',
      margin: { top: '18mm', right: '15mm', bottom: '18mm', left: '15mm' },
      printBackground: true,
    });
    return Buffer.from(buffer);
  } finally {
    await browser.close();
  }
}

export async function compositionToHtml(
  input: CompositionRenderInput,
  variant: AnswerVariant,
): Promise<string> {
  const { compositionPlan, blockToSection, blockToImages, document: doc } = input;

  // 페이지별 HTML 렌더.
  const pageHtmlList: string[] = [];
  for (let pi = 0; pi < compositionPlan.pages.length; pi++) {
    const page = compositionPlan.pages[pi]!;
    const gridCols = layoutToGridColumns(page);

    // 블록을 배치 순서 (column-order 우선, order 보조) 로 정렬.
    const sorted = [...page.blocks].sort((a, b) => {
      if (a.placement.order !== b.placement.order) return a.placement.order - b.placement.order;
      return a.placement.column - b.placement.column;
    });

    const blockHtmlList = await Promise.all(
      sorted.map(async (block) => {
        const section = blockToSection.get(block.blockId);
        const imageUrls = blockToImages.get(block.blockId) ?? [];
        const inner = await renderPrimitive({ block, section, imageUrls, variant });
        const col = block.placement.column;
        const span = block.placement.columnSpan ?? 1;
        const wf = block.placement.widthFraction ?? 1.0;
        const style =
          page.layout === 'single' || page.layout === 'sequence' || page.layout === 'canvas'
            ? `width: ${Math.round(wf * 100)}%;`
            : `grid-column: ${col} / span ${span};`;
        return `<div class="block-slot" style="${style}">${inner}</div>`;
      }),
    );

    const isFirst = pi === 0;
    const isLast = pi === compositionPlan.pages.length - 1;
    const pageMeta = renderPageMeta({ doc, page, pi, totalPages: compositionPlan.pages.length, isFirst, isLast, variant });

    pageHtmlList.push(
      `<article class="page-frame ${pi > 0 ? 'break-before' : ''}" data-page="${page.pageId}">
        ${pageMeta}
        <div class="page-grid layout-${page.layout}" style="grid-template-columns: ${gridCols};">${blockHtmlList.join('')}</div>
      </article>`,
    );
  }

  const strategy = compositionPlan.documentStrategy;
  const variantBadge =
    variant === 'student' ? '학생용' : variant === 'teacher' ? '교사용' : '학생용 + 정답';

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${esc(doc.meta.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet" />
<style>
  ${baseStyles(strategy.density, doc.meta.grade)}
  ${primitiveStyles()}
</style>
</head>
<body>
${pageHtmlList.join('\n')}
</body>
</html>`;
}

function renderPageMeta(input: {
  doc: CompositionRenderInput['document'];
  page: PageCompositionPlan['pages'][number];
  pi: number;
  totalPages: number;
  isFirst: boolean;
  isLast: boolean;
  variant: AnswerVariant;
}): string {
  const { doc, page, pi, totalPages, isFirst, variant } = input;
  const variantBadge =
    variant === 'student' ? '학생용' : variant === 'teacher' ? '교사용' : '학생용 + 정답';
  const pageNum = `${page.pageNumber} / ${totalPages}`;
  if (isFirst) {
    return `<header class="page-header page-header-first">
      <div class="ph-brand">${esc(SUBJECT_LABEL[doc.meta.subject] ?? doc.meta.subject)} · ${doc.meta.grade}학년</div>
      <h1 class="ph-title">${esc(doc.meta.title)}</h1>
      <div class="ph-meta">
        ${page.purpose ? `<span class="ph-purpose">${esc(page.purpose)}</span>` : ''}
        <span class="ph-badge">${esc(variantBadge)}</span>
        <span class="ph-page">${pageNum}</span>
      </div>
    </header>`;
  }
  return `<header class="page-header page-header-cont">
    <div class="ph-brand">${esc(SUBJECT_LABEL[doc.meta.subject] ?? doc.meta.subject)} · ${doc.meta.grade}학년</div>
    <div class="ph-title-cont">${esc(doc.meta.title)}${page.purpose ? ` · ${esc(page.purpose)}` : ''}</div>
    <div class="ph-page">${pageNum}</div>
  </header>`;
}

const SUBJECT_LABEL: Record<string, string> = {
  KOR: '국어',
  MATH: '수학',
  INT: '통합교과',
  SOC: '사회',
  MOR: '도덕',
  SCI: '과학',
  PRA: '실과',
  PE: '체육',
  MUS: '음악',
  ART: '미술',
  ENG: '영어',
  CREATIVE: '창의적 체험활동',
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function baseStyles(density: 'low' | 'medium' | 'high', grade: number): string {
  // 학년에 따라 글자 크기·행간 조정 (저학년은 크게).
  const bodyFont = grade <= 2 ? 12 : grade <= 4 ? 11 : 10.5;
  const lineH = grade <= 2 ? 1.6 : 1.5;
  const blockGap = density === 'high' ? 5 : density === 'low' ? 12 : 8;
  return `
  @font-face {
    font-family: 'Pretendard';
    src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/pretendard@1.0/Pretendard-Regular.woff2') format('woff2');
    font-weight: 400; font-display: swap;
  }
  @font-face {
    font-family: 'Pretendard';
    src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/pretendard@1.0/Pretendard-Bold.woff2') format('woff2');
    font-weight: 700; font-display: swap;
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'Pretendard', 'Noto Sans KR', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;
    color: #1a1a1a;
    line-height: ${lineH};
    font-size: ${bodyFont}pt;
    margin: 0; padding: 0;
  }
  .page-frame {
    position: relative;
  }
  .break-before { page-break-before: always; break-before: page; }
  .page-grid {
    display: grid;
    gap: ${blockGap}pt;
    margin-top: 8pt;
  }
  .page-grid.layout-sequence { display: flex; flex-direction: column; gap: ${blockGap}pt; }
  .page-grid.layout-canvas { display: block; }
  .block-slot {
    min-width: 0;
    break-inside: avoid-page;
    page-break-inside: avoid;
  }
  .page-header {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: baseline;
    gap: 10pt;
    padding-bottom: 6pt;
    border-bottom: 1.5px solid #cbd5e1;
    margin-bottom: 6pt;
  }
  .page-header-first {
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto auto;
  }
  .page-header-first .ph-brand { grid-column: 1; grid-row: 1; font-size: 9pt; color: #64748b; }
  .page-header-first .ph-title { grid-column: 1; grid-row: 2; margin: 2pt 0 0; font-size: 20pt; color: #1e293b; }
  .page-header-first .ph-meta {
    grid-column: 1 / -1; grid-row: 3;
    display: flex; align-items: center; gap: 10pt; margin-top: 4pt;
    font-size: 10pt; color: #64748b;
  }
  .page-header-first .ph-purpose { color: #475569; }
  .page-header-first .ph-badge {
    padding: 2pt 8pt; border-radius: 999pt;
    background: #eff6ff; color: #1d4ed8; font-weight: 700; font-size: 9pt;
    border: 1px solid #dbeafe;
  }
  .page-header-first .ph-page { margin-left: auto; font-weight: 500; }
  .page-header-cont {
    font-size: 9pt; color: #64748b; padding: 2pt 0;
  }
  .page-header-cont .ph-brand { color: #94a3b8; }
  .page-header-cont .ph-title-cont { color: #334155; font-weight: 500; }
  .page-header-cont .ph-page { color: #94a3b8; }
  `;
}

export function primitiveStyles(): string {
  // 각 primitive 는 실제로 다른 배치·색·시선 흐름을 갖도록 스타일 부여.
  return `
  .prim { padding: 8pt 10pt; border-radius: 8pt; break-inside: avoid-page; page-break-inside: avoid; }
  .prim .pr-instruction {
    font-size: 11pt; font-weight: 600; color: #1e293b; margin: 0 0 6pt;
  }
  .prim .teacher-overlay {
    margin-top: 6pt; padding: 5pt 10pt; border-left: 3px solid #f59e0b;
    background: #fef7ed; color: #78350f; font-size: 9.5pt; border-radius: 0 4pt 4pt 0;
  }
  .prim .img-fail { color: #ef4444; font-size: 9pt; font-style: italic; }

  /* 1. instruction-strip: 하늘색 상단 밴드 · 아이콘 좌측 · 텍스트 우측 */
  .prim-instruction-strip {
    background: #eff6ff; border: 0; padding: 8pt 14pt;
    border-radius: 999pt;
  }
  .prim-instruction-strip .ins-inner {
    display: flex; align-items: center; gap: 10pt;
  }
  .prim-instruction-strip .ins-img { flex: 0 0 auto; }
  .prim-instruction-strip .ins-text { flex: 1; color: #1e40af; font-weight: 600; font-size: 11pt; }

  /* 2. concept-panel: 좌우 or 상하 분할, 은은한 회색 카드 */
  .prim-concept-panel {
    background: #f8fafc; border: 1px solid #e2e8f0; padding: 10pt 12pt;
  }
  .prim-concept-panel .cp-title {
    font-size: 12pt; font-weight: 700; color: #0f172a; margin: 0 0 4pt;
  }
  .prim-concept-panel .cp-body { display: flex; gap: 12pt; align-items: flex-start; }
  .prim-concept-panel .cp-body.cp-stack { flex-direction: column; }
  .prim-concept-panel .cp-body.cp-side { flex-direction: row; }
  .prim-concept-panel .cp-img { flex: 0 0 auto; }
  .prim-concept-panel .cp-text { flex: 1; color: #334155; }

  /* 3. example-panel: 예시 박스 (인디고) + 연습 리스트 (회색) */
  .prim-example-panel {
    background: #ffffff; border: 1px solid #e2e8f0; padding: 10pt 12pt;
  }
  .prim-example-panel .ep-example {
    background: #eef2ff; border-left: 4px solid #6366f1;
    padding: 8pt 12pt; border-radius: 0 6pt 6pt 0;
    margin-bottom: 8pt;
  }
  .prim-example-panel .ep-example-label {
    font-weight: 700; color: #4338ca; font-size: 10pt; margin-bottom: 3pt;
  }
  .prim-example-panel .ep-example-problem { font-weight: 600; color: #1e293b; margin-bottom: 4pt; }
  .prim-example-panel .ep-steps { padding-left: 0; margin: 4pt 0; list-style: none; }
  .prim-example-panel .ep-steps li { margin: 3pt 0; padding-left: 22pt; position: relative; }
  .prim-example-panel .ep-step-num {
    position: absolute; left: 0; top: 0;
    display: inline-flex; align-items: center; justify-content: center;
    width: 16pt; height: 16pt; border-radius: 999pt;
    background: #4338ca; color: #ffffff; font-size: 9pt; font-weight: 700;
  }
  .prim-example-panel .ep-practice-label { font-weight: 700; color: #0f172a; margin: 4pt 0 4pt; }
  .prim-example-panel .ep-practice-list { padding-left: 20pt; margin: 0; }
  .prim-example-panel .ep-practice-list li { margin: 6pt 0; }
  .prim-example-panel .ep-answer-blank {
    display: inline-block; min-width: 50pt; border-bottom: 1.2px solid #94a3b8; margin-left: 6pt;
  }
  .prim-example-panel .ep-answer {
    display: inline-block; margin-left: 6pt; color: #059669; font-weight: 700;
  }

  /* 4. matching-board: 좌우 컬럼 + 앵커 점, 민트 배경 */
  .prim-matching-board {
    background: #ecfdf5; border: 1px solid #a7f3d0; padding: 12pt;
  }
  .prim-matching-board .mb-container {
    display: grid; grid-template-columns: 1fr 40pt 1fr;
    gap: 12pt; align-items: center;
  }
  .prim-matching-board .mb-col {
    list-style: none; padding: 0; margin: 0;
    display: flex; flex-direction: column; gap: 8pt;
  }
  .prim-matching-board .mb-col-left { align-items: flex-end; }
  .prim-matching-board .mb-col-right { align-items: flex-start; }
  .prim-matching-board .mb-row {
    display: flex; align-items: center; gap: 8pt;
  }
  .prim-matching-board .mb-badge {
    display: inline-flex; align-items: center; justify-content: center;
    width: 30pt; height: 30pt; border-radius: 999pt;
    background: #ffffff; border: 2px solid #10b981;
    font-weight: 700; font-size: 14pt; color: #047857;
  }
  .prim-matching-board .mb-anchor {
    width: 5pt; height: 5pt; border-radius: 999pt; background: #059669;
  }
  .prim-matching-board .mb-content {
    display: flex; align-items: center; gap: 6pt;
    background: #ffffff; border: 1.5px solid #a7f3d0;
    padding: 4pt 10pt; border-radius: 999pt;
  }
  .prim-matching-board .mb-content img { max-height: 22mm; }
  .prim-matching-board .mb-word { color: #065f46; font-weight: 500; }
  .prim-matching-board .mb-space {}

  /* 5. choice-grid: 여러 선택지 · 옅은 노랑 배경, 각 선택지 하양 카드 */
  .prim-choice-grid {
    background: #fffbeb; border: 1px solid #fde68a; padding: 10pt 12pt;
  }
  .prim-choice-grid .cg-grid {
    display: grid; gap: 8pt;
  }
  .prim-choice-grid .cg-choice {
    background: #ffffff; border: 1.5px solid #fef3c7;
    border-radius: 8pt; padding: 8pt; text-align: center;
    position: relative;
  }
  .prim-choice-grid .cg-num {
    display: inline-flex; align-items: center; justify-content: center;
    width: 18pt; height: 18pt; border-radius: 999pt;
    background: #f59e0b; color: #ffffff; font-weight: 700; font-size: 10pt;
    position: absolute; top: 5pt; left: 5pt;
  }
  .prim-choice-grid .cg-choice img { max-height: 35mm; margin: 4pt auto; display: block; }
  .prim-choice-grid .cg-label { font-size: 11pt; color: #78350f; margin-top: 4pt; }

  /* 6. image-observation: 좌측 큰 이미지 + 우측 유도 질문 */
  .prim-image-observation {
    background: #f0f9ff; border: 1px solid #bae6fd; padding: 12pt;
  }
  .prim-image-observation .io-container {
    display: grid; grid-template-columns: 55% 1fr; gap: 12pt; align-items: flex-start;
  }
  .prim-image-observation .io-image { text-align: center; }
  .prim-image-observation .io-prompts { padding-left: 0; margin: 0; list-style: decimal; padding-left: 20pt; }
  .prim-image-observation .io-prompts li { margin: 6pt 0; }
  .prim-image-observation .io-prompt { color: #0c4a6e; font-weight: 500; }
  .prim-image-observation .io-answer-line { margin-top: 3pt; border-bottom: 1.2px solid #7dd3fc; height: 18pt; }
  .prim-image-observation .io-answer { margin-top: 3pt; color: #059669; font-weight: 700; }

  /* 7. compare-panel: 좌우 (또는 3열) 대비 컬럼 */
  .prim-compare-panel {
    background: #fdf2f8; border: 1px solid #fbcfe8; padding: 12pt;
  }
  .prim-compare-panel .cmp-container {
    display: grid; gap: 10pt;
  }
  .prim-compare-panel .cmp-col {
    background: #ffffff; border-radius: 6pt; padding: 8pt 10pt;
    border: 1px solid #fce7f3;
  }
  .prim-compare-panel .cmp-cat-title {
    text-align: center; font-weight: 700; color: #be185d;
    border-bottom: 1px dashed #f9a8d4; padding-bottom: 4pt; margin-bottom: 6pt;
  }
  .prim-compare-panel .cmp-cat-body {
    display: flex; flex-wrap: wrap; gap: 5pt; min-height: 30mm;
  }
  .prim-compare-panel .cmp-item {
    padding: 3pt 8pt; background: #fdf2f8; border: 1px solid #fce7f3;
    border-radius: 999pt; font-size: 10pt; color: #9d174d;
  }

  /* 8. sequence-steps: 수평 나열 카드 + 순서 슬롯 */
  .prim-sequence-steps {
    background: #f5f3ff; border: 1px solid #ddd6fe; padding: 10pt 12pt;
  }
  .prim-sequence-steps .ss-container {
    display: flex; gap: 8pt; padding-left: 0; margin: 0; list-style: none; overflow-x: auto;
  }
  .prim-sequence-steps .ss-card {
    flex: 1 1 0; min-width: 80pt;
    background: #ffffff; border: 1.5px solid #ddd6fe;
    border-radius: 8pt; padding: 6pt; text-align: center;
  }
  .prim-sequence-steps .ss-card img { max-height: 30mm; margin: 2pt auto; display: block; }
  .prim-sequence-steps .ss-text { font-size: 10pt; color: #5b21b6; margin-top: 3pt; }
  .prim-sequence-steps .ss-slot {
    margin-top: 4pt; padding: 3pt 6pt;
    border: 1.2px dashed #8b5cf6; border-radius: 4pt;
    font-size: 9pt; color: #7c3aed;
  }

  /* 9. writing-practice: 격자 쓰기 · 좌측 견본 이미지 (옵션) + 우측 격자 */
  .prim-writing-practice {
    background: #ecfeff; border: 1px solid #a5f3fc; padding: 10pt 12pt;
  }
  .prim-writing-practice .wp-container {
    display: flex; gap: 12pt; align-items: flex-start;
  }
  .prim-writing-practice .wp-guide { flex: 0 0 auto; }
  .prim-writing-practice .wp-guide img { max-height: 35mm; }
  .prim-writing-practice .wp-grid {
    flex: 1; display: grid; gap: 2pt;
    background: #ffffff; padding: 6pt; border-radius: 6pt;
  }
  .prim-writing-practice .wp-cell {
    border: 1.2px dashed #0891b2;
    aspect-ratio: 1;
    display: flex; align-items: center; justify-content: center;
    color: #a5f3fc; font-size: 16pt;
  }

  /* 10. calculation-practice: 세로 계산 그리드 */
  .prim-calculation-practice {
    background: #ffffff; border: 1px solid #e5e7eb; padding: 10pt 12pt;
  }
  .prim-calculation-practice .calc-grid { display: grid; gap: 10pt; }
  .prim-calculation-practice .calc-cell {
    background: #f8fafc; border: 1px solid #e2e8f0;
    padding: 10pt 12pt; border-radius: 6pt;
  }
  .prim-calculation-practice .calc-problem { font-family: 'Courier New', monospace; font-size: 14pt; font-weight: 600; text-align: center; margin-bottom: 8pt; color: #0f172a; }
  .prim-calculation-practice .calc-answer { text-align: center; font-size: 11pt; }
  .prim-calculation-practice .cp-ans-blank {
    display: inline-block; min-width: 40pt; border-bottom: 1.2px solid #64748b; margin-left: 4pt;
  }
  .prim-calculation-practice .cp-ans-teacher { color: #059669; font-weight: 700; margin-left: 4pt; }

  /* 11. open-response: 넓은 응답 공간 */
  .prim-open-response {
    background: #ffffff; border: 1px solid #e5e7eb; padding: 10pt 12pt;
  }
  .prim-open-response .or-container { }
  .rs-lines { display: grid; gap: 0; margin-top: 4pt; }
  .rs-line { border-bottom: 1.2px solid #94a3b8; height: 22pt; }
  .rs-box {
    border: 1.5px dashed #94a3b8; border-radius: 4pt; margin-top: 4pt;
    background: repeating-linear-gradient(45deg, transparent, transparent 8pt, rgba(148,163,184,0.05) 8pt, rgba(148,163,184,0.05) 16pt);
  }
  .rs-grid { display: grid; gap: 2pt; margin-top: 4pt; }
  .rs-cell { border: 1.2px dashed #94a3b8; aspect-ratio: 1; background: #ffffff; }
  .rs-manuscript { display: grid; gap: 0; margin-top: 4pt; }
  .rs-manuscript-cell { border: 1.2px solid #94a3b8; aspect-ratio: 1; background: #ffffff; }
  .rs-drawing {
    border: 1.5px dashed #94a3b8; border-radius: 4pt; margin-top: 4pt;
    background: #fdfdfd;
  }

  /* 12. reflection-strip: 하단 자기 점검 pill */
  .prim-reflection-strip {
    background: #fdf2f8; border: 1px solid #fce7f3; padding: 8pt 14pt;
    border-radius: 999pt;
  }
  .prim-reflection-strip .ref-inner {
    display: flex; align-items: center; gap: 12pt;
  }
  .prim-reflection-strip .ref-label {
    color: #be185d; font-weight: 700; font-size: 10pt; letter-spacing: 0.4pt;
  }
  .prim-reflection-strip .ref-question { color: #475569; font-size: 10pt; flex: 1; }
  .prim-reflection-strip .ref-options { display: flex; gap: 12pt; }
  .prim-reflection-strip .ref-option {
    display: flex; align-items: center; gap: 5pt; font-size: 10pt; color: #475569;
  }
  .prim-reflection-strip .ref-option::before {
    content: ''; display: inline-block; width: 12pt; height: 12pt;
    border-radius: 999pt; border: 1.5px solid #f9a8d4; background: #ffffff;
  }

  /* 13. visual-canvas: 전체 폭 그림 */
  .prim-visual-canvas {
    background: #ffffff; border: 0; padding: 6pt 0;
  }
  .prim-visual-canvas .vc-container { text-align: center; }
  .prim-visual-canvas .vc-container img { max-width: 100%; }
  `;
}
