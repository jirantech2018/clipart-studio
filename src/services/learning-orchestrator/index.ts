// Learning-Helper AI orchestrator.
// GPT-4o structured output → LearningDocument JSON.
// M1: 객관식·개별활동지 2종만 실전 검증. 나머지 3종은 프롬프트 있지만 M2 에서 폴리시.

import type {
  Difficulty,
  Grade,
  LearningDocument,
  LearningDocumentMeta,
  MaterialType as SchemaMaterialType,
  Section,
  Subject as SchemaSubject,
} from '@/services/learning-renderer/schema';
import type { MaterialTypeCode } from '@/features/learning-helper/domain/material-types';
import type { SubjectCode } from '@/features/learning-helper/domain/subjects';

import {
  recommendationSystemPrompt,
  recommendationUserPrompt,
  systemPrompt,
  userPrompt,
  type OrchestratorInput,
} from './prompts';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
// 학습 자료 생성은 스키마 준수가 중요 → gpt-4o (mini 아님)
const DOCUMENT_MODEL = 'gpt-4o';
// 3개 추천은 저비용
const RECOMMENDATION_MODEL = 'gpt-4o-mini';

function baseUrl(): string {
  return process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
}

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing');
  return key;
}

// ============================================================
// LearningDocument 생성
// ============================================================
export interface GenerateResult {
  document: LearningDocument;
  rawUsage?: { promptTokens: number; completionTokens: number };
}

export class LearningOrchestratorError extends Error {
  code: 'AI_UPSTREAM' | 'AI_TIMEOUT' | 'PARSE_ERROR' | 'SCHEMA_ERROR';
  constructor(code: LearningOrchestratorError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'LearningOrchestratorError';
  }
}

