// 사용자 프롬프트에 어느 Knowledge 가 적용될지 결정한다.
//
// 두 단계:
//   1) Trigger substring 매칭 (비용 0). 사용자 프롬프트 텍스트 안에 각 Knowledge 의
//      trigger 중 하나라도 substring 으로 등장하면 후보로 채택. 매칭된 trigger 수를
//      raw score 로 쓴다.
//   2) 후보가 있으면 gpt-4o-mini 로 재정렬. name + triggers 만 프롬프트에 넣어 관련성
//      점수(0~1) 를 매기게 한다. description 은 프롬프트에 넣지 않음 (토큰 낭비).
//      LLM 호출 실패시 raw score 로만 정렬.
//
// 반환: priority ASC, 다음으로 score DESC 로 정렬된 매칭 결과.

import type { Knowledge } from '@/types/domain';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const CLASSIFIER_MODEL = 'gpt-4o-mini';

function baseUrl(): string {
  return process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
}
function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing');
  return key;
}

export interface KnowledgeMatch {
  knowledge: Knowledge;
  matchedTriggers: string[];
  triggerScore: number;
  llmScore: number | null;
  reason: string;
}

interface MatchOptions {
  /** Only pass at most this many candidates to the LLM to bound cost. */
  maxCandidatesForLLM?: number;
  /** Drop candidates whose LLM score is below this after rerank. Default 0.35. */
  minLLMScore?: number;
  /** Optional cap on returned matches after ranking. Default 10. */
  maxMatches?: number;
}

/**
 * Stage 1: naive trigger-substring matcher. Case-insensitive.
 */
function triggerMatch(prompt: string, knowledge: Knowledge[]): KnowledgeMatch[] {
  const lowered = prompt.toLowerCase();
  const out: KnowledgeMatch[] = [];
  for (const k of knowledge) {
    if (!k.enabled) continue;
    const hits: string[] = [];
    for (const t of k.triggers) {
      const needle = t.trim().toLowerCase();
      if (!needle) continue;
      if (lowered.includes(needle)) hits.push(t);
    }
    if (hits.length === 0) continue;
    out.push({
      knowledge: k,
      matchedTriggers: hits,
      triggerScore: hits.length,
      llmScore: null,
      reason: `트리거 매칭: ${hits.join(', ')}`,
    });
  }
  return out;
}

interface LlmScore {
  id: string;
  score: number;
  reason: string;
}

async function llmRerank(
  prompt: string,
  candidates: KnowledgeMatch[],
): Promise<LlmScore[] | null> {
  const list = candidates
    .map(
      (c) =>
        `${c.knowledge.id}: name="${c.knowledge.name}", triggers=[${c.knowledge.triggers.join(', ')}]`,
    )
    .join('\n');

  const system = [
    'You are a Korean-context relevance ranker for an image-generation knowledge base.',
    'Given a user prompt and a list of candidate Knowledge cards (id + name + triggers),',
    'score how relevant each card is to the prompt from 0.0 to 1.0 and give a very short',
    'Korean reason (under 30 chars).',
    'Return valid JSON: { "scores": [ {"id": "<uuid>", "score": 0.0, "reason": "..."} ] }',
    'Include every candidate id exactly once. Do NOT invent ids not in the list.',
  ].join('\n');

  const user = `사용자 프롬프트: ${prompt}\n\n후보 Knowledge:\n${list}`;

  try {
    const res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CLASSIFIER_MODEL,
        temperature: 0.1,
        max_tokens: 800,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) {
      console.error('[knowledge/classifier] upstream', res.status);
      return null;
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = json.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw) as { scores?: unknown };
    if (!Array.isArray(parsed.scores)) return null;

    const out: LlmScore[] = [];
    for (const item of parsed.scores) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const id = typeof rec.id === 'string' ? rec.id : null;
      const rawScore = typeof rec.score === 'number' ? rec.score : Number(rec.score);
      const reason = typeof rec.reason === 'string' ? rec.reason : '';
      if (!id || Number.isNaN(rawScore)) continue;
      const score = Math.max(0, Math.min(1, rawScore));
      out.push({ id, score, reason: reason.slice(0, 60) });
    }
    return out;
  } catch (err) {
    console.error('[knowledge/classifier] llm parse/network', err);
    return null;
  }
}

/**
 * Full pipeline: trigger match → optional LLM rerank → final ordering.
 */
export async function classifyKnowledge(
  prompt: string,
  knowledge: Knowledge[],
  options: MatchOptions = {},
): Promise<KnowledgeMatch[]> {
  const maxCandidatesForLLM = options.maxCandidatesForLLM ?? 12;
  const minLLMScore = options.minLLMScore ?? 0.35;
  const maxMatches = options.maxMatches ?? 10;

  const candidates = triggerMatch(prompt, knowledge);
  if (candidates.length === 0) return [];

  // Only call the LLM when there are enough candidates to be worth reranking.
  const topByTrigger = candidates
    .slice()
    .sort((a, b) => b.triggerScore - a.triggerScore)
    .slice(0, maxCandidatesForLLM);

  const llmScores = await llmRerank(prompt, topByTrigger);
  const byId = new Map<string, LlmScore>();
  if (llmScores) {
    for (const s of llmScores) byId.set(s.id, s);
  }

  const scored = candidates.map((c) => {
    const llm = byId.get(c.knowledge.id) ?? null;
    return {
      ...c,
      llmScore: llm?.score ?? null,
      reason: llm?.reason ? `${c.reason} · LLM: ${llm.reason}` : c.reason,
    };
  });

  const filtered = scored.filter((c) => {
    if (c.llmScore === null) return true; // LLM 실패 시 trigger 매칭만으로 유지
    return c.llmScore >= minLLMScore;
  });

  filtered.sort((a, b) => {
    // priority ASC (lower first)
    if (a.knowledge.priority !== b.knowledge.priority) {
      return a.knowledge.priority - b.knowledge.priority;
    }
    // then LLM score DESC (null treated as 0)
    const aL = a.llmScore ?? 0;
    const bL = b.llmScore ?? 0;
    if (aL !== bL) return bL - aL;
    // then trigger score DESC
    return b.triggerScore - a.triggerScore;
  });

  return filtered.slice(0, maxMatches);
}
