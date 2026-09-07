// @ts-nocheck — Phase 0 skeleton. 라이브러리 설치 후 제거: pnpm add docx
//
// DOCX 렌더러 (Phase 0 skeleton) — docx npm.
//
// LearningDocument → Word 문서 Buffer.
// Phase 0 검증: 한글 폰트(문서 내 지정만, embed 없음 → 열람 환경 폰트 사용),
// 표·이미지, 실제 Word/한컴오피스 편집 가능 여부.

import type { LearningDocument, Section } from './schema';

async function loadDocx() {
  const mod = await import('docx');
  return mod;
}

export async function renderDocx(doc: LearningDocument): Promise<Buffer> {
  const D = await loadDocx();

  const children = doc.sections.flatMap((s) => sectionToDocxChildren(s, D));

  const document = new D.Document({
    creator: '우리학교 클립아트스튜디오',
    title: doc.meta.title,
    styles: {
      default: {
        document: {
          run: { font: 'Pretendard' },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: D.convertMillimetersToTwip(20),
              right: D.convertMillimetersToTwip(18),
              bottom: D.convertMillimetersToTwip(20),
              left: D.convertMillimetersToTwip(18),
            },
          },
        },
        children: [
          new D.Paragraph({
            children: [
              new D.TextRun({
                text: `${doc.meta.title} · ${doc.meta.grade}학년 · ${SUBJECT_LABEL[doc.meta.subject] ?? doc.meta.subject}`,
                bold: true,
                color: '2D2F77',
              }),
            ],
          }),
          new D.Paragraph({
            children: [
              new D.TextRun({
                text: 'AI 초안이며 교사 검토가 필요합니다.',
                italics: true,
                color: '64748B',
                size: 18,
              }),
            ],
            spacing: { after: 200 },
          }),
          ...children,
        ],
      },
    ],
  });

  const buffer = await D.Packer.toBuffer(document);
  return buffer;
}

type DocxModule = Awaited<ReturnType<typeof loadDocx>>;

function sectionToDocxChildren(section: Section, D: DocxModule): unknown[] {
  const { Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType } = D;

  switch (section.kind) {
    case 'heading': {
      const level =
        section.level === 1
          ? HeadingLevel.HEADING_1
          : section.level === 2
            ? HeadingLevel.HEADING_2
            : HeadingLevel.HEADING_3;
      return [
        new Paragraph({
          heading: level,
          children: [new TextRun({ text: section.text, bold: true, color: '2D2F77' })],
          spacing: { before: 240, after: 120 },
        }),
      ];
    }

    case 'paragraph':
      return [
        new Paragraph({ children: [new TextRun(section.text)], spacing: { after: 100 } }),
      ];

    case 'callout':
      return [
        new Paragraph({
          children: [new TextRun({ text: section.text, italics: true })],
          spacing: { before: 100, after: 100 },
        }),
      ];

    case 'question': {
      const number = section.number ? `${section.number}. ` : '';
      const stemPara = new Paragraph({
        children: [new TextRun({ text: `${number}${section.stem}`, bold: true })],
        spacing: { before: 120, after: 60 },
      });
      const choicePs = (section.choices ?? []).map(
        (c, i) =>
          new Paragraph({
            children: [new TextRun(`${i + 1}) ${c}`)],
            spacing: { after: 40 },
          }),
      );
      const hintP = section.hint
        ? [
            new Paragraph({
              children: [new TextRun({ text: `💡 ${section.hint}`, italics: true, color: '64748B' })],
              spacing: { after: 100 },
            }),
          ]
        : [];
      return [stemPara, ...choicePs, ...hintP];
    }

    case 'activity': {
      const titleP = section.title
        ? [
            new Paragraph({
              children: [new TextRun({ text: section.title, bold: true, color: '2D2F77' })],
              spacing: { before: 120, after: 60 },
            }),
          ]
        : [];
      const stepPs = section.steps.map(
        (s, i) =>
          new Paragraph({
            children: [new TextRun(`${i + 1}. ${s}`)],
            spacing: { after: 40 },
          }),
      );
      const matsP = section.materials?.length
        ? [
            new Paragraph({
              children: [new TextRun({ text: `준비물: ${section.materials.join(', ')}`, italics: true })],
              spacing: { after: 60 },
            }),
          ]
        : [];
      return [...titleP, ...stepPs, ...matsP];
    }

    case 'table': {
      const rows: unknown[] = [];
      if (section.headers?.length) {
        rows.push(
          new TableRow({
            children: section.headers.map(
              (h) =>
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [new TextRun({ text: h, bold: true })],
                    }),
                  ],
                }),
            ),
            tableHeader: true,
          }),
        );
      }
      for (const row of section.rows) {
        rows.push(
          new TableRow({
            children: row.map(
              (c) =>
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun(c)] })],
                }),
            ),
          }),
        );
      }
      const table = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: rows as never[],
      });
      return [table, new Paragraph({ text: '', spacing: { after: 120 } })];
    }

    case 'image':
      // Phase 0 skeleton: 실제 이미지 fetch 는 Phase 1 에서 R2 매핑 후 구현.
      return [
        new Paragraph({
          children: [new TextRun({ text: `[이미지: ${section.assetRef}]`, italics: true, color: '64748B' })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 120 },
        }),
      ];

    case 'answer-key': {
      const header = new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: '정답과 해설', bold: true, color: '2D2F77' })],
        spacing: { before: 240, after: 120 },
      });
      const items = section.entries.map(
        (e) =>
          new Paragraph({
            children: [
              new TextRun({ text: `${e.ref}. `, bold: true }),
              new TextRun(`${e.answer}`),
              ...(e.rationale
                ? [new TextRun({ text: ` — ${e.rationale}`, italics: true, color: '64748B' })]
                : []),
            ],
            spacing: { after: 60 },
          }),
      );
      return [header, ...items];
    }

    case 'rubric': {
      const rows: unknown[] = [
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: '평가 기준', bold: true })] })],
            }),
            ...(section.criteria[0]?.levels ?? []).map(
              (_, i) =>
                new TableCell({
                  children: [
                    new Paragraph({ children: [new TextRun({ text: `수준 ${i + 1}`, bold: true })] }),
                  ],
                }),
            ),
          ],
          tableHeader: true,
        }),
        ...section.criteria.map(
          (c) =>
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: c.criterion, bold: true })] })],
                }),
                ...c.levels.map(
                  (l) =>
                    new TableCell({
                      children: [new Paragraph({ children: [new TextRun(l)] })],
                    }),
                ),
              ],
            }),
        ),
      ];
      return [
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: rows as never[] }),
        new Paragraph({ text: '', spacing: { after: 120 } }),
      ];
    }

    case 'slide-break':
      // docx 는 슬라이드 개념 없음 — 무시.
      return [];

    default:
      return [];
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
