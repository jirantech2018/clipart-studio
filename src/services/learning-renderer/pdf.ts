// PDF 렌더러 — Puppeteer(-core) + (선택) @sparticuz/chromium.
//
// v3 (Phase 0.6) 개선:
//   - section-block 그룹핑: heading + 뒤따르는 non-heading 섹션을 하나의 div 로
//     묶어 break-inside: avoid-page 적용 → 고아 페이지 원천 차단.
//   - combined 인라인 정답 제거: 정답은 answer-key 섹션에서만 노출.
//   - 한글 폰트 fallback 강화: Pretendard · Noto Sans KR · 맑은 고딕 · Apple SD.
//     서버 렌더링 시 Noto Sans KR CDN 로 한글 확실 확보.
// v2 (Phase 0.5):
//   - 고아 페이지 방지: heading 뒤에 최소 콘텐츠 유지, answer-key 통째로 유지,
//     question / activity 는 절대 분할 X, orphans/widows 3 이상.
//   - 학생용 / 교사용 / combined 세 variant 지원 (RenderOptions.answerVariant).
//   - 이미지 원본 비율 유지 (loadImage 가 반환하는 width/height 활용).
//   - 캡션·최대 크기·정렬 규칙 반영.

import puppeteer, { type Browser } from 'puppeteer-core';

import { fitDimensions, loadImage } from './image-loader';
import type { LearningDocument, Section } from './schema';

export type AnswerVariant = 'student' | 'teacher' | 'combined';

