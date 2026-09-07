// PPTX 렌더러 — `pptxgenjs`.
//
// v2 (Phase 0.5) 대폭 재구성:
//   - A4 문서 축소판이 아니라 발표용 슬라이드 레이아웃.
//   - 자료유형별 레이아웃 결정:
//       * question    → 한 슬라이드 = 큰 질문 하나 + 선택지 큰 글자
//       * activity    → 한 슬라이드 = 활동 하나 (제목 + 단계 목록)
//       * table       → 한 슬라이드 = 표 하나 (배경 대비 셀)
//       * image       → 한 슬라이드 = 이미지 크게 + 캡션
//       * paragraph/callout → heading level 1 하위로 묶여 텍스트 슬라이드
//       * heading L1  → 새 섹션 표지 슬라이드
//       * answer-key  → 마지막에 몰아서 별도 슬라이드
//   - 최소 폰트: 본문 20pt, 제목 32pt, 문항 24pt (선택지 22pt).
//   - 슬라이드당 최대 정보량: 문항 1개, 표 1개, 이미지 1개, 텍스트 250자.
//   - 한글 fallback: fontFace 만 지정. Pretendard 없으면 열람 환경 폰트 사용.
//   - 이미지 원본 비율 유지.
//   - splitIntoSlides: AI slide-break 는 힌트로만, 최종 분할은 렌더러가 결정.

import PptxGenJS from 'pptxgenjs';

import { fitDimensions, loadImage } from './image-loader';
import type { LearningDocument, Section } from './schema';

// ============================================================
// 발표용 상수. 슬라이드 크기 = LAYOUT_WIDE (13.333 x 7.5 inch).
// ============================================================
const LAYOUT_WIDE = { w: 13.333, h: 7.5 };
const SAFE = { x: 0.7, y: 1.5, w: 11.9, h: 5.3 };
const FONT_TITLE = 32;
const FONT_SECTION = 26;
const FONT_QUESTION = 24;
const FONT_CHOICE = 22;
const FONT_BODY = 20;
const FONT_CAPTION = 14;
const FONT_FOOTER = 11;
const COLOR_PRIMARY = '2D2F77';
const COLOR_ACCENT = '059669';
const COLOR_MUTED = '64748B';
const COLOR_BG_SOFT = 'F5F7FF';
const FONT_STACK = 'Pretendard';

export type AnswerVariant = 'student' | 'teacher' | 'combined';

export interface RenderPptxOptions {
  answerVariant?: AnswerVariant;
}

// ============================================================
// 슬라이드 그룹핑 — 발표용 규칙.
// heading level 1 은 표지 슬라이드로 분리, 각 question / activity /
// image / table 은 자신만의 슬라이드. paragraph/callout 은 앞의 heading 과
// 함께 텍스트 슬라이드로 묶이되 250자 초과 시 분할.
// AI 힌트 slide-break 는 힌트만 (강제 분할 X, 이미 대체로 자연스러움).
// ============================================================
export interface SlideChunk {
  kind:
    | 'cover'          // 문서 표지
    | 'section-cover'  // 섹션 표지 (heading L1)
    | 'question'
    | 'activity'
    | 'table'
    | 'image'
    | 'text'           // heading L2/3 + paragraph 묶음
    | 'answer-key';
  title: string;
  sections: Section[];
}

