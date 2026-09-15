// LearningDocument normalization shared between V1 and V2.
//
// Accepts raw AI JSON, produces a well-formed LearningDocument with itemIds assigned.
// No subject/topic branching here — pure structural normalization.

import type {
  Difficulty,
  Grade,
  LearningDocument,
  LearningDocumentMeta,
  MaterialType as SchemaMaterialType,
  Section,
  Subject as SchemaSubject,
} from '@/services/learning-renderer/schema';

export class LearningNormalizeError extends Error {
  code: 'SCHEMA_ERROR';
  constructor(message: string) {
    super(message);
    this.code = 'SCHEMA_ERROR';
    this.name = 'LearningNormalizeError';
  }
}

export interface NormalizeContext {
  grade: Grade;
  subject: string;
  materialType: string;
  difficulty: Difficulty;
  topic: string;
}

export function normalizeLearningDocument(
  raw: unknown,
  ctx: NormalizeContext,
): LearningDocument {
  if (!raw || typeof raw !== 'object') {
    throw new LearningNormalizeError('응답이 객체가 아닙니다');
  }
  const obj = raw as Record<string, unknown>;
  const metaRaw = obj.meta as Record<string, unknown> | undefined;
  const sectionsRaw = obj.sections;

  if (!Array.isArray(sectionsRaw) || sectionsRaw.length === 0) {
    throw new LearningNormalizeError('sections 배열이 비어 있습니다');
  }

  const meta: LearningDocumentMeta = {
    title:
      typeof metaRaw?.title === 'string' && metaRaw.title.trim().length > 0
        ? metaRaw.title.trim()
        : `${ctx.grade}학년 ${ctx.topic}`,
    grade: ctx.grade,
    subject: mapSubject(ctx.subject),
    materialType: mapMaterialType(ctx.materialType),
    difficulty: ctx.difficulty,
    estimatedMinutes:
      typeof metaRaw?.estimatedMinutes === 'number' ? metaRaw.estimatedMinutes : 20,
    topic: ctx.topic,
    teacherReviewRequired: true,
    generatedAt: new Date().toISOString(),
  };

  const sections: Section[] = [];
  for (const item of sectionsRaw) {
    const sec = normalizeSection(item);
    if (sec) sections.push(sec);
  }
  if (sections.length === 0) {
    throw new LearningNormalizeError('유효한 section 이 하나도 없습니다');
  }

  assignItemIds(sections);
  return { meta, sections };
}

function mapSubject(code: string): SchemaSubject {
  return code as SchemaSubject;
}

function mapMaterialType(code: string): SchemaMaterialType {
  if (code === 'individual_activity') return 'individual_worksheet';
  return code as SchemaMaterialType;
}

