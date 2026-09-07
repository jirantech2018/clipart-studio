// PDF 렌더러 — Puppeteer(-core) + (선택) @sparticuz/chromium.
//
// LearningDocument → HTML → Chromium 페이지 렌더 → PDF Buffer.
// Phase 0 검증 목표: 한글 폰트(Pretendard), 표·이미지 배치, 페이지 자동 분할,
// A4 인쇄 규격, Railway 콜드 스타트/메모리 실측.
//
// 로컬(Windows/Mac): useLocalChrome=true + localChromePath 로 시스템 크롬 사용.
// Railway(Node): useLocalChrome=false → @sparticuz/chromium 자동 사용.

import puppeteer, { type Browser } from 'puppeteer-core';

import { loadImage } from './image-loader';
import type { LearningDocument, Section } from './schema';

export interface RenderPdfOptions {
  /** 로컬 개발 시 시스템 크롬 사용. Railway 배포는 false 로 두어 @sparticuz/chromium 로드. */
  useLocalChrome?: boolean;
  localChromePath?: string;
}

async function launchBrowser(options: RenderPdfOptions): Promise<Browser> {
  if (options.useLocalChrome) {
    if (!options.localChromePath) {
      throw new Error(
        'useLocalChrome=true 인데 localChromePath 가 지정되지 않았어요',
      );
    }
    return puppeteer.launch({
      executablePath: options.localChromePath,
      headless: true,
    });
  }
  // Railway / Linux serverless — @sparticuz/chromium 로드 (dynamic import 로
  // 로컬 개발 환경에서 미설치 상태여도 로드 시점에만 요구되도록).
  const { default: chromium } = await import('@sparticuz/chromium');
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}

export async function renderPdf(
  doc: LearningDocument,
  options: RenderPdfOptions = {},
): Promise<Buffer> {
  const html = await documentToHtml(doc);
  const browser = await launchBrowser(options);
  try {
    const page = await browser.newPage();
    // localhost 자원이 아니라 CDN 폰트 + 인라인 base64 이미지만 사용하므로
    // networkidle0 대신 domcontentloaded 로 충분. 페이지 로드 대기 늘리려면
    // 폰트 로드 확인 로직을 추가.
    await page.setContent(html, { waitUntil: 'load' });
    // 폰트가 로드될 때까지 잠깐 대기 (Pretendard woff2 fetch).
    await page.evaluate(async () => {
      if ('fonts' in document) {
        await (document as unknown as { fonts: { ready: Promise<void> } }).fonts.ready;
      }
    });
    const buffer = await page.pdf({
      format: 'A4',
      margin: { top: '20mm', right: '18mm', bottom: '20mm', left: '18mm' },
      printBackground: true,
    });
    return Buffer.from(buffer);
  } finally {
    await browser.close();
  }
}

// ============================================================
// LearningDocument → HTML 문자열 변환.
// Phase 0 은 시각 검증 목적이므로 CSS 는 인라인 style 로만 유지 (외부 CSS 파일 X).
// Pretendard woff2 는 CDN 링크로 삽입. 이미지 section 은 base64 data URL 로
// 인라인 (외부 네트워크 의존 최소화).
// ============================================================
export async function documentToHtml(doc: LearningDocument): Promise<string> {
  const parts = await Promise.all(doc.sections.map(sectionToHtml));
  const body = parts.join('\n');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(doc.meta.title)}</title>
