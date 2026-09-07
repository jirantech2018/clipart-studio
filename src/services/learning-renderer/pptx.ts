// PPTX 렌더러 — `pptxgenjs`.
//
// D-12 확정: AI 응답의 slide-break 는 보조 힌트로만 사용. 최종 슬라이드 분할은
// 이 렌더러가 다음 기준으로 결정한다.
//
//   [슬라이드 분할 기준값 — Phase 0 실증으로 튜닝 대상]
//   - heading level 1 → 무조건 새 슬라이드
//   - AI 힌트 slide-break → 새 슬라이드 (강제)
//   - 문항 3개 초과 → 새 슬라이드
//   - 텍스트 400자 초과 → 새 슬라이드
//   - 표 8행 초과 → 표만 별도 슬라이드
//   - 이미지 2개 초과 → 새 슬라이드

import PptxGenJS from 'pptxgenjs';

import { loadImage } from './image-loader';
import type { LearningDocument, Section } from './schema';

// 슬라이드 분할 기준값 (Phase 0 튜닝 대상).
const SPLIT = {
  maxQuestionsPerSlide: 3,
  maxCharsPerSlide: 400,
  maxRowsPerSlideTable: 8,
  maxImagesPerSlide: 2,
} as const;

export interface SlideChunk {
  /** 슬라이드 제목 — heading level 1 텍스트 우선, 없으면 자동 생성. */
  title: string;
  /** 이 슬라이드에 담길 원본 sections (image/table/text/question/activity 등). */
  sections: Section[];
}

// ============================================================
// 슬라이드 분할 순수 함수 (단위 테스트 대상).
// ============================================================
export function splitIntoSlides(doc: LearningDocument): SlideChunk[] {
  const chunks: SlideChunk[] = [];
  let current: SlideChunk = { title: doc.meta.title, sections: [] };
  let questionCount = 0;
  let charCount = 0;
  let imageCount = 0;

  function pushCurrent(): void {
    if (current.sections.length > 0) chunks.push(current);
  }
  function startNew(title: string): void {
    pushCurrent();
    current = { title, sections: [] };
    questionCount = 0;
    charCount = 0;
    imageCount = 0;
  }
  function sectionCharCost(s: Section): number {
    if (s.kind === 'paragraph') return s.text.length;
    if (s.kind === 'heading') return s.text.length;
    if (s.kind === 'callout') return s.text.length;
    if (s.kind === 'question') return s.stem.length + (s.choices?.join('').length ?? 0);
    if (s.kind === 'activity') return s.steps.join('').length + (s.title?.length ?? 0);
    return 0;
  }

  for (const s of doc.sections) {
    // heading level 1 → 무조건 새 슬라이드로 시작 (제목으로 사용).
    if (s.kind === 'heading' && s.level === 1) {
      startNew(s.text);
      // heading 자체는 슬라이드 제목이 되므로 sections 에 다시 담지 않음.
      continue;
    }

    // AI 힌트 slide-break → 강제 새 슬라이드.
    if (s.kind === 'slide-break') {
      startNew(current.title); // 제목은 유지 (또는 자동 재계산). Phase 0 에서 관찰.
      continue;
    }

    // 임계값 초과 시 새 슬라이드.
    const cost = sectionCharCost(s);
    if (charCount + cost > SPLIT.maxCharsPerSlide && current.sections.length > 0) {
      startNew(current.title);
    }
    if (s.kind === 'question' && questionCount + 1 > SPLIT.maxQuestionsPerSlide) {
      startNew(current.title);
    }
    if (
      s.kind === 'table' &&
      s.rows.length > SPLIT.maxRowsPerSlideTable &&
      current.sections.length > 0
    ) {
      startNew(current.title);
    }
    if (s.kind === 'image' && imageCount + 1 > SPLIT.maxImagesPerSlide) {
      startNew(current.title);
    }

    current.sections.push(s);
    charCount += cost;
    if (s.kind === 'question') questionCount += 1;
    if (s.kind === 'image') imageCount += 1;
  }
  pushCurrent();
  return chunks;
}

// ============================================================
// pptx 파일 생성.
// ============================================================
export async function renderPptx(doc: LearningDocument): Promise<Buffer> {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 inch
  pres.author = '우리학교 클립아트스튜디오';
  pres.title = doc.meta.title;

  const slides = splitIntoSlides(doc);

  for (const chunk of slides) {
    const slide = pres.addSlide();

    // 배경 · 헤더
    slide.background = { color: 'FFFFFF' };
    slide.addText(chunk.title, {
      x: 0.5,
      y: 0.4,
      w: 12.3,
      h: 0.9,
      fontSize: 32,
      bold: true,
      color: '2D2F77',
      fontFace: 'Pretendard',
    });
    slide.addShape('line' as never, {
      x: 0.5,
      y: 1.3,
      w: 12.3,
      h: 0,
      line: { color: '2D2F77', width: 2 },
    });

    let cursorY = 1.6;
    for (const s of chunk.sections) {
      const rendered = await renderSection(slide, s, cursorY);
      cursorY += rendered.consumedHeight + 0.2;
    }

    // Footer
    slide.addText(
      `${doc.meta.grade}학년 · ${SUBJECT_LABEL[doc.meta.subject] ?? doc.meta.subject} · AI 초안 (교사 검토 필요)`,
      {
        x: 0.5,
        y: 7.0,
        w: 12.3,
        h: 0.3,
        fontSize: 10,
        color: '94A3B8',
        fontFace: 'Pretendard',
        align: 'right',
      },
    );
  }

  const buf = (await pres.write({ outputType: 'nodebuffer' })) as Buffer;
  return buf;
}

