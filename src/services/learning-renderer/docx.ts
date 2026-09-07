// DOCX 렌더러 — `docx` npm.
//
// v3 (Phase 0.6) 개선:
//   - 폰트를 Windows 기본 한글 폰트 '맑은 고딕' 으로 지정 → MS Word / 한컴오피스
//     100% 열림 보장. Pretendard 는 서버 렌더링 (PDF) 에서만 사용.
//   - hint: 'eastAsia' 로 명시하여 한자·한글 영역에 확실히 매핑.
//   - combined 인라인 정답 제거 (마지막 answer-key 섹션만).
// v2 (Phase 0.5):
//   - 한글 fallback: styles.default.document.run.font 에 { name, hint: 'eastAsia' }
//     로 지정 → MS Word / 한컴오피스에서 Pretendard 없어도 시스템 한글 폰트 fallback.
//   - 이미지 원본 비율 유지 (loadImage 가 반환하는 width/height 활용).
//   - answerVariant 옵션 지원 (student / teacher / combined).

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

import { fitDimensions, loadImage } from './image-loader';
import type { LearningDocument, Section } from './schema';

export type AnswerVariant = 'student' | 'teacher' | 'combined';

export interface RenderDocxOptions {
  answerVariant?: AnswerVariant;
}

// Phase 0.6 폰트 정책 (DOCX 뷰어 = MS Word / 한컴오피스 / LibreOffice):
//   - '맑은 고딕' 은 Windows 기본 한글 폰트로 사실상 모든 Word/한컴 환경에서 열림.
//   - hint: 'eastAsia' 는 CJK 문자에 이 폰트를 명시 매핑 (docx OOXML 스펙).
//   - Pretendard 브랜드 폰트는 PDF 서버 렌더링에서만 사용 (뷰어 미설치 위험 회피).
const FONT_STACK = { name: '맑은 고딕', hint: 'eastAsia' } as const;

