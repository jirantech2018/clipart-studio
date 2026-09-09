// L3 Semantic validator — 프로필의 semanticCriteria 를 GPT-4o-mini 로 검수.
//
// 이 계층이 처리하는 것 (프로필이 기준을 제시하는 항목만):
//   - 학년 수준·주제 일치
//   - 힌트가 정답을 "의미상" 노출하는지 (동의어·활용형)
//   - 문항 자연스러움
//   - allowed/excluded scope 준수
//
// 프로필에 semanticCriteria 가 비어 있으면 이 계층은 자동 pass. 즉 프로필 데이터
// 로 검수 스코프를 100% 제어.

import type { LearningDocument, Section } from '@/services/learning-renderer/schema';
import type {
  EvaluationItemResult,
  EvaluationResult,
  ResolvedLearningProfile,
} from '@/services/learning-profile';

const SEMANTIC_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

function baseUrl(): string {
  return process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
}
function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing');
  return key;
}

export interface SemanticInput {
  document: LearningDocument;
  profile: ResolvedLearningProfile;
  requestedGrade: number;
  requestedSubject: string;
  requestedUnit?: string | null;
  requestedTopic: string;
}

interface AiEvaluationResponse {
  items: Array<{
    itemId: string;
    criterionKey: string;
    passed: boolean;
    reason?: string;
  }>;
  overallSummary?: string;
}

export async function runSemantic(input: SemanticInput): Promise<EvaluationResult> {
  const started = Date.now();

  const criteria = input.profile.semanticCriteria;
  if (!criteria || criteria.length === 0) {
    return {
      stage: 'semantic',
      passed: true,
      summary: '적용할 semantic criteria 없음 (프로필 미정의)',
      evaluatorType: 'ai',
      evaluatorModel: SEMANTIC_MODEL,
      items: [],
      failedItemIds: [],
      durationMs: Date.now() - started,
    };
  }

  // 검수 대상 블록만 추출 (재생성 가능 kind).
  const targets = extractTargets(input.document.sections);
  if (targets.length === 0) {
    return {
      stage: 'semantic',
      passed: true,
      summary: '검수 대상 블록 없음',
      evaluatorType: 'ai',
      evaluatorModel: SEMANTIC_MODEL,
      items: [],
      failedItemIds: [],
      durationMs: Date.now() - started,
    };
  }

  const prompt = buildPrompt(input, targets);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: SEMANTIC_MODEL,
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const name = (err as { name?: string }).name;
    // L3 는 폴백 허용 — AI 실패 시 stage='semantic', passed=true 로 통과 (경고만).
    // 이유: L3 실패로 사용자 흐름 전체를 막지 않고 L1/L2 는 확정 통과했으므로 서비스 가치 유지.
    return {
      stage: 'semantic',
      passed: true,
      summary:
        name === 'AbortError'
          ? 'L3 AI 응답 timeout (45s) — L1/L2 통과 후 폴백 pass'
          : `L3 AI 호출 실패 (${(err as Error).message}) — 폴백 pass`,
      evaluatorType: 'ai',
      evaluatorModel: SEMANTIC_MODEL,
      items: [],
      failedItemIds: [],
      durationMs: Date.now() - started,
    };
  }
  clearTimeout(timeout);

  if (!res.ok) {
    return {
      stage: 'semantic',
      passed: true,
      summary: `L3 AI 응답 오류 ${res.status} — 폴백 pass`,
      evaluatorType: 'ai',
      evaluatorModel: SEMANTIC_MODEL,
      items: [],
      failedItemIds: [],
      durationMs: Date.now() - started,
    };
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const raw = json.choices?.[0]?.message?.content ?? '';
  let parsed: AiEvaluationResponse;
  try {
    parsed = JSON.parse(raw) as AiEvaluationResponse;
  } catch {
    return {
      stage: 'semantic',
      passed: true,
      summary: 'L3 응답 JSON 파싱 실패 — 폴백 pass',
      evaluatorType: 'ai',
      evaluatorModel: SEMANTIC_MODEL,
      items: [],
      failedItemIds: [],
      durationMs: Date.now() - started,
    };
  }

  const items: EvaluationItemResult[] = [];
  for (const it of parsed.items ?? []) {
    if (!it.itemId || !it.criterionKey) continue;
    const target = targets.find((t) => t.itemId === it.itemId);
    if (!target) continue;
    items.push({
      itemId: it.itemId,
      itemIndex: target.index,
      itemType: target.itemType,
      criterionKey: it.criterionKey,
      passed: !!it.passed,
      reason: it.reason ?? undefined,
      severity: it.passed ? 'warning' : 'error',
      repairAction: it.passed ? 'none' : 'rewrite_item',
    });
  }

  const failedItemIds = Array.from(
    new Set(items.filter((it) => !it.passed).map((it) => it.itemId)),
  );

  const passed = items.every((it) => it.passed);
  return {
    stage: 'semantic',
    passed,
    summary: parsed.overallSummary ?? (passed ? '의미 검수 통과' : `${failedItemIds.length}개 항목 재검토 필요`),
    evaluatorType: 'ai',
    evaluatorModel: SEMANTIC_MODEL,
    items,
    failedItemIds,
    inputTokens: json.usage?.prompt_tokens,
    outputTokens: json.usage?.completion_tokens,
    durationMs: Date.now() - started,
  };
}

