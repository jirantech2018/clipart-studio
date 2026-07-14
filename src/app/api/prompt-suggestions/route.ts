// 현재 프롬프트에 어울리는 변형 힌트 5개를 gpt-4o-mini 에게 즉석 추천받는다.
// 이미지 생성 파이프라인과는 완전히 분리된 저비용 호출 (짧은 텍스트 in / JSON out).

export const runtime = 'nodejs';
export const maxDuration = 15;

import { apiError, apiOk } from '@/lib/api-error';
import { createSupabaseServerClient } from '@/services/supabase/server';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const MODEL = 'gpt-4o-mini';
const FALLBACK_SUGGESTIONS = ['다른 포즈', '다른 표정', '겨울옷', '뛰는 모습', '계절 버전'];

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing');
  return key;
}

function baseUrl(): string {
  return process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
}

function systemPrompt(): string {
  return [
    'You are a Korean prompt-remix assistant for a school-focused AI clipart service.',
    'Given the user\'s current prompt, propose 5 short Korean variation hints that would produce',
    'meaningfully different but still relevant images (e.g. different pose, expression, season,',
    'outfit, angle, mood, or activity).',
    'Rules for each hint:',
    '- Korean only, 2 to 8 characters, noun phrases (no verbs, no punctuation)',
    '- No duplicates, no repeating words already in the original prompt',
    '- Return valid JSON: { "suggestions": ["힌트1", "힌트2", "힌트3", "힌트4", "힌트5"] }',
  ].join('\n');
}

function sanitize(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().replace(/^#/, '');
    if (!trimmed) continue;
    if (trimmed.length > 20) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= 5) break;
  }
  return out;
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  let body: { prompt?: unknown };
  try {
    body = (await request.json()) as { prompt?: unknown };
  } catch {
    return apiError('VALIDATION_ERROR', 'JSON 형식이 아닙니다');
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';

  // 프롬프트가 너무 짧으면 굳이 LLM 호출하지 않고 기본값을 돌려준다.
  if (prompt.length < 2) {
    return apiOk({ suggestions: FALLBACK_SUGGESTIONS, source: 'fallback' as const });
  }

  try {
    const res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.9,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'user', content: `원본 프롬프트: ${prompt}` },
        ],
      }),
    });

    if (!res.ok) {
      console.error('[prompt-suggestions] upstream', res.status);
      return apiOk({ suggestions: FALLBACK_SUGGESTIONS, source: 'fallback' as const });
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = json.choices?.[0]?.message?.content ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return apiOk({ suggestions: FALLBACK_SUGGESTIONS, source: 'fallback' as const });
    }
    const suggestions = sanitize(
      (parsed as { suggestions?: unknown })?.suggestions,
    );
    if (suggestions.length < 3) {
      return apiOk({ suggestions: FALLBACK_SUGGESTIONS, source: 'fallback' as const });
    }
    return apiOk({ suggestions, source: 'ai' as const });
  } catch (err) {
    console.error('[prompt-suggestions] error', err);
    return apiOk({ suggestions: FALLBACK_SUGGESTIONS, source: 'fallback' as const });
  }
}