export function splitIntoSlides(doc: LearningDocument): SlideChunk[] {
  const chunks: SlideChunk[] = [
    // 문서 표지
    { kind: 'cover', title: doc.meta.title, sections: [] },
  ];

  let currentSectionTitle = doc.meta.title;
  let textBuffer: { title: string; sections: Section[]; chars: number } | null = null;

  function flushText(): void {
    if (textBuffer && textBuffer.sections.length > 0) {
      chunks.push({ kind: 'text', title: textBuffer.title, sections: textBuffer.sections });
    }
    textBuffer = null;
  }

  const answerKeys: Section[] = [];

  for (const s of doc.sections) {
    // 정답·해설은 마지막에 몰아서.
    if (s.kind === 'answer-key') {
      answerKeys.push(s);
      continue;
    }

    if (s.kind === 'slide-break') {
      // 힌트만. 텍스트 버퍼 flush.
      flushText();
      continue;
    }

    if (s.kind === 'heading' && s.level === 1) {
      flushText();
      currentSectionTitle = s.text;
      chunks.push({ kind: 'section-cover', title: s.text, sections: [] });
      continue;
    }

    if (s.kind === 'question') {
      flushText();
      chunks.push({
        kind: 'question',
        title: currentSectionTitle,
        sections: [s],
      });
      continue;
    }

    if (s.kind === 'activity') {
      flushText();
      chunks.push({
        kind: 'activity',
        title: s.title ? `활동 · ${s.title}` : currentSectionTitle,
        sections: [s],
      });
      continue;
    }

    if (s.kind === 'table') {
      flushText();
      chunks.push({
        kind: 'table',
        title: s.caption ?? currentSectionTitle,
        sections: [s],
      });
      continue;
    }

    if (s.kind === 'image') {
      flushText();
      chunks.push({
        kind: 'image',
        title: s.caption ?? currentSectionTitle,
        sections: [s],
      });
      continue;
    }

    if (s.kind === 'rubric') {
      flushText();
      chunks.push({ kind: 'table', title: '평가 기준', sections: [s] });
      continue;
    }

    // heading L2/3, paragraph, callout → 텍스트 버퍼.
    const chars =
      s.kind === 'paragraph' || s.kind === 'callout'
        ? s.text.length
        : s.kind === 'heading'
          ? s.text.length
          : 0;
    if (textBuffer && textBuffer.chars + chars > 250) {
      flushText();
    }
    if (!textBuffer) {
      textBuffer = { title: currentSectionTitle, sections: [], chars: 0 };
    }
    textBuffer.sections.push(s);
    textBuffer.chars += chars;
  }
  flushText();

  if (answerKeys.length > 0) {
    chunks.push({ kind: 'answer-key', title: '정답과 해설', sections: answerKeys });
  }

  return chunks;
}

// ============================================================
// 렌더러.
// ============================================================
export async function renderPptx(
  doc: LearningDocument,
  options: RenderPptxOptions = {},
): Promise<Buffer> {
  const variant = options.answerVariant ?? 'combined';

  // student variant: answer-key 제외.
  // teacher variant: answer-key 만 + 표지 유지.
  const filteredDoc: LearningDocument = {
    ...doc,
    sections: filterSections(doc.sections, variant),
  };

  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  pres.author = '우리학교 클립아트스튜디오';
  pres.title = doc.meta.title;

  const chunks = splitIntoSlides(filteredDoc);

  for (const chunk of chunks) {
    const slide = pres.addSlide();
    slide.background = { color: 'FFFFFF' };
    drawHeader(slide, chunk, doc);
    await drawBody(slide, chunk, variant);
    drawFooter(slide, doc, variant);
  }

  const buf = (await pres.write({ outputType: 'nodebuffer' })) as Buffer;
  return buf;
}

function filterSections(sections: Section[], variant: AnswerVariant): Section[] {
  if (variant === 'combined') return sections;
  if (variant === 'student') return sections.filter((s) => s.kind !== 'answer-key');
  return sections.filter(
    (s) =>
      s.kind === 'answer-key' ||
      s.kind === 'rubric' ||
      (s.kind === 'heading' && s.level === 1) ||
      s.kind === 'callout',
  );
}

// ============================================================
// 슬라이드 헤더 (표지가 아닌 경우 상단에 얇은 브랜드 바 + 섹션 타이틀).
// ============================================================
type Slide = ReturnType<PptxGenJS['addSlide']>;

function drawHeader(slide: Slide, chunk: SlideChunk, doc: LearningDocument): void {
  if (chunk.kind === 'cover') {
    // 표지는 별도 처리. 헤더 X.
    return;
  }
  const anySlide = slide as unknown as {
    addText: (t: string, o: Record<string, unknown>) => void;
    addShape: (t: string, o: Record<string, unknown>) => void;
  };
  // 상단 브랜드 바
  anySlide.addShape('rect' as never, {
    x: 0,
    y: 0,
    w: LAYOUT_WIDE.w,
    h: 0.4,
    fill: { color: COLOR_PRIMARY },
    line: { color: COLOR_PRIMARY },
  });
  anySlide.addText(
    `${doc.meta.grade}학년 · ${SUBJECT_LABEL[doc.meta.subject] ?? doc.meta.subject}`,
    {
      x: 0.7,
      y: 0.05,
      w: 6,
      h: 0.3,
      fontSize: FONT_FOOTER,
      color: 'FFFFFF',
      fontFace: FONT_STACK,
    },
  );
  // 섹션 타이틀
  anySlide.addText(chunk.title, {
    x: 0.7,
    y: 0.6,
    w: 11.9,
    h: 0.7,
    fontSize: FONT_SECTION,
    bold: true,
    color: COLOR_PRIMARY,
    fontFace: FONT_STACK,
  });
}

