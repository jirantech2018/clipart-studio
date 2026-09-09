// V2 orchestrator — 단일 호출 변형 (variant C).
//
// 원칙:
//   - subject/topic 코드 분기 없음. 프롬프트도 공통 하나.
//   - 실패해도 예외를 던지지 않고 { ok:false, reason } 반환 → caller (handler) 가 V1 폴백.
//   - normalize/itemId 부여는 기존 V1 orchestrator 의 함수 재사용.

import type { LearningDocument } from '@/services/learning-renderer/schema';
import type { GenerationContext } from '@/services/learning-generation/context-builder';

import { v2SystemPrompt, v2UserPromptSingleShot } from './prompts-v2';
import { normalizeLearningDocument } from './normalize';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const V2_MODEL = process.env.LEARNING_V2_MODEL || 'gpt-4o';

function baseUrl(): string {
  return process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
}
function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing');
  return key;
}

export interface V2Result {
  ok: true;
  document: LearningDocument;
  variant: 'v2C';
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface V2Failure {
  ok: false;
  reason: string;
  errorCode: 'AI_UPSTREAM' | 'AI_TIMEOUT' | 'PARSE_ERROR' | 'SCHEMA_ERROR';
}

export async function generateLearningDocumentV2(
  context: GenerationContext,
): Promise<V2Result | V2Failure> {
  const started = Date.now();
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
        model: V2_MODEL,
        temperature: 0.5,
        max_tokens: 3000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: v2SystemPrompt() },
          { role: 'user', content: v2UserPromptSingleShot(context) },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const name = (err as { name?: string }).name;
    return {
      ok: false,
      reason: name === 'AbortError' ? 'V2 AI 응답 timeout (60s)' : `V2 AI 호출 실패: ${(err as Error).message}`,
      errorCode: name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_UPSTREAM',
    };
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      reason: `V2 AI 응답 오류 ${res.status}: ${body.slice(0, 200)}`,
      errorCode: 'AI_UPSTREAM',
    };
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const raw = json.choices?.[0]?.message?.content ?? '';
  if (!raw) {
    return { ok: false, reason: 'V2 AI 응답이 비어 있음', errorCode: 'PARSE_ERROR' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'V2 AI 응답 JSON 파싱 실패', errorCode: 'PARSE_ERROR' };
  }

  let document: LearningDocument;
  try {
    document = normalizeLearningDocument(parsed, {
      grade: context.learner.grade as 1 | 2 | 3 | 4 | 5 | 6,
      subject: context.curriculum.subject,
      materialType: context.material.type,
      difficulty: context.request.difficulty as 'easy' | 'normal' | 'hard',
      topic: `${context.curriculum.unit} · ${context.curriculum.topic}`,
    });
  } catch (err) {
    return {
      ok: false,
      reason: `V2 결과 정규화 실패: ${(err as Error).message}`,
      errorCode: 'SCHEMA_ERROR',
    };
  }

  return {
    ok: true,
    document,
    variant: 'v2C',
    durationMs: Date.now() - started,
    inputTokens: json.usage?.prompt_tokens,
    outputTokens: json.usage?.completion_tokens,
  };
}