// eslint-disable-next-line complexity
function normalizeSection(raw: unknown): Section | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const kind = s.kind;
  const itemId = typeof s.itemId === 'string' ? s.itemId : undefined;

  switch (kind) {
    case 'heading': {
      const level = s.level;
      const text = s.text;
      if (typeof text !== 'string' || !text.trim()) return null;
      const lv = level === 1 || level === 2 || level === 3 ? level : 1;
      return { kind: 'heading', level: lv, text: text.trim() };
    }
    case 'paragraph': {
      const text = s.text;
      if (typeof text !== 'string' || !text.trim()) return null;
      return { kind: 'paragraph', text: text.trim() };
    }
    case 'callout': {
      const text = s.text;
      const tone = s.tone;
      if (typeof text !== 'string' || !text.trim()) return null;
      const t = tone === 'warn' || tone === 'tip' ? tone : 'info';
      return { kind: 'callout', tone: t, text: text.trim() };
    }
    case 'question': {
      const stem = s.stem;
      if (typeof stem !== 'string' || !stem.trim()) return null;
      const qtype =
        s.qtype === 'ox' ||
        s.qtype === 'mc' ||
        s.qtype === 'short' ||
        s.qtype === 'blank' ||
        s.qtype === 'essay'
          ? (s.qtype as 'ox' | 'mc' | 'short' | 'blank' | 'essay')
          : 'short';
      const choices = Array.isArray(s.choices)
        ? (s.choices.filter((c) => typeof c === 'string') as string[])
        : undefined;
      const answer = typeof s.answer === 'string' ? s.answer : undefined;
      // 빈 문자열 hint 는 undefined 로 정규화 (reviewer 가 "hint 필요 없는데 존재" 로 오판정하지 않도록).
      const hintRaw = typeof s.hint === 'string' ? s.hint.trim() : '';
      const hint = hintRaw ? hintRaw : undefined;
      const number = typeof s.number === 'number' ? s.number : undefined;
      return {
        kind: 'question',
        itemId,
        qtype,
        stem: stem.trim(),
        choices,
        answer,
        hint,
        number,
      };
    }
    case 'activity': {
      const steps = Array.isArray(s.steps)
        ? (s.steps.filter((x) => typeof x === 'string') as string[])
        : [];
      if (steps.length === 0) return null;
      const title = typeof s.title === 'string' ? s.title : undefined;
      const materials = Array.isArray(s.materials)
        ? (s.materials.filter((x) => typeof x === 'string') as string[])
        : undefined;
      const estimatedMinutes =
        typeof s.estimatedMinutes === 'number' ? s.estimatedMinutes : undefined;
      return { kind: 'activity', itemId, steps, title, materials, estimatedMinutes };
    }
    case 'table': {
      const rows = Array.isArray(s.rows)
        ? s.rows.map((row) =>
            Array.isArray(row)
              ? (row.filter((c) => typeof c === 'string') as string[])
              : [],
          )
        : [];
      if (rows.length === 0) return null;
      const headers = Array.isArray(s.headers)
        ? (s.headers.filter((c) => typeof c === 'string') as string[])
        : undefined;
      const caption = typeof s.caption === 'string' ? s.caption : undefined;
      return { kind: 'table', itemId, rows, headers, caption };
    }
    case 'answer-key': {
      const entriesRaw = s.entries;
      if (!Array.isArray(entriesRaw)) return null;
      const entries = entriesRaw
        .filter((e): e is Record<string, unknown> => e !== null && typeof e === 'object')
        .map((e) => ({
          ref: typeof e.ref === 'string' ? e.ref : '',
          answer: typeof e.answer === 'string' ? e.answer : '',
          rationale: typeof e.rationale === 'string' ? e.rationale : undefined,
        }))
        .filter((e) => e.ref && e.answer);
      if (entries.length === 0) return null;
      return { kind: 'answer-key', entries };
    }
    case 'worksheet-table': {
      const headers = Array.isArray(s.headers)
        ? (s.headers.filter((x) => typeof x === 'string') as string[])
        : [];
      if (headers.length === 0) return null;
      const rowCount =
        typeof s.rowCount === 'number' && s.rowCount > 0
          ? Math.min(12, Math.round(s.rowCount))
          : 3;
      const caption = typeof s.caption === 'string' ? s.caption : undefined;
      return { kind: 'worksheet-table', itemId, headers, rowCount, caption };
    }
    case 'blank-space': {
      const heightRatio =
        typeof s.heightRatio === 'number'
          ? Math.max(0.1, Math.min(0.6, s.heightRatio))
          : 0.3;
      const prompt = typeof s.prompt === 'string' ? s.prompt : undefined;
      return { kind: 'blank-space', itemId, heightRatio, prompt };
    }
    // Stage 4 활동 블록.
    case 'student-header': {
      const fields = Array.isArray(s.fields)
        ? (s.fields.filter((x) => typeof x === 'string') as string[])
        : [];
      const finalFields = fields.length > 0 ? fields : ['이름', '날짜'];
      return { kind: 'student-header', fields: finalFields };
    }
    case 'picture-choice': {
      const stem = typeof s.stem === 'string' ? s.stem.trim() : '';
      if (!stem) return null;
      const choicesRaw = Array.isArray(s.choices) ? s.choices : [];
      const choices = choicesRaw
        .filter((c): c is Record<string, unknown> => c !== null && typeof c === 'object')
        .map((c) => ({
          label: typeof c.label === 'string' ? c.label : '',
          imageAssetRef:
            typeof c.imageAssetRef === 'string' ? c.imageAssetRef : undefined,
          imageCaption:
            typeof c.imageCaption === 'string' ? c.imageCaption : undefined,
        }))
        .filter((c) => c.label || c.imageAssetRef);
      if (choices.length < 2) return null;
      const answer = typeof s.answer === 'string' ? s.answer : String(s.answer ?? '');
      const hintRaw = typeof s.hint === 'string' ? s.hint.trim() : '';
      const teacherNote =
        typeof s.teacherNote === 'string' ? s.teacherNote : undefined;
      const number = typeof s.number === 'number' ? s.number : undefined;
      return {
        kind: 'picture-choice',
        itemId,
        number,
        stem,
        choices,
        answer,
        hint: hintRaw || undefined,
        teacherNote,
      };
    }
    case 'matching': {
      const stem = typeof s.stem === 'string' ? s.stem.trim() : '';
      if (!stem) return null;
      const norm = (arr: unknown) =>
        Array.isArray(arr)
          ? arr
              .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
              .map((x, i) => ({
                id: typeof x.id === 'string' && x.id ? x.id : `x_${i + 1}`,
                text: typeof x.text === 'string' ? x.text : undefined,
                imageAssetRef:
                  typeof x.imageAssetRef === 'string' ? x.imageAssetRef : undefined,
              }))
              .filter((x) => x.text || x.imageAssetRef)
          : [];
      const leftColumn = norm(s.leftColumn);
      const rightColumn = norm(s.rightColumn);
      if (leftColumn.length === 0 || rightColumn.length === 0) return null;
      const pairsRaw = Array.isArray(s.correctPairs) ? s.correctPairs : [];
      const correctPairs = pairsRaw
        .filter((p): p is unknown[] => Array.isArray(p) && p.length >= 2)
        .map((p) => [String(p[0]), String(p[1])] as [string, string]);
      const teacherNote =
        typeof s.teacherNote === 'string' ? s.teacherNote : undefined;
      const number = typeof s.number === 'number' ? s.number : undefined;
      return {
        kind: 'matching',
        itemId,
        number,
        stem,
        leftColumn,
        rightColumn,
        correctPairs,
        teacherNote,
      };
    }
    case 'classification': {
      const stem = typeof s.stem === 'string' ? s.stem.trim() : '';
      if (!stem) return null;
      const categories = Array.isArray(s.categories)
        ? (s.categories.filter((x) => typeof x === 'string') as string[])
        : [];
      if (categories.length < 2) return null;
      const itemsRaw = Array.isArray(s.items) ? s.items : [];
      const items = itemsRaw
        .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
        .map((x, i) => ({
          id: typeof x.id === 'string' && x.id ? x.id : `it_${i + 1}`,
          text: typeof x.text === 'string' ? x.text : undefined,
          imageAssetRef:
            typeof x.imageAssetRef === 'string' ? x.imageAssetRef : undefined,
          correctCategory:
            typeof x.correctCategory === 'string' ? x.correctCategory : categories[0]!,
        }))
        .filter((x) => x.text || x.imageAssetRef);
      if (items.length === 0) return null;
      const teacherNote =
        typeof s.teacherNote === 'string' ? s.teacherNote : undefined;
      const number = typeof s.number === 'number' ? s.number : undefined;
      return { kind: 'classification', itemId, number, stem, categories, items, teacherNote };
    }
    case 'fill-blank': {
      const stem = typeof s.stem === 'string' ? s.stem.trim() : '';
      if (!stem) return null;
      const sentencesRaw = Array.isArray(s.sentences) ? s.sentences : [];
      const sentences = sentencesRaw
        .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
        .map((x) => ({
          template: typeof x.template === 'string' ? x.template : '',
          answers: Array.isArray(x.answers)
            ? (x.answers.filter((a) => typeof a === 'string') as string[])
            : [],
        }))
        .filter((x) => x.template);
      if (sentences.length === 0) return null;
      const teacherNote =
        typeof s.teacherNote === 'string' ? s.teacherNote : undefined;
      const number = typeof s.number === 'number' ? s.number : undefined;
      return { kind: 'fill-blank', itemId, number, stem, sentences, teacherNote };
    }
    case 'writing-grid': {
      const stem = typeof s.stem === 'string' ? s.stem.trim() : '';
      if (!stem) return null;
      const gridType =
        s.gridType === 'lined' || s.gridType === 'manuscript' ? s.gridType : 'square';
      const cellsPerRow =
        typeof s.cellsPerRow === 'number' ? Math.max(1, Math.min(20, Math.round(s.cellsPerRow))) : 10;
      const rowCount =
        typeof s.rowCount === 'number' ? Math.max(1, Math.min(20, Math.round(s.rowCount))) : 3;
      const tracingText =
        typeof s.tracingText === 'string' ? s.tracingText : undefined;
      const teacherNote =
        typeof s.teacherNote === 'string' ? s.teacherNote : undefined;
      const number = typeof s.number === 'number' ? s.number : undefined;
      return {
        kind: 'writing-grid',
        itemId,
        number,
        stem,
        gridType,
        cellsPerRow,
        rowCount,
        tracingText,
        teacherNote,
      };
    }
    case 'guided-practice': {
      const stem = typeof s.stem === 'string' ? s.stem.trim() : '';
      if (!stem) return null;
      const we = (s.workedExample as Record<string, unknown> | undefined) ?? {};
      const workedExample = {
        problem: typeof we.problem === 'string' ? we.problem : '',
        solutionSteps: Array.isArray(we.solutionSteps)
          ? (we.solutionSteps.filter((x) => typeof x === 'string') as string[])
          : [],
        imageAssetRef:
          typeof we.imageAssetRef === 'string' ? we.imageAssetRef : undefined,
      };
      if (!workedExample.problem) return null;
      const practiceRaw = Array.isArray(s.practiceProblems) ? s.practiceProblems : [];
      const practiceProblems = practiceRaw
        .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
        .map((x) => ({
          problem: typeof x.problem === 'string' ? x.problem : '',
          answer: typeof x.answer === 'string' ? x.answer : undefined,
          imageAssetRef:
            typeof x.imageAssetRef === 'string' ? x.imageAssetRef : undefined,
        }))
        .filter((x) => x.problem);
      const teacherNote =
        typeof s.teacherNote === 'string' ? s.teacherNote : undefined;
      const number = typeof s.number === 'number' ? s.number : undefined;
      return {
        kind: 'guided-practice',
        itemId,
        number,
        stem,
        workedExample,
        practiceProblems,
        teacherNote,
      };
    }
    case 'independent-practice': {
      const stem = typeof s.stem === 'string' ? s.stem.trim() : '';
      if (!stem) return null;
      const problemsRaw = Array.isArray(s.problems) ? s.problems : [];
      const problems = problemsRaw
        .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
        .map((x) => ({
          problem: typeof x.problem === 'string' ? x.problem : '',
          answer: typeof x.answer === 'string' ? x.answer : undefined,
          imageAssetRef:
            typeof x.imageAssetRef === 'string' ? x.imageAssetRef : undefined,
          answerSpaceLines:
            typeof x.answerSpaceLines === 'number' ? Math.max(0, Math.min(10, Math.round(x.answerSpaceLines))) : undefined,
        }))
        .filter((x) => x.problem);
      if (problems.length === 0) return null;
      const teacherNote =
        typeof s.teacherNote === 'string' ? s.teacherNote : undefined;
      const number = typeof s.number === 'number' ? s.number : undefined;
      return {
        kind: 'independent-practice',
        itemId,
        number,
        stem,
        problems,
        teacherNote,
      };
    }
    case 'sequence': {
      const stem = typeof s.stem === 'string' ? s.stem.trim() : '';
      if (!stem) return null;
      const itemsRaw = Array.isArray(s.items) ? s.items : [];
      const items = itemsRaw
        .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
        .map((x, i) => ({
          id: typeof x.id === 'string' && x.id ? x.id : `sq_${i + 1}`,
          text: typeof x.text === 'string' ? x.text : undefined,
          imageAssetRef:
            typeof x.imageAssetRef === 'string' ? x.imageAssetRef : undefined,
        }))
        .filter((x) => x.text || x.imageAssetRef);
      if (items.length < 2) return null;
      const correctOrder = Array.isArray(s.correctOrder)
        ? (s.correctOrder.filter((x) => typeof x === 'string') as string[])
        : items.map((x) => x.id);
      const teacherNote =
        typeof s.teacherNote === 'string' ? s.teacherNote : undefined;
      const number = typeof s.number === 'number' ? s.number : undefined;
      return { kind: 'sequence', itemId, number, stem, items, correctOrder, teacherNote };
    }
    case 'observation': {
      const stem = typeof s.stem === 'string' ? s.stem.trim() : '';
      if (!stem) return null;
      const imageAssetRef = typeof s.imageAssetRef === 'string' ? s.imageAssetRef : '';
      if (!imageAssetRef) return null;
      const imageCaption =
        typeof s.imageCaption === 'string' ? s.imageCaption : undefined;
      const promptsRaw = Array.isArray(s.observationPrompts) ? s.observationPrompts : [];
      const observationPrompts = promptsRaw
        .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
        .map((x) => ({
          prompt: typeof x.prompt === 'string' ? x.prompt : '',
          answer: typeof x.answer === 'string' ? x.answer : undefined,
        }))
        .filter((x) => x.prompt);
      if (observationPrompts.length === 0) return null;
      const teacherNote =
        typeof s.teacherNote === 'string' ? s.teacherNote : undefined;
      const number = typeof s.number === 'number' ? s.number : undefined;
      return {
        kind: 'observation',
        itemId,
        number,
        stem,
        imageAssetRef,
        imageCaption,
        observationPrompts,
        teacherNote,
      };
    }
    case 'open-response': {
      const stem = typeof s.stem === 'string' ? s.stem.trim() : '';
      if (!stem) return null;
      const responseMode =
        s.responseMode === 'box' || s.responseMode === 'both' ? s.responseMode : 'lines';
      const lineCount =
        typeof s.lineCount === 'number' ? Math.max(1, Math.min(20, Math.round(s.lineCount))) : 5;
      const boxHeightRatio =
        typeof s.boxHeightRatio === 'number'
          ? Math.max(0.1, Math.min(0.6, s.boxHeightRatio))
          : 0.3;
      const teacherNote =
        typeof s.teacherNote === 'string' ? s.teacherNote : undefined;
      const number = typeof s.number === 'number' ? s.number : undefined;
      return {
        kind: 'open-response',
        itemId,
        number,
        stem,
        responseMode,
        lineCount,
        boxHeightRatio,
        teacherNote,
      };
    }
    case 'page-break': {
      const reason = typeof s.reason === 'string' ? s.reason : undefined;
      return { kind: 'page-break', reason };
    }
    default:
      return null;
  }
}