type PptxSlide = ReturnType<PptxGenJS['addSlide']>;

// ============================================================
// 단일 sections 렌더 (매우 단순 배치 — Phase 0 검증용).
// Phase 1 에서는 자동 레이아웃 개선 필요.
// ============================================================
async function renderSection(
  slide: PptxSlide,
  s: Section,
  y: number,
): Promise<{ consumedHeight: number }> {
  const anySlide = slide as unknown as {
    addText: (t: string, o: Record<string, unknown>) => void;
    addTable: (rows: unknown[][], o: Record<string, unknown>) => void;
    addImage: (o: Record<string, unknown>) => void;
  };

  const commonText = (fontSize: number, extra: Record<string, unknown> = {}) => ({
    x: 0.7,
    w: 11.9,
    fontSize,
    fontFace: 'Pretendard',
    color: '1A1A1A',
    valign: 'top',
    ...extra,
  });

  switch (s.kind) {
    case 'heading': {
      const size = s.level === 2 ? 22 : 18;
      anySlide.addText(s.text, { ...commonText(size, { bold: true, color: '2D2F77' }), y, h: 0.5 });
      return { consumedHeight: 0.5 };
    }
    case 'paragraph':
      anySlide.addText(s.text, { ...commonText(16), y, h: 0.9 });
      return { consumedHeight: 0.9 };
    case 'callout':
      anySlide.addText(s.text, {
        ...commonText(14, { italic: true, color: '2D2F77', fill: { color: 'F5F7FF' } }),
        y,
        h: 0.6,
      });
      return { consumedHeight: 0.6 };
    case 'question': {
      const number = s.number ? `${s.number}. ` : '';
      const body =
        `${number}${s.stem}` +
        (s.choices?.length
          ? '\n' + s.choices.map((c, i) => `${i + 1}) ${c}`).join('\n')
          : '');
      anySlide.addText(body, { ...commonText(15), y, h: 1.6 });
      return { consumedHeight: 1.6 };
    }
    case 'activity': {
      const body =
        (s.title ? `[${s.title}]\n` : '') + s.steps.map((st, i) => `${i + 1}. ${st}`).join('\n');
      anySlide.addText(body, { ...commonText(14), y, h: 1.6 });
      return { consumedHeight: 1.6 };
    }
    case 'table': {
      const rows: unknown[][] = [];
      if (s.headers?.length) {
        rows.push(
          s.headers.map((h) => ({
            text: h,
            options: { bold: true, fill: { color: 'EEF1FF' }, color: '2D2F77', fontFace: 'Pretendard' },
          })),
        );
      }
      for (const row of s.rows) {
        rows.push(
          row.map((c) => ({ text: c, options: { fontFace: 'Pretendard', color: '1A1A1A' } })),
        );
      }
      anySlide.addTable(rows, {
        x: 0.7,
        y,
        w: 11.9,
        fontSize: 12,
        border: { type: 'solid', pt: 0.5, color: 'CBD5E1' },
      });
      const rowH = 0.4;
      return { consumedHeight: rows.length * rowH + 0.2 };
    }
    case 'image':
      try {
        const img = await loadImage(s.assetRef);
        // 폭 pct 를 슬라이드 사용 폭 (11.9 in) 기준으로 환산.
        const widthIn = 11.9 * ((s.widthPct ?? 60) / 100);
        // 원본 비율 4:3 가정 (Phase 0 sample).
        const heightIn = (widthIn * 3) / 4;
        anySlide.addImage({
          data: img.dataUrl,
          x: (13.333 - widthIn) / 2,
          y,
          w: widthIn,
          h: heightIn,
        });
        let consumed = heightIn;
        if (s.caption) {
          anySlide.addText(s.caption, {
            ...commonText(11, { italic: true, color: '64748B', align: 'center' }),
            y: y + heightIn + 0.05,
            h: 0.3,
          });
          consumed += 0.35;
        }
        return { consumedHeight: consumed };
      } catch {
        anySlide.addText(`[이미지 로드 실패: ${s.assetRef}]`, {
          ...commonText(11, { italic: true, color: '9CA3AF' }),
          y,
          h: 0.4,
        });
        return { consumedHeight: 0.4 };
      }
    case 'answer-key':
      // 답안은 별도 슬라이드 만들거나 마지막에 몰기 — Phase 0 은 skip.
      return { consumedHeight: 0 };
    case 'rubric':
      // 표 유사하게 처리.
      return { consumedHeight: 0 };
    case 'slide-break':
      return { consumedHeight: 0 };
    default:
      return { consumedHeight: 0 };
  }
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