<style>
  @font-face {
    font-family: 'Pretendard';
    src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/pretendard@1.0/Pretendard-Regular.woff2') format('woff2');
    font-weight: 400;
    font-display: swap;
  }
  @font-face {
    font-family: 'Pretendard';
    src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/pretendard@1.0/Pretendard-Bold.woff2') format('woff2');
    font-weight: 700;
    font-display: swap;
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
    color: #1a1a1a;
    line-height: 1.6;
    font-size: 12pt;
  }
  h1 { font-size: 20pt; margin: 0 0 8pt; color: #2d2f77; }
  h2 { font-size: 14pt; margin: 16pt 0 6pt; color: #2d2f77; }
  h3 { font-size: 12pt; margin: 12pt 0 4pt; color: #2d2f77; }
  p { margin: 4pt 0; }
  table { width: 100%; border-collapse: collapse; margin: 8pt 0; }
  th, td { border: 1px solid #cbd5e1; padding: 6pt 8pt; text-align: left; vertical-align: top; }
  th { background: #eef1ff; font-weight: 700; }
  .meta-bar { border-top: 2px solid #2d2f77; border-bottom: 1px solid #cbd5e1; padding: 8pt 0; margin-bottom: 12pt; font-size: 10pt; color: #64748b; }
  .callout { border-left: 4px solid #2d2f77; background: #f5f7ff; padding: 8pt 10pt; margin: 8pt 0; }
  .callout.warn { border-color: #ef4444; background: #fef2f2; }
  .callout.tip { border-color: #059669; background: #f0fdf4; }
  .question { margin: 10pt 0; page-break-inside: avoid; }
  .question .stem { font-weight: 600; }
  .question ol.choices { padding-left: 20pt; margin: 4pt 0; }
  .question .hint { font-size: 10pt; color: #64748b; margin-top: 4pt; }
  .activity { border: 1px solid #cbd5e1; border-radius: 6pt; padding: 8pt 10pt; margin: 8pt 0; page-break-inside: avoid; }
  .activity .title { font-weight: 700; color: #2d2f77; }
  .activity ol { padding-left: 20pt; }
  .answer-key { margin-top: 24pt; padding-top: 12pt; border-top: 2px dashed #cbd5e1; page-break-before: auto; }
  .rubric-cell { font-size: 10pt; }
  figure { margin: 8pt 0; text-align: center; page-break-inside: avoid; }
  figure img { max-width: 100%; }
  figure figcaption { font-size: 10pt; color: #64748b; margin-top: 4pt; }
</style>
</head>
<body>
<div class="meta-bar">
  ${escapeHtml(doc.meta.title)}
  &nbsp;·&nbsp; ${doc.meta.grade}학년 · ${SUBJECT_LABEL[doc.meta.subject] ?? doc.meta.subject}
  ${doc.meta.estimatedMinutes ? `&nbsp;·&nbsp; 예상 ${doc.meta.estimatedMinutes}분` : ''}
  <br />
  <span>AI 초안이며 교사 검토가 필요합니다.</span>
</div>
${body}
</body>
</html>`;
}

async function sectionToHtml(section: Section): Promise<string> {
  switch (section.kind) {
    case 'heading':
      return `<h${section.level}>${escapeHtml(section.text)}</h${section.level}>`;
    case 'paragraph':
      return `<p>${escapeHtml(section.text)}</p>`;
    case 'callout':
      return `<div class="callout ${section.tone}">${escapeHtml(section.text)}</div>`;
    case 'question': {
      const number = section.number ? `${section.number}. ` : '';
      const stem = `<div class="stem">${number}${escapeHtml(section.stem)}</div>`;
      const choices = section.choices?.length
        ? `<ol class="choices" type="1">${section.choices
            .map((c) => `<li>${escapeHtml(c)}</li>`)
            .join('')}</ol>`
        : '';
      const hint = section.hint
        ? `<div class="hint">💡 ${escapeHtml(section.hint)}</div>`
        : '';
      return `<div class="question">${stem}${choices}${hint}</div>`;
    }
    case 'activity': {
      const title = section.title
        ? `<div class="title">${escapeHtml(section.title)}</div>`
        : '';
      const steps = `<ol>${section.steps
        .map((s) => `<li>${escapeHtml(s)}</li>`)
        .join('')}</ol>`;
      const materials = section.materials?.length
        ? `<div>준비물: ${section.materials.map(escapeHtml).join(', ')}</div>`
        : '';
      const mins = section.estimatedMinutes
        ? `<div class="hint">예상 시간: ${section.estimatedMinutes}분</div>`
        : '';
      return `<div class="activity">${title}${steps}${materials}${mins}</div>`;
    }
    case 'table': {
      const head = section.headers?.length
        ? `<thead><tr>${section.headers
            .map((h) => `<th>${escapeHtml(h)}</th>`)
            .join('')}</tr></thead>`
        : '';
      const body = section.rows
        .map(
          (row) =>
            `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`,
        )
        .join('');
      const caption = section.caption
        ? `<caption>${escapeHtml(section.caption)}</caption>`
        : '';
      return `<table>${caption}${head}<tbody>${body}</tbody></table>`;
    }
    case 'image': {
      // Phase 0: image-loader 가 로컬 파일 또는 http URL 을 base64 data URL 로 변환.
      // Phase 1: source==='clipart' 인 경우 R2 URL 조회 후 로드.
      try {
        const img = await loadImage(section.assetRef);
        const caption = section.caption
          ? `<figcaption>${escapeHtml(section.caption)}</figcaption>`
          : '';
        return `<figure><img src="${img.dataUrl}" style="width:${section.widthPct ?? 60}%" alt="" />${caption}</figure>`;
      } catch (err) {
        return `<figure><em>[이미지 로드 실패: ${escapeHtml(section.assetRef)}]</em></figure>`;
      }
    }
    case 'answer-key': {
      const items = section.entries
        .map(
          (e) =>
            `<li><strong>${escapeHtml(e.ref)}</strong>: ${escapeHtml(e.answer)}${e.rationale ? ` <span class="hint">— ${escapeHtml(e.rationale)}</span>` : ''}</li>`,
        )
        .join('');
      return `<div class="answer-key"><h2>정답과 해설</h2><ol>${items}</ol></div>`;
    }
    case 'rubric': {
      const rows = section.criteria
        .map(
          (c) =>
            `<tr><th class="rubric-cell">${escapeHtml(c.criterion)}</th>${c.levels
              .map((l) => `<td class="rubric-cell">${escapeHtml(l)}</td>`)
              .join('')}</tr>`,
        )
        .join('');
      return `<table>${rows}</table>`;
    }
    case 'slide-break':
      // PDF 에는 페이지 분할 힌트로만 사용 (강제 개행 없음, pptx 전용).
      return '<!-- slide-break -->';
    default:
      return '';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
