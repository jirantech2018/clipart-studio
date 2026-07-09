// Design Ref: §8.1 gpt-4o-mini auto-tagging.
// Uses OpenAI Chat Completions with response_format=json_object.
// Reuses OPENAI_API_KEY / OPENAI_BASE_URL from the image adapter.

import { TaggingError } from './adapter';
import { SCHOOL_CATEGORIES, pickValidCategories } from './categories';

import type { TaggingAdapter, TaggingInput, TaggingResult } from './adapter';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const MODEL = 'gpt-4o-mini';
const MAX_TAGS = 7;
const MIN_TAGS = 3;

function baseUrl() {
  return process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
}

function apiKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new TaggingError('OPENAI_API_KEY missing', false);
  return key;
}

function buildSystemPrompt(): string {
  const categoryList = SCHOOL_CATEGORIES.map((c) => `"${c}"`).join(', ');
  return [
    'You are a Korean image-tagging assistant for a school-focused clipart service.',
    'Given a user prompt describing an image to be generated, produce:',
    `- "tags": ${MIN_TAGS} to ${MAX_TAGS} concise Korean tags (nouns or short noun phrases). No English, no punctuation, no duplicates.`,
    `- "categories": 1 or 2 items chosen ONLY from this fixed list: [${categoryList}]. Prefer the most specific fit. Use "기타" only when the prompt has no school relevance.`,
    'Return valid JSON with exactly those two keys.',
  ].join('\n');
}

function buildUserPrompt(input: TaggingInput): string {
  const parts = [`프롬프트: ${input.prompt}`];
  if (input.schoolContext) parts.push(`학교 스타일 힌트: ${input.schoolContext}`);
  return parts.join('\n');
}

function sanitizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().replace(/^#/, '');
    if (!trimmed) continue;
    if (trimmed.length > 30) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export const openaiTaggingAdapter: TaggingAdapter = {
  provider: MODEL,
  async tag(input: TaggingInput): Promise<TaggingResult> {
    const res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: 'json_object' },
        temperature: 0.2,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: buildUserPrompt(input) },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new TaggingError(
        `Tagging call failed: ${res.status} ${text.slice(0, 300)}`,
        res.status >= 500 || res.status === 429,
      );
    }

    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new TaggingError('Empty tagging response', false);

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new TaggingError('Tagging returned non-JSON content', false);
    }

    const obj = parsed as { tags?: unknown; categories?: unknown };
    const tags = sanitizeTags(obj.tags);
    const categories = pickValidCategories(obj.categories, 2);

    // Guarantee at least one category so downstream filters work.
    if (categories.length === 0) categories.push('기타');

    return { tags, categories };
  },
};