export async function generateLearningDocument(
  input: OrchestratorInput,
): Promise<GenerateResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DOCUMENT_MODEL,
        temperature: 0.5,
        max_tokens: 3000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt(input) },
          { role: 'user', content: userPrompt(input) },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      throw new LearningOrchestratorError('AI_TIMEOUT', 'AI 응답이 60초 안에 오지 않았습니다');
    }
    throw new LearningOrchestratorError(
      'AI_UPSTREAM',
      `AI 호출 실패: ${(err as Error).message}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new LearningOrchestratorError(
      'AI_UPSTREAM',
      `AI 응답 오류 ${res.status}: ${body.slice(0, 200)}`,
    );
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const raw = json.choices?.[0]?.message?.content ?? '';
  if (!raw) {
    throw new LearningOrchestratorError('PARSE_ERROR', 'AI 응답이 비어 있습니다');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LearningOrchestratorError('PARSE_ERROR', 'AI 응답 JSON 파싱 실패');
  }

  const document = validateAndNormalize(parsed, input);
  return {
    document,
    rawUsage: json.usage
      ? {
          promptTokens: json.usage.prompt_tokens ?? 0,
          completionTokens: json.usage.completion_tokens ?? 0,
        }
      : undefined,
  };
}

// ============================================================
// 검증 & 정규화 — AI 응답을 LearningDocument 로 안전히 강제
// ============================================================
function validateAndNormalize(
  raw: unknown,
  input: OrchestratorInput,
): LearningDocument {
  if (!raw || typeof raw !== 'object') {
    throw new LearningOrchestratorError('SCHEMA_ERROR', 'AI 응답이 객체가 아닙니다');
  }
  const obj = raw as Record<string, unknown>;
  const metaRaw = obj.meta as Record<string, unknown> | undefined;
  const sectionsRaw = obj.sections;

  if (!Array.isArray(sectionsRaw) || sectionsRaw.length === 0) {
    throw new LearningOrchestratorError('SCHEMA_ERROR', 'sections 배열이 비어 있습니다');
  }

  const meta: LearningDocumentMeta = {
    title:
      typeof metaRaw?.title === 'string' && metaRaw.title.trim().length > 0
        ? metaRaw.title.trim()
        : `${input.grade}학년 ${input.topic}`,
    grade: input.grade as Grade,
    subject: mapSubject(input.subject),
    materialType: mapMaterialType(input.materialType),
    difficulty: (input.difficulty ?? 'normal') as Difficulty,
    estimatedMinutes:
      typeof metaRaw?.estimatedMinutes === 'number' ? metaRaw.estimatedMinutes : 20,
    topic: `${input.unit} · ${input.topic}`,
    teacherReviewRequired: true,
    generatedAt: new Date().toISOString(),
  };

  const sections: Section[] = [];
  for (const item of sectionsRaw) {
    const sec = normalizeSection(item);
    if (sec) sections.push(sec);
  }
  if (sections.length === 0) {
    throw new LearningOrchestratorError(
      'SCHEMA_ERROR',
      '유효한 section 이 하나도 없습니다',
    );
  }

  return { meta, sections };
}

function mapSubject(code: SubjectCode): SchemaSubject {
  // M1 은 KOR / MATH 만. 두 코드는 스키마와 동일.
  return code as SchemaSubject;
}

function mapMaterialType(code: MaterialTypeCode): SchemaMaterialType {
  // domain code → schema code 매핑. individual_activity → individual_worksheet
  // 그 외는 동일 이름.
  if (code === 'individual_activity') return 'individual_worksheet';
  return code as SchemaMaterialType;
}

// eslint-disable-next-line complexity
function normalizeSection(raw: unknown): Section | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const kind = s.kind;

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
      return { kind: 'activity', steps, title, materials, estimatedMinutes };
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
      return { kind: 'table', rows, headers, caption };
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
      return { kind: 'worksheet-table', headers, rowCount, caption };
    }
    case 'blank-space': {
      const heightRatio =
        typeof s.heightRatio === 'number'
          ? Math.max(0.1, Math.min(0.6, s.heightRatio))
          : 0.3;
      const prompt = typeof s.prompt === 'string' ? s.prompt : undefined;
      return { kind: 'blank-space', heightRatio, prompt };
    }
    default:
      // image / rubric / slide-break 는 M1 에서 사용 안 함, 나머지는 무시
      return null;
  }
}

// ============================================================
// 3개 추천 (별도 함수)
// ============================================================
export interface Recommendation {
  type: 'basic' | 'realworld' | 'inquiry';
  unit: string;
  topic: string;
  reason: string;
}

export async function generateRecommendations(
  grade: Grade,
  subject: SubjectCode,
  materialType: MaterialTypeCode,
  hintTopics: Array<{ unit: string; topic: string }>,
): Promise<Recommendation[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: RECOMMENDATION_MODEL,
        temperature: 0.7,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: recommendationSystemPrompt() },
          {
            role: 'user',
            content: recommendationUserPrompt(grade, subject, materialType, hintTopics),
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      throw new LearningOrchestratorError('AI_TIMEOUT', '추천 응답이 20초 안에 오지 않았습니다');
    }
    throw new LearningOrchestratorError(
      'AI_UPSTREAM',
      `추천 호출 실패: ${(err as Error).message}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new LearningOrchestratorError('AI_UPSTREAM', `추천 응답 오류 ${res.status}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = json.choices?.[0]?.message?.content ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LearningOrchestratorError('PARSE_ERROR', '추천 JSON 파싱 실패');
  }
  const arr = (parsed as { recommendations?: unknown[] })?.recommendations;
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new LearningOrchestratorError('SCHEMA_ERROR', '추천 배열이 비어 있습니다');
  }

  const out: Recommendation[] = [];
  for (const r of arr) {
    if (!r || typeof r !== 'object') continue;
    const rec = r as Record<string, unknown>;
    const type =
      rec.type === 'basic' || rec.type === 'realworld' || rec.type === 'inquiry'
        ? rec.type
        : 'basic';
    if (
      typeof rec.unit !== 'string' ||
      typeof rec.topic !== 'string' ||
      typeof rec.reason !== 'string'
    ) {
      continue;
    }
    out.push({
      type,
      unit: rec.unit.trim(),
      topic: rec.topic.trim(),
      reason: rec.reason.trim(),
    });
    if (out.length >= 3) break;
  }
  if (out.length === 0) {
    throw new LearningOrchestratorError(
      'SCHEMA_ERROR',
      '유효한 추천이 하나도 없습니다',
    );
  }
  return out;
}