export interface RenderPdfOptions {
  /** 로컬 개발 시 시스템 크롬 사용. Railway 배포는 false 로 두어 @sparticuz/chromium 로드. */
  useLocalChrome?: boolean;
  localChromePath?: string;
  /**
   * - 'student'   : answer-key 섹션 제외 + question.answer 숨김
   * - 'teacher'   : answer-key 만 (짧은 정답·해설지)
   * - 'combined'  : 기본. 학생 문제 + 뒤에 정답·해설
   */
  answerVariant?: AnswerVariant;
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
  const variant = options.answerVariant ?? 'combined';
  const html = await documentToHtml(doc, variant);
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
// ============================================================
export async function documentToHtml(
  doc: LearningDocument,
  variant: AnswerVariant,
): Promise<string> {
  // variant 별 sections 필터링:
  //  - student  : answer-key 제외
  //  - teacher  : answer-key 만 (제목·헤더는 유지)
  //  - combined : 전부
  const sections = filterSections(doc.sections, variant);

  // Phase 0.6: heading + 뒤따르는 non-heading 섹션을 section-block 으로 그룹핑.
  // answer-key 는 자체적으로 break 처리하므로 그룹에서 제외.
  const groups = groupIntoSectionBlocks(sections);

  const groupHtmlList = await Promise.all(
    groups.map(async (group) => {
      const inner = await Promise.all(group.sections.map((s) => sectionToHtml(s, variant)));
      if (group.standalone) {
        return inner.join('\n');
      }
      return `<div class="section-block">\n${inner.join('\n')}\n</div>`;
    }),
  );
  const body = groupHtmlList.join('\n');

  const variantBadge =
    variant === 'student'
      ? '학생용 (정답 제외)'
      : variant === 'teacher'
        ? '교사용 정답·해설'
        : '학생용 + 정답·해설';

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(doc.meta.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet" />
<style>
  /*
   * Phase 0.6 폰트 정책 (PDF 서버 렌더링 전용):
   *   1) Pretendard  — 브랜드 폰트 (jsDelivr CDN)
   *   2) Noto Sans KR — Google Fonts. 서버에 한글 폰트 미설치여도 확실 fallback.
   *   3) 로컬 시스템 한글 폰트 (Windows: Malgun Gothic / macOS: Apple SD)
   */
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
  /* Phase 0.7 밀도 조정: line-height 1.6 → 1.45, font-size 12pt → 11pt
     로 lessonPlan 1페이지 목표 (평가계획 · 준비물이 한 페이지에 들어가도록). */
  body {
    font-family: 'Pretendard', 'Noto Sans KR', 'Malgun Gothic', 'Apple SD Gothic Neo', 'HCR Dotum', sans-serif;
    color: #1a1a1a;
    line-height: 1.45;
    font-size: 11pt;
    orphans: 3;
    widows: 3;
  }
  /* 섹션 그룹 — heading + 뒤따르는 non-heading 섹션을 한 페이지에 유지 시도.
     그룹이 너무 커서 한 페이지에 안 들어가면 자연 분할되지만, 짧은
     '준비물' 같은 블록이 혼자 다음 페이지로 밀리는 고아 페이지는 방지. */
  .section-block {
    page-break-inside: avoid;
    break-inside: avoid-page;
  }
  /* 제목 계열은 뒤 콘텐츠와 분리되지 않도록 강제. */
  h1, h2, h3 {
    color: #2d2f77;
    page-break-after: avoid;
    break-after: avoid-page;
    page-break-inside: avoid;
    break-inside: avoid-page;
  }
  h1 { font-size: 18pt; margin: 0 0 6pt; }
  h2 { font-size: 13pt; margin: 10pt 0 4pt; }
  h3 { font-size: 11.5pt; margin: 8pt 0 3pt; }
  p { margin: 2pt 0; orphans: 3; widows: 3; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 4pt 0;
    page-break-inside: avoid;
    break-inside: avoid-page;
  }
  th, td { border: 1px solid #cbd5e1; padding: 3pt 5pt; text-align: left; vertical-align: top; }
  th { background: #eef1ff; font-weight: 700; }
  .meta-bar {
    border-top: 2px solid #2d2f77;
    border-bottom: 1px solid #cbd5e1;
    padding: 8pt 0;
    margin-bottom: 12pt;
    font-size: 10pt;
    color: #64748b;
    page-break-after: avoid;
    break-after: avoid-page;
  }
  .variant-badge {
    display: inline-block;
    background: #eef1ff;
    color: #2d2f77;
    padding: 2pt 8pt;
    border-radius: 4pt;
    font-weight: 700;
    margin-left: 6pt;
  }
  .callout {
    border-left: 4px solid #2d2f77;
    background: #f5f7ff;
    padding: 5pt 8pt;
    margin: 4pt 0;
    page-break-inside: avoid;
    break-inside: avoid-page;
  }
  .callout.warn { border-color: #ef4444; background: #fef2f2; }
  .callout.tip { border-color: #059669; background: #f0fdf4; }
  /* 문항·활동 블록은 절대 분할 금지. */
  .question, .activity {
    margin: 6pt 0;
    page-break-inside: avoid;
    break-inside: avoid-page;
    orphans: 4;
    widows: 4;
  }
  .question .stem { font-weight: 600; }
  .question ol.choices { padding-left: 20pt; margin: 4pt 0; }
  .question .hint { font-size: 10pt; color: #64748b; margin-top: 4pt; }
  .question .inline-answer { font-size: 10pt; color: #059669; margin-top: 4pt; font-weight: 700; }
  .activity {
    border: 1px solid #cbd5e1;
    border-radius: 6pt;
    padding: 5pt 8pt;
  }
  .activity .title { font-weight: 700; color: #2d2f77; }
  .activity ol { padding-left: 20pt; }
  /* 정답·해설 통째 유지 시도 — 짧으면 이전 콘텐츠와 함께, 길면 자연 분할. */
  .answer-key {
    margin-top: 24pt;
    padding-top: 12pt;
    border-top: 2px dashed #cbd5e1;
    page-break-inside: avoid;
    break-inside: avoid-page;
  }
  .answer-key.forced-new-page {
    page-break-before: always;
    break-before: page;
  }
  .rubric-cell { font-size: 10pt; }
  figure {
    margin: 8pt auto;
    text-align: center;
    page-break-inside: avoid;
    break-inside: avoid-page;
  }
  figure img { max-width: 100%; }
  figure figcaption {
    font-size: 10pt;
    color: #64748b;
    margin-top: 4pt;
    font-style: italic;
  }
</style>
</head>
<body>
<div class="meta-bar">
  <strong>${escapeHtml(doc.meta.title)}</strong>
  <span class="variant-badge">${escapeHtml(variantBadge)}</span>
  <br />
  ${doc.meta.grade}학년 · ${SUBJECT_LABEL[doc.meta.subject] ?? doc.meta.subject}
  ${doc.meta.estimatedMinutes ? `· 예상 ${doc.meta.estimatedMinutes}분` : ''}
  · AI 초안이며 교사 검토가 필요합니다.
</div>
${body}
</body>
</html>`;
}

// heading + 뒤따르는 non-heading 섹션을 하나의 section-block 으로 묶는다.
// answer-key / image / table 처럼 자체적으로 break-inside: avoid-page 를 갖는
// 큰 블록은 standalone: true 로 두어 이중 wrap 을 피한다.
interface SectionGroup {
  standalone: boolean;
  sections: Section[];
}

function groupIntoSectionBlocks(sections: Section[]): SectionGroup[] {
  const groups: SectionGroup[] = [];
  let current: SectionGroup | null = null;

  const flush = () => {
    if (current && current.sections.length > 0) groups.push(current);
    current = null;
  };

  for (const s of sections) {
    // answer-key 는 자체 처리 (내부에 페이지 브레이크 힌트 존재).
    if (s.kind === 'answer-key') {
      flush();
      groups.push({ standalone: true, sections: [s] });
      continue;
    }
    if (s.kind === 'slide-break') {
      // PDF 에서는 무시.
      continue;
    }
    if (s.kind === 'heading') {
      flush();
      current = { standalone: false, sections: [s] };
      continue;
    }
    if (!current) {
      current = { standalone: false, sections: [] };
    }
    current.sections.push(s);
  }
  flush();
  return groups;
}

// variant 별 sections 필터링 (Phase 0.7 재정의):
//   - combined : 학생용 문제지 + 뒤에 정답·해설 (인라인 정답 X)
//   - student  : 학생용 문제지만 (answer-key 제외, 인라인 정답 X)
//   - teacher  : 학생용 문제지 전체 + 인라인 정답 표시 + 뒤 정답·해설도 유지
//                (교사가 수업 중 참고하는 완전판)
function filterSections(sections: Section[], variant: AnswerVariant): Section[] {
  if (variant === 'student') return sections.filter((s) => s.kind !== 'answer-key');
  return sections;
}

async function sectionToHtml(section: Section, variant: AnswerVariant): Promise<string> {
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
      // Phase 0.7: teacher variant 만 인라인 정답 표시 (수업 중 참고용).
      // student 는 숨김, combined 는 마지막 answer-key 섹션만 사용.
      const inlineAnswer =
        variant === 'teacher' && section.answer
          ? `<div class="inline-answer">정답: ${escapeHtml(section.answer)}</div>`
          : '';
      return `<div class="question">${stem}${choices}${hint}${inlineAnswer}</div>`;
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
      try {
        const img = await loadImage(section.assetRef);
        // 페이지 폭 (A4 - margin) 대비 widthPct 로 목표 폭 결정.
        // 최대 80% 로 상한.
        const capped = Math.min(section.widthPct ?? 60, 80);
        const caption = section.caption
          ? `<figcaption>${escapeHtml(section.caption)}</figcaption>`
          : '';
        return `<figure><img src="${img.dataUrl}" style="width:${capped}%; height:auto;" alt="" />${caption}</figure>`;
      } catch {
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
      // Phase 0.7: combined variant 는 학생용 문제지와 정답·해설을 물리적으로 분리.
      const cls = variant === 'combined' ? 'answer-key forced-new-page' : 'answer-key';
      return `<div class="${cls}"><h2>정답과 해설</h2><ol>${items}</ol></div>`;
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