const ITEM_KIND_PREFIX: Partial<Record<Section['kind'], string>> = {
  question: 'q',
  activity: 'act',
  table: 'tbl',
  'worksheet-table': 'ws',
  'blank-space': 'bs',
  // Stage 4 활동 블록.
  'picture-choice': 'pc',
  matching: 'mt',
  classification: 'cl',
  'fill-blank': 'fb',
  'writing-grid': 'wg',
  'guided-practice': 'gp',
  'independent-practice': 'ip',
  sequence: 'sq',
  observation: 'ob',
  'open-response': 'or',
};

function assignItemIds(sections: Section[]): void {
  const counters = new Map<string, number>();
  const used = new Set<string>();

  for (const sec of sections) {
    const prefix = ITEM_KIND_PREFIX[sec.kind];
    if (!prefix) continue;

    const existing = (sec as { itemId?: string }).itemId;
    if (typeof existing === 'string' && existing.trim() && !used.has(existing)) {
      used.add(existing);
      continue;
    }

    let n = (counters.get(prefix) ?? 0) + 1;
    let id = `${prefix}_${String(n).padStart(2, '0')}`;
    while (used.has(id)) {
      n += 1;
      id = `${prefix}_${String(n).padStart(2, '0')}`;
    }
    counters.set(prefix, n);
    used.add(id);
    (sec as { itemId?: string }).itemId = id;
  }
}
