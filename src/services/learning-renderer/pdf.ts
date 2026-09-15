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
  // Railway / 서버리스 환경: @sparticuz/chromium 이 제공하는 args + binary.
  // next.config.mjs 의 serverComponentsExternalPackages 에 이 패키지가
  // 포함돼 있어야 번들러가 native binary 참조를 유지한다.
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
  /* 학생 작성용 표 (worksheet-table): 넉넉한 행 높이 */
  .worksheet-table { break-inside: avoid-page; }
  .worksheet-table th { background: #f5f5f5; }
  .worksheet-table td.ws-cell { height: 32pt; }
  .ws-caption { font-size: 10pt; color: #64748b; margin: 4pt 0 2pt; }
  /* 학생 그리기·꾸미기용 빈 공간 (blank-space) */
  .blank-space {
    border: 1.5px dashed #94a3b8;
    border-radius: 4pt;
    margin: 8pt 0;
    padding: 6pt 8pt;
    break-inside: avoid-page;
    background: repeating-linear-gradient(
      45deg,
      transparent,
      transparent 8pt,
      rgba(148,163,184,0.05) 8pt,
      rgba(148,163,184,0.05) 16pt
    );
  }
  .blank-space-prompt { font-size: 10pt; color: #64748b; font-style: italic; }
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
  /* Stage 4 활동 블록 공통 카드 스타일. */
  .act-block {
    border: 1px solid #cbd5e1;
    border-radius: 8pt;
    padding: 8pt 10pt;
    margin: 8pt 0;
    page-break-inside: avoid;
    break-inside: avoid-page;
  }
  .act-block .act-header {
    display: flex; justify-content: space-between; align-items: baseline;
    border-bottom: 1px dashed #cbd5e1;
    padding-bottom: 4pt; margin-bottom: 6pt;
    color: #2d2f77; font-weight: 700; font-size: 11.5pt;
  }
  .act-block .act-number { color: #2d2f77; margin-right: 6pt; }
  .act-block .act-instruction { color: #1a1a1a; }
  .act-block .act-body { font-size: 11pt; }
  .act-block .teacher-note {
    margin-top: 6pt; padding: 5pt 8pt;
    background: #fef7ed; border-left: 3px solid #f59e0b;
    font-size: 10pt; color: #78350f;
  }
  /* picture-choice */
  .pc-grid {
    display: grid; grid-template-columns: repeat(2, 1fr);
    gap: 8pt; margin-top: 6pt;
  }
  .pc-choice {
    border: 1.5px solid #cbd5e1; border-radius: 6pt; padding: 6pt;
    text-align: center;
  }
  .pc-choice img { max-width: 100%; max-height: 90pt; }
  .pc-choice .pc-num { font-weight: 700; color: #2d2f77; }
  .pc-choice .pc-label { font-size: 10.5pt; margin-top: 3pt; }
  /* matching */
  .mt-container {
    display: grid; grid-template-columns: 1fr 40pt 1fr;
    gap: 10pt; margin-top: 6pt; align-items: center;
  }
  .mt-col { display: flex; flex-direction: column; gap: 6pt; }
  .mt-item {
    border: 1.5px solid #cbd5e1; border-radius: 4pt; padding: 5pt 8pt;
    min-height: 26pt; text-align: center;
  }
  .mt-item img { max-height: 60pt; max-width: 100%; }
  .mt-space { text-align: center; color: #94a3b8; font-size: 9pt; }
  /* classification */
  .cl-buckets {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(140pt, 1fr));
    gap: 8pt; margin-top: 6pt;
  }
  .cl-bucket {
    border: 1.5px dashed #94a3b8; border-radius: 6pt; padding: 5pt 8pt;
    min-height: 80pt;
  }
  .cl-bucket .cl-bucket-title {
    font-weight: 700; color: #2d2f77; text-align: center;
    padding-bottom: 4pt; border-bottom: 1px solid #cbd5e1; margin-bottom: 5pt;
  }
  .cl-item-pool {
    display: flex; flex-wrap: wrap; gap: 6pt; margin-top: 6pt;
    padding: 5pt; border: 1px solid #cbd5e1; border-radius: 4pt;
    background: #f8fafc;
  }
  .cl-item-chip {
    padding: 3pt 8pt; background: #ffffff; border: 1px solid #cbd5e1;
    border-radius: 12pt; font-size: 10.5pt;
  }
  .cl-item-chip img { max-height: 40pt; vertical-align: middle; }
  /* fill-blank */
  .fb-sentence {
    margin: 6pt 0; font-size: 12pt; line-height: 2.0;
  }
  .fb-blank {
    display: inline-block; min-width: 40pt;
    border-bottom: 1.5px solid #1a1a1a;
    padding: 0 6pt; margin: 0 2pt;
    text-align: center;
  }
  /* writing-grid */
  .wg-grid {
    display: grid; gap: 2pt; margin-top: 6pt;
  }
  .wg-cell {
    border: 1px solid #94a3b8;
    aspect-ratio: 1;
    background: repeating-linear-gradient(
      45deg, transparent, transparent 4pt,
      rgba(148,163,184,0.05) 4pt, rgba(148,163,184,0.05) 8pt);
    display: flex; align-items: center; justify-content: center;
    color: #cbd5e1; font-size: 14pt;
  }
  .wg-lined {
    display: grid; grid-template-columns: 1fr; gap: 0;
    margin-top: 6pt;
  }
  .wg-line {
    border-bottom: 1px solid #94a3b8;
    height: 22pt;
  }
  .wg-manuscript-row {
    display: grid; gap: 0; margin: 2pt 0;
  }
  .wg-manuscript-cell {
    border: 1px solid #94a3b8;
    aspect-ratio: 1;
    background: #ffffff;
  }
  /* guided-practice */
  .gp-example {
    background: #eef2ff; border-left: 4px solid #6366f1;
    padding: 6pt 8pt; margin-bottom: 8pt;
    border-radius: 0 4pt 4pt 0;
  }
  .gp-example-label {
    font-weight: 700; color: #4338ca; font-size: 10pt;
    margin-bottom: 4pt;
  }
  .gp-example-steps { padding-left: 18pt; margin: 4pt 0; }
  .gp-example-steps li { margin: 2pt 0; }
  .gp-practice-label {
    font-weight: 700; color: #2d2f77; margin: 6pt 0 4pt;
  }
  .gp-practice-list { padding-left: 18pt; margin: 0; }
  .gp-practice-list li { margin: 6pt 0; }
  .gp-practice-answer {
    display: inline-block; min-width: 50pt;
    border-bottom: 1.2px solid #1a1a1a; margin-left: 8pt;
  }
  /* independent-practice */
  .ip-list { padding-left: 18pt; margin: 4pt 0; }
  .ip-list li { margin: 8pt 0; }
  .ip-answer-lines {
    margin-top: 4pt;
    display: grid; gap: 0;
  }
  .ip-answer-line {
    border-bottom: 1px solid #94a3b8;
    height: 20pt;
  }
  /* sequence */
  .sq-container {
    display: flex; gap: 8pt; flex-wrap: wrap;
    margin-top: 6pt;
  }
  .sq-item {
    flex: 1 1 100pt;
    border: 1.5px solid #cbd5e1; border-radius: 6pt;
    padding: 6pt; text-align: center; min-height: 60pt;
    position: relative;
  }
  .sq-item img { max-width: 100%; max-height: 60pt; }
  .sq-answer-slot {
    margin-top: 4pt; padding: 4pt;
    border: 1.5px dashed #94a3b8; border-radius: 4pt;
    font-size: 10pt; color: #64748b;
  }
  /* observation */
  .ob-container {
    display: grid; grid-template-columns: 45% 1fr;
    gap: 12pt; margin-top: 6pt;
  }
  .ob-image { text-align: center; }
  .ob-image img { max-width: 100%; }
  .ob-caption { font-size: 10pt; color: #64748b; font-style: italic; margin-top: 4pt; }
  .ob-prompts { padding-left: 0; margin: 0; }
  .ob-prompts li {
    list-style: none;
    margin: 6pt 0;
  }
  .ob-prompt-text { font-weight: 500; }
  .ob-answer-lines {
    margin-top: 3pt;
    border-bottom: 1px solid #94a3b8;
    height: 20pt;
  }
  /* open-response */
  .or-lines {
    margin-top: 6pt;
    display: grid; gap: 0;
  }
  .or-line { border-bottom: 1px solid #94a3b8; height: 22pt; }
  .or-box {
    margin-top: 6pt;
    border: 1.5px dashed #94a3b8; border-radius: 4pt;
    background: repeating-linear-gradient(
      45deg, transparent, transparent 8pt,
      rgba(148,163,184,0.05) 8pt, rgba(148,163,184,0.05) 16pt);
  }
  /* student-header */
  .student-header {
    display: flex; gap: 20pt; align-items: baseline;
    padding: 6pt 0 8pt;
    border-bottom: 1.5px solid #2d2f77;
    margin-bottom: 10pt;
  }
  .student-header .sh-field {
    flex: 1; display: flex; align-items: baseline; gap: 6pt;
  }
  .student-header .sh-label {
    font-weight: 700; color: #2d2f77; white-space: nowrap;
  }
  .student-header .sh-blank {
    flex: 1; border-bottom: 1.2px solid #1a1a1a;
    min-height: 18pt;
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
    // Stage 4: page-break 은 강제 페이지 분리.
    if (s.kind === 'page-break') {
      flush();
      groups.push({ standalone: true, sections: [s] });
      continue;
    }
    if (s.kind === 'heading') {
      flush();
      current = { standalone: false, sections: [s] };
      continue;
    }
    // student-header 는 다른 헤더와 함께 표시 (standalone).
    if (s.kind === 'student-header') {
      flush();
      groups.push({ standalone: true, sections: [s] });
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
    case 'worksheet-table': {
      // 학생 작성용 빈 표: headers + rowCount 개의 빈 행.
      const rowCount = Math.max(1, Math.min(12, Math.round(section.rowCount)));
      const head = section.headers?.length
        ? `<thead><tr>${section.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`
        : '';
      const colCount = section.headers?.length || 1;
      const rows = Array.from({ length: rowCount })
        .map(
          () =>
            `<tr>${Array.from({ length: colCount })
              .map(() => `<td class="ws-cell">&nbsp;</td>`)
              .join('')}</tr>`,
        )
        .join('');
      const caption = section.caption
        ? `<div class="ws-caption">${escapeHtml(section.caption)}</div>`
        : '';
      return `${caption}<table class="worksheet-table">${head}<tbody>${rows}</tbody></table>`;
    }
    case 'blank-space': {
      const ratio = Math.max(0.1, Math.min(0.6, section.heightRatio ?? 0.3));
      // A4 세로 297mm - 40mm margin = 257mm 사용 가능. 그중 ratio 비율.
      const heightMm = Math.round(257 * ratio);
      const prompt = section.prompt
        ? `<div class="blank-space-prompt">${escapeHtml(section.prompt)}</div>`
        : '';
      return `<div class="blank-space" style="height:${heightMm}mm;">${prompt}</div>`;
    }
    // Stage 4 활동 블록.
    case 'student-header': {
      const fields = section.fields
        .map(
          (f) =>
            `<div class="sh-field"><span class="sh-label">${escapeHtml(f)}</span><span class="sh-blank"></span></div>`,
        )
        .join('');
      return `<div class="student-header">${fields}</div>`;
    }
    case 'picture-choice': {
      const num = section.number ? `<span class="act-number">${section.number}.</span>` : '';
      const header = `<div class="act-header">${num}<span class="act-instruction">${escapeHtml(section.stem)}</span></div>`;
      const choices = await Promise.all(
        section.choices.map(async (c, i) => {
          let img = '';
          if (c.imageAssetRef) {
            try {
              const loaded = await loadImage(c.imageAssetRef);
              img = `<img src="${loaded.dataUrl}" alt="" />`;
            } catch {
              img = '';
            }
          }
          const label = c.label ? `<div class="pc-label">${escapeHtml(c.label)}</div>` : '';
          return `<div class="pc-choice"><div class="pc-num">${i + 1}</div>${img}${label}</div>`;
        }),
      );
      const body = `<div class="pc-grid">${choices.join('')}</div>`;
      const teacherNote =
        variant === 'teacher' && section.teacherNote
          ? `<div class="teacher-note"><strong>정답 ${escapeHtml(section.answer)}</strong> — ${escapeHtml(section.teacherNote)}</div>`
          : variant === 'teacher'
            ? `<div class="teacher-note"><strong>정답 ${escapeHtml(section.answer)}</strong></div>`
            : '';
      return `<div class="act-block">${header}<div class="act-body">${body}</div>${teacherNote}</div>`;
    }
    case 'matching': {
      const num = section.number ? `<span class="act-number">${section.number}.</span>` : '';
      const header = `<div class="act-header">${num}<span class="act-instruction">${escapeHtml(section.stem)}</span></div>`;
      const renderCol = async (col: typeof section.leftColumn) =>
        (
          await Promise.all(
            col.map(async (it) => {
              let inner = '';
              if (it.imageAssetRef) {
                try {
                  const loaded = await loadImage(it.imageAssetRef);
                  inner = `<img src="${loaded.dataUrl}" alt="" />`;
                } catch {
                  /* ignore */
                }
              }
              if (it.text) inner += `<div>${escapeHtml(it.text)}</div>`;
              return `<div class="mt-item">${inner}</div>`;
            }),
          )
        ).join('');
      const left = await renderCol(section.leftColumn);
      const right = await renderCol(section.rightColumn);
      const spacer = `<div class="mt-space">→ 선으로 이어 보세요 →</div>`;
      const body = `<div class="mt-container"><div class="mt-col">${left}</div>${spacer}<div class="mt-col">${right}</div></div>`;
      const teacherPairs =
        variant === 'teacher' && section.correctPairs.length > 0
          ? `<div class="teacher-note"><strong>정답 짝</strong>: ${section.correctPairs.map((p) => `${escapeHtml(p[0])}↔${escapeHtml(p[1])}`).join(', ')}${section.teacherNote ? ' — ' + escapeHtml(section.teacherNote) : ''}</div>`
          : '';
      return `<div class="act-block">${header}<div class="act-body">${body}</div>${teacherPairs}</div>`;
    }
    case 'classification': {
      const num = section.number ? `<span class="act-number">${section.number}.</span>` : '';
      const header = `<div class="act-header">${num}<span class="act-instruction">${escapeHtml(section.stem)}</span></div>`;
      const buckets = section.categories
        .map(
          (cat) =>
            `<div class="cl-bucket"><div class="cl-bucket-title">${escapeHtml(cat)}</div></div>`,
        )
        .join('');
      const chips = await Promise.all(
        section.items.map(async (it) => {
          let img = '';
          if (it.imageAssetRef) {
            try {
              const loaded = await loadImage(it.imageAssetRef);
              img = `<img src="${loaded.dataUrl}" alt="" />`;
            } catch {
              /* ignore */
            }
          }
          const t = it.text ? escapeHtml(it.text) : '';
          return `<div class="cl-item-chip">${img}${t}</div>`;
        }),
      );
      const pool = `<div class="cl-item-pool">${chips.join('')}</div>`;
      const body = `<div class="cl-buckets">${buckets}</div>${pool}`;
      const teacherKey =
        variant === 'teacher'
          ? `<div class="teacher-note"><strong>정답</strong>: ${section.items.map((it) => `${escapeHtml(it.text ?? it.id)}=${escapeHtml(it.correctCategory)}`).join(' · ')}${section.teacherNote ? ' — ' + escapeHtml(section.teacherNote) : ''}</div>`
          : '';
      return `<div class="act-block">${header}<div class="act-body">${body}</div>${teacherKey}</div>`;
    }
    case 'fill-blank': {
      const num = section.number ? `<span class="act-number">${section.number}.</span>` : '';
      const header = `<div class="act-header">${num}<span class="act-instruction">${escapeHtml(section.stem)}</span></div>`;
      const sentences = section.sentences
        .map((s) => {
          // template 의 __ 을 blank span 으로 치환.
          const parts = s.template.split('__');
          const html = parts
            .map((p, i) => {
              const text = escapeHtml(p);
              if (i === parts.length - 1) return text;
              return text + `<span class="fb-blank">&nbsp;</span>`;
            })
            .join('');
          return `<div class="fb-sentence">${html}</div>`;
        })
        .join('');
      const teacherKey =
        variant === 'teacher'
          ? `<div class="teacher-note"><strong>정답</strong>: ${section.sentences.map((s, i) => `${i + 1}) ${s.answers.map(escapeHtml).join(', ')}`).join(' · ')}${section.teacherNote ? ' — ' + escapeHtml(section.teacherNote) : ''}</div>`
          : '';
      return `<div class="act-block">${header}<div class="act-body">${sentences}</div>${teacherKey}</div>`;
    }
    case 'writing-grid': {
      const num = section.number ? `<span class="act-number">${section.number}.</span>` : '';
      const header = `<div class="act-header">${num}<span class="act-instruction">${escapeHtml(section.stem)}</span></div>`;
      let body = '';
      if (section.gridType === 'square') {
        const cells = Array.from({ length: section.cellsPerRow * section.rowCount })
          .map((_, i) => {
            const idx = i % section.cellsPerRow;
            const rowIdx = Math.floor(i / section.cellsPerRow);
            const tracing =
              rowIdx === 0 && section.tracingText
                ? escapeHtml(section.tracingText.charAt(idx) ?? '')
                : '';
            return `<div class="wg-cell">${tracing}</div>`;
          })
          .join('');
        body = `<div class="wg-grid" style="grid-template-columns: repeat(${section.cellsPerRow}, 1fr);">${cells}</div>`;
      } else if (section.gridType === 'lined') {
        const lines = Array.from({ length: section.rowCount })
          .map(() => `<div class="wg-line"></div>`)
          .join('');
        body = `<div class="wg-lined">${lines}</div>`;
      } else if (section.gridType === 'manuscript') {
        const rows = Array.from({ length: section.rowCount })
          .map((_, rowIdx) => {
            const cells = Array.from({ length: section.cellsPerRow })
              .map((_, cellIdx) => {
                const tracing =
                  rowIdx === 0 && section.tracingText
                    ? escapeHtml(section.tracingText.charAt(cellIdx) ?? '')
                    : '';
                return `<div class="wg-manuscript-cell">${tracing}</div>`;
              })
              .join('');
            return `<div class="wg-manuscript-row" style="grid-template-columns: repeat(${section.cellsPerRow}, 1fr);">${cells}</div>`;
          })
          .join('');
        body = rows;
      }
      const teacherNote =
        variant === 'teacher' && section.teacherNote
          ? `<div class="teacher-note">${escapeHtml(section.teacherNote)}</div>`
          : '';
      return `<div class="act-block">${header}<div class="act-body">${body}</div>${teacherNote}</div>`;
    }
    case 'guided-practice': {
      const num = section.number ? `<span class="act-number">${section.number}.</span>` : '';
      const header = `<div class="act-header">${num}<span class="act-instruction">${escapeHtml(section.stem)}</span></div>`;
      const ex = section.workedExample;
      const exSteps = ex.solutionSteps
        .map((s) => `<li>${escapeHtml(s)}</li>`)
        .join('');
      const exBlock = `<div class="gp-example"><div class="gp-example-label">예시 풀이</div><div>${escapeHtml(ex.problem)}</div><ol class="gp-example-steps">${exSteps}</ol></div>`;
      const practice = section.practiceProblems
        .map((p) => {
          const ans =
            variant === 'teacher' && p.answer
              ? `<span class="gp-practice-answer">${escapeHtml(p.answer)}</span>`
              : `<span class="gp-practice-answer">&nbsp;</span>`;
          return `<li>${escapeHtml(p.problem)}${ans}</li>`;
        })
        .join('');
      const practiceBlock = `<div class="gp-practice-label">이제 풀어 봅시다</div><ol class="gp-practice-list">${practice}</ol>`;
      const teacherNote =
        variant === 'teacher' && section.teacherNote
          ? `<div class="teacher-note">${escapeHtml(section.teacherNote)}</div>`
          : '';
      return `<div class="act-block">${header}<div class="act-body">${exBlock}${practiceBlock}</div>${teacherNote}</div>`;
    }
    case 'independent-practice': {
      const num = section.number ? `<span class="act-number">${section.number}.</span>` : '';
      const header = `<div class="act-header">${num}<span class="act-instruction">${escapeHtml(section.stem)}</span></div>`;
      const items = section.problems
        .map((p) => {
          const lineCount = p.answerSpaceLines ?? 2;
          const lines = Array.from({ length: lineCount })
            .map(() => `<div class="ip-answer-line"></div>`)
            .join('');
          const ans =
            variant === 'teacher' && p.answer
              ? `<div class="teacher-note"><strong>정답</strong>: ${escapeHtml(p.answer)}</div>`
              : `<div class="ip-answer-lines">${lines}</div>`;
          return `<li><div>${escapeHtml(p.problem)}</div>${ans}</li>`;
        })
        .join('');
      const teacherNote =
        variant === 'teacher' && section.teacherNote
          ? `<div class="teacher-note">${escapeHtml(section.teacherNote)}</div>`
          : '';
      return `<div class="act-block">${header}<div class="act-body"><ol class="ip-list">${items}</ol></div>${teacherNote}</div>`;
    }
    case 'sequence': {
      const num = section.number ? `<span class="act-number">${section.number}.</span>` : '';
      const header = `<div class="act-header">${num}<span class="act-instruction">${escapeHtml(section.stem)}</span></div>`;
      const items = await Promise.all(
        section.items.map(async (it) => {
          let img = '';
          if (it.imageAssetRef) {
            try {
              const loaded = await loadImage(it.imageAssetRef);
              img = `<img src="${loaded.dataUrl}" alt="" />`;
            } catch {
              /* ignore */
            }
          }
          const text = it.text ? `<div>${escapeHtml(it.text)}</div>` : '';
          return `<div class="sq-item">${img}${text}<div class="sq-answer-slot">순서: __</div></div>`;
        }),
      );
      const teacherKey =
        variant === 'teacher' && section.correctOrder.length > 0
          ? `<div class="teacher-note"><strong>정답 순서</strong>: ${section.correctOrder.map(escapeHtml).join(' → ')}${section.teacherNote ? ' — ' + escapeHtml(section.teacherNote) : ''}</div>`
          : '';
      return `<div class="act-block">${header}<div class="act-body"><div class="sq-container">${items.join('')}</div></div>${teacherKey}</div>`;
    }
    case 'observation': {
      const num = section.number ? `<span class="act-number">${section.number}.</span>` : '';
      const header = `<div class="act-header">${num}<span class="act-instruction">${escapeHtml(section.stem)}</span></div>`;
      let imgHtml = '';
      try {
        const loaded = await loadImage(section.imageAssetRef);
        imgHtml = `<img src="${loaded.dataUrl}" alt="" />`;
      } catch {
        imgHtml = `<em>[이미지 로드 실패]</em>`;
      }
      const caption = section.imageCaption
        ? `<div class="ob-caption">${escapeHtml(section.imageCaption)}</div>`
        : '';
      const prompts = section.observationPrompts
        .map((p) => {
          const ans =
            variant === 'teacher' && p.answer
              ? `<div class="teacher-note"><strong>정답</strong>: ${escapeHtml(p.answer)}</div>`
              : `<div class="ob-answer-lines"></div>`;
          return `<li><div class="ob-prompt-text">${escapeHtml(p.prompt)}</div>${ans}</li>`;
        })
        .join('');
      const body = `<div class="ob-container"><div class="ob-image">${imgHtml}${caption}</div><ol class="ob-prompts">${prompts}</ol></div>`;
      const teacherNote =
        variant === 'teacher' && section.teacherNote
          ? `<div class="teacher-note">${escapeHtml(section.teacherNote)}</div>`
          : '';
      return `<div class="act-block">${header}<div class="act-body">${body}</div>${teacherNote}</div>`;
    }
    case 'open-response': {
      const num = section.number ? `<span class="act-number">${section.number}.</span>` : '';
      const header = `<div class="act-header">${num}<span class="act-instruction">${escapeHtml(section.stem)}</span></div>`;
      let body = '';
      if (section.responseMode === 'lines' || section.responseMode === 'both') {
        const count = section.lineCount ?? 5;
        const lines = Array.from({ length: count })
          .map(() => `<div class="or-line"></div>`)
          .join('');
        body += `<div class="or-lines">${lines}</div>`;
      }
      if (section.responseMode === 'box' || section.responseMode === 'both') {
        const ratio = section.boxHeightRatio ?? 0.3;
        const heightMm = Math.round(257 * ratio);
        body += `<div class="or-box" style="height:${heightMm}mm;"></div>`;
      }
      const teacherNote =
        variant === 'teacher' && section.teacherNote
          ? `<div class="teacher-note">${escapeHtml(section.teacherNote)}</div>`
          : '';
      return `<div class="act-block">${header}<div class="act-body">${body}</div>${teacherNote}</div>`;
    }
    case 'page-break':
      return '<div style="page-break-before: always; break-before: page;"></div>';
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