// ============================================================
// 슬라이드 본문 — kind 별 발표용 레이아웃.
// ============================================================
async function drawBody(
  slide: Slide,
  chunk: SlideChunk,
  variant: AnswerVariant,
): Promise<void> {
  const anySlide = slide as unknown as {
    addText: (t: string, o: Record<string, unknown>) => void;
    addTable: (rows: unknown[][], o: Record<string, unknown>) => void;
    addImage: (o: Record<string, unknown>) => void;
    addShape: (t: string, o: Record<string, unknown>) => void;
  };

  const S = SAFE;

  switch (chunk.kind) {
    case 'cover': {
      // 문서 표지 — 큰 제목 중앙.
      anySlide.addText(chunk.title, {
        x: 0.5,
        y: 2.8,
        w: 12.3,
        h: 1.5,
        fontSize: 44,
        bold: true,
        color: COLOR_PRIMARY,
        align: 'center',
        fontFace: FONT_STACK,
      });
      anySlide.addText('AI 초안 · 교사 검토가 필요합니다', {
        x: 0.5,
        y: 4.5,
        w: 12.3,
        h: 0.5,
        fontSize: FONT_BODY,
        italic: true,
        color: COLOR_MUTED,
        align: 'center',
        fontFace: FONT_STACK,
      });
      return;
    }

    case 'section-cover': {
      // 섹션 구분 표지 — 상단 헤더 이미 그렸으므로 본문에 부제만.
      anySlide.addText('학습 목표에 맞춰 아래 내용을 함께 살펴봐요.', {
        x: S.x,
        y: 3.5,
        w: S.w,
        h: 0.8,
        fontSize: FONT_BODY,
        color: COLOR_MUTED,
        align: 'center',
        fontFace: FONT_STACK,
      });
      return;
    }

    case 'question': {
      const q = chunk.sections[0];
      if (!q || q.kind !== 'question') return;
      const number = q.number ? `${q.number}. ` : '';
      // 문제 본문 — 상단 넓게.
      anySlide.addText(`${number}${q.stem}`, {
        x: S.x,
        y: 1.6,
        w: S.w,
        h: 1.6,
        fontSize: FONT_QUESTION,
        bold: true,
        color: COLOR_PRIMARY,
        fontFace: FONT_STACK,
        valign: 'top',
      });
      // 선택지 — 큰 글자로 좌측 정렬. 4지선다 기준 각 선택지 슬라이드 1/4 높이.
      if (q.choices?.length) {
        const choicesText = q.choices.map((c, i) => `${i + 1}) ${c}`).join('\n\n');
        anySlide.addText(choicesText, {
          x: S.x + 0.5,
          y: 3.4,
          w: S.w - 0.5,
          h: 3.0,
          fontSize: FONT_CHOICE,
          color: '1A1A1A',
          fontFace: FONT_STACK,
          valign: 'top',
        });
      }
      // 인라인 정답 (combined only)
      if (variant === 'combined' && q.answer) {
        anySlide.addText(`정답: ${q.answer}`, {
          x: S.x,
          y: 6.4,
          w: S.w,
          h: 0.4,
          fontSize: FONT_BODY,
          bold: true,
          color: COLOR_ACCENT,
          fontFace: FONT_STACK,
        });
      }
      if (q.hint) {
        anySlide.addText(`💡 ${q.hint}`, {
          x: S.x,
          y: 6.0,
          w: S.w,
          h: 0.4,
          fontSize: FONT_CAPTION,
          italic: true,
          color: COLOR_MUTED,
          fontFace: FONT_STACK,
        });
      }
      return;
    }

    case 'activity': {
      const a = chunk.sections[0];
      if (!a || a.kind !== 'activity') return;
      // 활동 스텝 — 큰 번호 카드 스타일.
      const startY = 1.7;
      a.steps.forEach((step, i) => {
        const rowY = startY + i * 0.85;
        if (rowY > 6.6) return; // 안전 영역 넘으면 무시 (초기 슬라이드당 활동 1개 원칙).
        // 번호 원
        anySlide.addShape('ellipse' as never, {
          x: S.x,
          y: rowY,
          w: 0.7,
          h: 0.7,
          fill: { color: COLOR_PRIMARY },
          line: { color: COLOR_PRIMARY },
        });
        anySlide.addText(String(i + 1), {
          x: S.x,
          y: rowY,
          w: 0.7,
          h: 0.7,
          fontSize: FONT_BODY,
          bold: true,
          color: 'FFFFFF',
          align: 'center',
          valign: 'middle',
          fontFace: FONT_STACK,
        });
        // 스텝 텍스트
        anySlide.addText(step, {
          x: S.x + 1.0,
          y: rowY,
          w: S.w - 1.0,
          h: 0.7,
          fontSize: FONT_BODY,
          color: '1A1A1A',
          valign: 'middle',
          fontFace: FONT_STACK,
        });
      });
      // 준비물 · 시간
      const meta: string[] = [];
      if (a.materials?.length) meta.push(`준비물: ${a.materials.join(', ')}`);
      if (a.estimatedMinutes) meta.push(`예상 ${a.estimatedMinutes}분`);
      if (meta.length) {
        anySlide.addText(meta.join(' · '), {
          x: S.x,
          y: 6.4,
          w: S.w,
          h: 0.4,
          fontSize: FONT_CAPTION,
          italic: true,
          color: COLOR_MUTED,
          fontFace: FONT_STACK,
        });
      }
      return;
    }

    case 'table': {
      const t = chunk.sections[0];
      if (!t) return;
      if (t.kind === 'table') {
        const rows: unknown[][] = [];
        if (t.headers?.length) {
          rows.push(
            t.headers.map((h) => ({
              text: h,
              options: {
                bold: true,
                fill: { color: COLOR_BG_SOFT },
                color: COLOR_PRIMARY,
                fontFace: FONT_STACK,
                fontSize: FONT_BODY,
              },
            })),
          );
        }
        for (const row of t.rows) {
          rows.push(
            row.map((c) => ({
              text: c,
              options: { fontFace: FONT_STACK, color: '1A1A1A', fontSize: FONT_BODY - 2 },
            })),
          );
        }
        anySlide.addTable(rows, {
          x: S.x,
          y: 1.7,
          w: S.w,
          border: { type: 'solid', pt: 1, color: 'CBD5E1' },
        });
      } else if (t.kind === 'rubric') {
        const rows: unknown[][] = [
          [
            {
              text: '평가 기준',
              options: {
                bold: true,
                fill: { color: COLOR_BG_SOFT },
                color: COLOR_PRIMARY,
                fontFace: FONT_STACK,
                fontSize: FONT_BODY,
              },
            },
            ...(t.criteria[0]?.levels ?? []).map((_, i) => ({
              text: `수준 ${i + 1}`,
              options: {
                bold: true,
                fill: { color: COLOR_BG_SOFT },
                color: COLOR_PRIMARY,
                fontFace: FONT_STACK,
                fontSize: FONT_BODY,
              },
            })),
          ],
          ...t.criteria.map((c) => [
            {
              text: c.criterion,
              options: { bold: true, fontFace: FONT_STACK, fontSize: FONT_BODY - 4 },
            },
            ...c.levels.map((l) => ({
              text: l,
              options: { fontFace: FONT_STACK, fontSize: FONT_BODY - 4 },
            })),
          ]),
        ];
        anySlide.addTable(rows, {
          x: S.x,
          y: 1.7,
          w: S.w,
          border: { type: 'solid', pt: 1, color: 'CBD5E1' },
        });
      }
      return;
    }

    case 'image': {
      const im = chunk.sections[0];
      if (!im || im.kind !== 'image') return;
      try {
        const img = await loadImage(im.assetRef);
        // 슬라이드 안전 영역: SAFE.w = 11.9 x 5.3.
        // 최대 폭 60%, 최대 높이 4.8 inch.
        const cappedPct = Math.min(im.widthPct ?? 60, 80);
        const targetWidthIn = S.w * (cappedPct / 100);
        // fitDimensions 는 px 단위지만 비율만 필요 → 그대로 사용.
        const dims = fitDimensions(
          { width: img.width, height: img.height },
          Math.round(targetWidthIn * 100), // 임의 단위 (비율만 사용)
          Math.round(4.8 * 100),
        );
        const widthIn = dims.width / 100;
        const heightIn = dims.height / 100;
        const xIn = (LAYOUT_WIDE.w - widthIn) / 2;
        anySlide.addImage({
          data: img.dataUrl,
          x: xIn,
          y: 1.7,
          w: widthIn,
          h: heightIn,
        });
        if (im.caption) {
          anySlide.addText(im.caption, {
            x: S.x,
            y: 1.7 + heightIn + 0.1,
            w: S.w,
            h: 0.4,
            fontSize: FONT_CAPTION,
            italic: true,
            color: COLOR_MUTED,
            align: 'center',
            fontFace: FONT_STACK,
          });
        }
      } catch {
        anySlide.addText(`[이미지 로드 실패: ${im.assetRef}]`, {
          x: S.x,
          y: 3.0,
          w: S.w,
          h: 0.5,
          fontSize: FONT_BODY,
          italic: true,
          color: '9CA3AF',
          align: 'center',
          fontFace: FONT_STACK,
        });
      }
      return;
    }

    case 'text': {
      let cursorY = 1.7;
      for (const s of chunk.sections) {
        if (s.kind === 'heading') {
          const size = s.level === 2 ? 24 : 22;
          anySlide.addText(s.text, {
            x: S.x,
            y: cursorY,
            w: S.w,
            h: 0.6,
            fontSize: size,
            bold: true,
            color: COLOR_PRIMARY,
            fontFace: FONT_STACK,
          });
          cursorY += 0.65;
        } else if (s.kind === 'paragraph') {
          anySlide.addText(s.text, {
            x: S.x,
            y: cursorY,
            w: S.w,
            h: 1.0,
            fontSize: FONT_BODY,
            color: '1A1A1A',
            fontFace: FONT_STACK,
            valign: 'top',
          });
          cursorY += 1.1;
        } else if (s.kind === 'callout') {
          anySlide.addShape('rect' as never, {
            x: S.x,
            y: cursorY,
            w: S.w,
            h: 0.9,
            fill: { color: COLOR_BG_SOFT },
            line: { color: COLOR_PRIMARY, width: 1 },
          });
          anySlide.addText(s.text, {
            x: S.x + 0.2,
            y: cursorY,
            w: S.w - 0.4,
            h: 0.9,
            fontSize: FONT_BODY,
            color: COLOR_PRIMARY,
            valign: 'middle',
            fontFace: FONT_STACK,
          });
          cursorY += 1.1;
        }
      }
      return;
    }

    case 'answer-key': {
      // 정답·해설을 하나의 슬라이드에 표 형태로.
      const entries = chunk.sections.flatMap((s) =>
        s.kind === 'answer-key' ? s.entries : [],
      );
      const rows: unknown[][] = [
        [
          {
            text: '번호',
            options: {
              bold: true,
              fill: { color: COLOR_BG_SOFT },
              color: COLOR_PRIMARY,
              fontFace: FONT_STACK,
              fontSize: FONT_BODY,
            },
          },
          {
            text: '정답',
            options: {
              bold: true,
              fill: { color: COLOR_BG_SOFT },
              color: COLOR_PRIMARY,
              fontFace: FONT_STACK,
              fontSize: FONT_BODY,
            },
          },
          {
            text: '해설',
            options: {
              bold: true,
              fill: { color: COLOR_BG_SOFT },
              color: COLOR_PRIMARY,
              fontFace: FONT_STACK,
              fontSize: FONT_BODY,
            },
          },
        ],
        ...entries.map((e) => [
          { text: e.ref, options: { bold: true, fontFace: FONT_STACK, fontSize: FONT_BODY - 2 } },
          { text: e.answer, options: { fontFace: FONT_STACK, fontSize: FONT_BODY - 2 } },
          {
            text: e.rationale ?? '',
            options: {
              fontFace: FONT_STACK,
              fontSize: FONT_BODY - 4,
              italic: true,
              color: COLOR_MUTED,
            },
          },
        ]),
      ];
      anySlide.addTable(rows, {
        x: S.x,
        y: 1.7,
        w: S.w,
        border: { type: 'solid', pt: 1, color: 'CBD5E1' },
        colW: [1.2, 2.5, 8.2],
      });
      return;
    }
  }
}

// ============================================================
// 슬라이드 하단 브랜드 footer.
// ============================================================
function drawFooter(slide: Slide, doc: LearningDocument, variant: AnswerVariant): void {
  const anySlide = slide as unknown as {
    addText: (t: string, o: Record<string, unknown>) => void;
  };
  const variantLabel =
    variant === 'student'
      ? '학생용'
      : variant === 'teacher'
        ? '교사용'
        : '학생용 + 정답';
  anySlide.addText(
    `우리학교 클립아트스튜디오 · AI 초안 · ${variantLabel}`,
    {
      x: 0.5,
      y: 7.15,
      w: LAYOUT_WIDE.w - 1,
      h: 0.3,
      fontSize: FONT_FOOTER,
      color: COLOR_MUTED,
      fontFace: FONT_STACK,
      align: 'right',
    },
  );
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
