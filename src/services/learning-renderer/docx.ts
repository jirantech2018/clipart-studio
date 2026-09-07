// DOCX 렌더러 — `docx` npm.
//
// LearningDocument → Word 문서 Buffer.
// Phase 0 검증: 한글 폰트(문서 내 지정만, embed 없음 → 열람 환경 폰트 사용),
// 표·이미지, 실제 Word/한컴오피스 편집 가능 여부.

import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertMillimetersToTwip,
} from 'docx';

import { loadImage } from './image-loader';
import type { LearningDocument, Section } from './schema';

export async function renderDocx(doc: LearningDocument): Promise<Buffer> {
  const nested = await Promise.all(doc.sections.map(sectionToDocxChildren));
  const children = nested.flat();

  const document = new Document({
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
              top: convertMillimetersToTwip(20),
              right: convertMillimetersToTwip(18),
              bottom: convertMillimetersToTwip(20),
              left: convertMillimetersToTwip(18),
            },
          },
        },
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: `${doc.meta.title} · ${doc.meta.grade}학년 · ${SUBJECT_LABEL[doc.meta.subject] ?? doc.meta.subject}`,
                bold: true,
                color: '2D2F77',
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'AI 초안이며 교사 검토가 필요합니다.',
                italics: true,
                color: '64748B',
                size: 18,
              }),
            ],
            spacing: { after: 200 },
          }),
          ...(children as (Paragraph | Table)[]),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(document);
  return Buffer.from(buffer);
}

type DocxChild = Paragraph | Table;

async function sectionToDocxChildren(section: Section): Promise<DocxChild[]> {
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
      const rows: TableRow[] = [];
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
        rows,
      });
      return [table, new Paragraph({ text: '', spacing: { after: 120 } })];
    }

    case 'image': {
      // Phase 0: image-loader 로 로컬 파일 buffer 로드. Phase 1 에서는
      // source==='clipart' 인 경우 R2 URL fetch 로 확장.
      try {
        const img = await loadImage(section.assetRef);
        // docx ImageRun 은 픽셀 크기 지정. widthPct 를 A4 본문 폭 기준으로 환산.
        // A4 - margin 좌우 18mm = 174mm ≈ 493 EMU. 여기선 화면 픽셀 620px 기준.
        const targetWidthPx = Math.round(620 * ((section.widthPct ?? 60) / 100));
        // 원본 비율 유지를 위한 근사값 — 4:3 가정 (샘플 클립아트).
        const targetHeightPx = Math.round((targetWidthPx * 3) / 4);
        const imageType = img.mime === 'image/jpeg' ? 'jpg' : img.mime === 'image/webp' ? 'png' : 'png';
        const paragraphs: DocxChild[] = [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 60 },
            children: [
              new ImageRun({
                data: img.buffer,
                transformation: { width: targetWidthPx, height: targetHeightPx },
                type: imageType as 'png' | 'jpg',
              }),
            ],
          }),
        ];
        if (section.caption) {
          paragraphs.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: section.caption,
                  italics: true,
                  color: '64748B',
                  size: 18,
                }),
              ],
              spacing: { after: 120 },
            }),
          );
        }
        return paragraphs;
      } catch {
        return [
          new Paragraph({
            children: [
              new TextRun({
                text: `[이미지 로드 실패: ${section.assetRef}]`,
                italics: true,
                color: '9CA3AF',
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 120 },
          }),
        ];
      }
    }

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
      const rows: TableRow[] = [
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
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
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