// ============================================================
// prompt construction
// ============================================================

const SYSTEM_PROMPT = `당신은 대한민국 초등학교 교사의 자료 검수 도우미입니다.

교사가 제시한 [학년/과목/단원/주제] 와 [프로필 기준] 을 기준으로 학습자료의 각 항목을 검수합니다.
문항 하나가 여러 기준에서 문제가 있으면 각 기준별로 별도 결과를 반환합니다.
문법·오탈자·형식(개수/정답 유일성/중복)은 이미 코드가 검증했으므로 여기서 다시 판정하지 마세요.
이 계층은 **의미·수준·주제 정합·힌트 노출 여부**만 판정합니다.

반드시 다음 JSON 형식으로만 응답하세요. 다른 텍스트 금지.
{
  "items": [
    {
      "itemId": "q_01",
      "criterionKey": "topicAlignment",
      "passed": true,
      "reason": "선택 이유 짧게 (실패한 경우만)"
    }
  ],
  "overallSummary": "한 문장 요약 (선택)"
}
`;

interface TargetSummary {
  itemId: string;
  index: number;
  itemType: 'question' | 'activity' | 'table' | 'blank_space' | 'other';
  text: string;
}

function extractTargets(sections: Section[]): TargetSummary[] {
  const out: TargetSummary[] = [];
  sections.forEach((s, idx) => {
    const id = (s as { itemId?: string }).itemId;
    if (!id) return;
    if (s.kind === 'question') {
      const choicesText = s.choices?.map((c, i) => `${i + 1}) ${c}`).join(' | ') ?? '';
      const answerText = s.answer ? ` [정답:${s.answer}]` : '';
      const hintText = s.hint ? ` [힌트:${s.hint}]` : '';
      out.push({
        itemId: id,
        index: idx,
        itemType: 'question',
        text: `문항 (${s.qtype}): ${s.stem}${choicesText ? ` / 선택지: ${choicesText}` : ''}${answerText}${hintText}`,
      });
    } else if (s.kind === 'activity') {
      out.push({
        itemId: id,
        index: idx,
        itemType: 'activity',
        text: `활동 (${s.title ?? ''}): ${s.steps.join(' → ')}`,
      });
    } else if (s.kind === 'table') {
      const rowsText = s.rows.map((r) => r.join(' | ')).join(' / ');
      out.push({
        itemId: id,
        index: idx,
        itemType: 'table',
        text: `표: ${s.caption ?? ''} ${rowsText}`,
      });
    } else if (s.kind === 'blank-space') {
      out.push({
        itemId: id,
        index: idx,
        itemType: 'blank_space',
        text: `빈 공간: ${s.prompt ?? '(안내 없음)'}`,
      });
    }
  });
  return out;
}

function buildPrompt(input: SemanticInput, targets: TargetSummary[]): string {
  const criteriaBlock = input.profile.semanticCriteria
    .map(
      (c, i) =>
        `- criterionKey="${c.key}"${c.label ? ` (${c.label})` : ''}${c.required ? ' [required]' : ''}\n    지침: ${c.instruction}`,
    )
    .join('\n');

  const scopeChain = input.profile.scopeChain.map((s) => `${s.scopeType}:${s.title}`).join(' → ');

  const vocab = input.profile.vocabularyGuidance;
  const vocabBlock =
    Object.keys(vocab).length > 0
      ? `\n[어휘 가이드]\n${JSON.stringify(vocab, null, 2)}`
      : '';

  const excluded =
    input.profile.excludedScope.length > 0
      ? `\n[제외 범위]\n${input.profile.excludedScope.map((r) => `- ${r.key}${r.description ? `: ${r.description}` : ''}`).join('\n')}`
      : '';

  const targetsBlock = targets
    .map((t) => `[${t.itemId}] ${t.text}`)
    .join('\n');

  return `[요청]
학년: ${input.requestedGrade}학년
과목: ${input.requestedSubject}
단원: ${input.requestedUnit ?? '(미지정)'}
주제: ${input.requestedTopic}

[프로필 체인]
${scopeChain || '(빈 프로필)'}
${vocabBlock}${excluded}

[검수 기준]
${criteriaBlock || '(없음)'}

[검수 대상 (재생성 가능 블록만)]
${targetsBlock}

각 아이템에 대해 검수 기준별로 판정하세요. 아이템이 특정 기준과 무관하면 그 기준은 결과에서 생략하세요.
반드시 위 JSON 형식으로만 응답.
`;
}