export async function renderDocx(
  doc: LearningDocument,
  options: RenderDocxOptions = {},
): Promise<Buffer> {
  const variant = options.answerVariant ?? 'combined';
  const sections = filterSections(doc.sections, variant);

  const nested = await Promise.all(
    sections.map((s) => sectionToDocxChildren(s, variant)),
  );
  const children = nested.flat();

  const variantBadge =
    variant === 'student'
      ? '학생용 (정답 제외)'
      : variant === 'teacher'
        ? '교사용 정답·해설'
        : '학생용 + 정답·해설';

  const document = new Document({
    creator: '우리학교 클립아트스튜디오',
    title: doc.meta.title,
    styles: {
      default: {
        document: {
          run: {
            font: FONT_STACK,
          },
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
                text: doc.meta.title,
                bold: true,
                color: '2D2F77',
                size: 28,
                font: FONT_STACK,
              }),
              new TextRun({
                text: `  [${variantBadge}]`,
                bold: true,
                color: '2D2F77',
                size: 20,
                font: FONT_STACK,
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `${doc.meta.grade}학년 · ${SUBJECT_LABEL[doc.meta.subject] ?? doc.meta.subject}${doc.meta.estimatedMinutes ? ` · 예상 ${doc.meta.estimatedMinutes}분` : ''} · AI 초안이며 교사 검토가 필요합니다.`,
                italics: true,
                color: '64748B',
                size: 18,
                font: FONT_STACK,
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

// Phase 0.7 재정의:
//   - student  : answer-key 제외 (인라인 정답 X)
//   - teacher  : 전체 유지 (인라인 정답 O, answer-key 도 유지)
//   - combined : 전체 유지 (인라인 정답 X, 마지막 answer-key + 페이지 브레이크)
function filterSections(sections: Section[], variant: AnswerVariant): Section[] {
  if (variant === 'student') return sections.filter((s) => s.kind !== 'answer-key');
  return sections;
}

type DocxChild = Paragraph | Table;

async function sectionToDocxChildren(
  section: Section,
  variant: AnswerVariant,
): Promise<DocxChild[]> {
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
          children: [
            new TextRun({
              text: section.text,
              bold: true,
              color: '2D2F77',
              font: FONT_STACK,
            }),
          ],
          spacing: { before: 240, after: 120 },
          keepNext: true, // 뒤 콘텐츠와 붙어 있도록.
        }),
      ];
    }

    case 'paragraph':
      return [
        new Paragraph({
          children: [new TextRun({ text: section.text, font: FONT_STACK })],
          spacing: { after: 100 },
        }),
      ];

    case 'callout':
      return [
        new Paragraph({
          children: [
            new TextRun({ text: section.text, italics: true, font: FONT_STACK }),
          ],
          spacing: { before: 100, after: 100 },
        }),
      ];

    case 'question': {
      const number = section.number ? `${section.number}. ` : '';
      const paragraphs: Paragraph[] = [
        new Paragraph({
          children: [
            new TextRun({
              text: `${number}${section.stem}`,
              bold: true,
              font: FONT_STACK,
            }),
          ],
          spacing: { before: 120, after: 60 },
          keepNext: true, // 문제와 선택지 붙어있게.
        }),
      ];
      (section.choices ?? []).forEach((c, i) => {
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: `${i + 1}) ${c}`, font: FONT_STACK })],
            spacing: { after: 40 },
            keepLines: true,
          }),
        );
      });
      if (section.hint) {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `💡 ${section.hint}`,
                italics: true,
                color: '64748B',
                font: FONT_STACK,
              }),
            ],
            spacing: { after: 100 },
          }),
        );
      }
      // Phase 0.7: teacher variant 만 인라인 정답 표시.
      if (variant === 'teacher' && section.answer) {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `정답: ${section.answer}`,
                bold: true,
                color: '059669',
                font: FONT_STACK,
              }),
            ],
            spacing: { after: 100 },
          }),
        );
      }
      return paragraphs;
    }

    case 'activity': {
      const paragraphs: Paragraph[] = [];
      if (section.title) {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: section.title,
                bold: true,
                color: '2D2F77',
                font: FONT_STACK,
              }),
            ],
            spacing: { before: 120, after: 60 },
            keepNext: true,
          }),
        );
      }
      section.steps.forEach((s, i) => {
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: `${i + 1}. ${s}`, font: FONT_STACK })],
            spacing: { after: 40 },
            keepLines: true,
          }),
        );
      });
      if (section.materials?.length) {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `준비물: ${section.materials.join(', ')}`,
                italics: true,
                font: FONT_STACK,
              }),
            ],
            spacing: { after: 60 },
          }),
        );
      }
      return paragraphs;
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
                      children: [
                        new TextRun({ text: h, bold: true, font: FONT_STACK }),
                      ],
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
                  children: [
                    new Paragraph({
                      children: [new TextRun({ text: c, font: FONT_STACK })],
                    }),
                  ],
                }),
            ),
          }),
        );
      }
      return [
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
        new Paragraph({ text: '', spacing: { after: 120 } }),
      ];
    }

    case 'image': {
      try {
        const img = await loadImage(section.assetRef);
        // A4 - margin 좌우 18mm = 174mm ≈ 620px 로 가정. widthPct 로 target 폭 결정.
        // 최대 80% 로 상한.
        const cappedPct = Math.min(section.widthPct ?? 60, 80);
        const targetWidthPx = Math.round(620 * (cappedPct / 100));
        const dims = fitDimensions(
          { width: img.width, height: img.height },
          targetWidthPx,
          // 이미지가 페이지 세로를 절반 이상 차지하지 않도록 max height 지정.
          800,
        );
        const imageType =
          img.mime === 'image/jpeg' ? 'jpg' : img.mime === 'image/webp' ? 'png' : 'png';
        const paragraphs: DocxChild[] = [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 60 },
            children: [
              new ImageRun({
                data: img.buffer,
                transformation: { width: dims.width, height: dims.height },
                type: imageType as 'png' | 'jpg',
              }),
            ],
            keepNext: Boolean(section.caption),
            keepLines: true,
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
                  font: FONT_STACK,
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
                font: FONT_STACK,
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 120 },
          }),
        ];
      }
    }

    case 'answer-key': {
      // Phase 0.7: combined 는 학생용 문제지와 정답·해설을 물리적으로 분리.
      const header = new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [
          new TextRun({
            text: '정답과 해설',
            bold: true,
            color: '2D2F77',
            font: FONT_STACK,
          }),
        ],
        spacing: { before: 240, after: 120 },
        keepNext: true,
        pageBreakBefore: variant === 'combined',
      });
      const items = section.entries.map(
        (e) =>
          new Paragraph({
            children: [
              new TextRun({ text: `${e.ref}. `, bold: true, font: FONT_STACK }),
              new TextRun({ text: e.answer, font: FONT_STACK }),
              ...(e.rationale
                ? [
                    new TextRun({
                      text: ` — ${e.rationale}`,
                      italics: true,
                      color: '64748B',
                      font: FONT_STACK,
                    }),
                  ]
                : []),
            ],
            spacing: { after: 60 },
            keepLines: true,
          }),
      );
      return [header, ...items];
    }

    case 'rubric': {
      const rows: TableRow[] = [
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: '평가 기준', bold: true, font: FONT_STACK }),
                  ],
                }),
              ],
            }),
            ...(section.criteria[0]?.levels ?? []).map(
              (_, i) =>
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({ text: `수준 ${i + 1}`, bold: true, font: FONT_STACK }),
                      ],
                    }),
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
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({ text: c.criterion, bold: true, font: FONT_STACK }),
                      ],
                    }),
                  ],
                }),
                ...c.levels.map(
                  (l) =>
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [new TextRun({ text: l, font: FONT_STACK })],
                        }),
                      ],
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
