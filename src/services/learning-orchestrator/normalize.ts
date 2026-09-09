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
      const hint = typeof s.hint === 'string' ? s.hint : undefined;
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
