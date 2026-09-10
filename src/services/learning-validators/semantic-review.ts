// V2 독립 의미 검수 (원칙 §6).
//
// 생성 모델과 별도의 호출로 Context + Plan + Document 를 함께 비교해 pass 여부와
// 실패 아이템 목록을 반환한다. 특정 단어·정답을 검사하지 않고 범용 루브릭으로만
// 판정한다.
//
// 실패 시: caller (handler) 가 실패 item 만 최대 1회 부분 재생성.
// 리뷰어 자체 실패 (AI 호출 오류·파싱 실패) 시: reviewerFailure 로 표시하고 pass=true
// 로 두어 서비스가 멈추지 않도록 한다 (감사 로그에는 남음).

import type { LearningDocument, Section } from '@/services/learning-renderer/schema';
import type { GenerationContext } from '@/services/learning-generation/context-builder';
import type {
  ContentPlan,
  SemanticReviewItem,
  SemanticReviewResult,
} from '@/services/learning-generation/types';

const REVIEW_MODEL = process.env.LEARNING_REVIEW_MODEL || 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

function baseUrl(): string {
  return process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
}
function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing');
  return key;
}

const REVIEW_SYSTEM_PROMPT = [
  `너는 대한민국 초등학교 교사가 사용할 학습자료를 검수하는 독립 검수자다.`,
  `주어지는 세 자료를 함께 비교해 판단한다:`,
  `  - GenerationContext (요청 맥락과 프로필)`,
  `  - ContentPlan (요청에 맞춰 만든 출제 설계도)`,
  `  - LearningDocument (실제 생성된 결과)`,
  ``,
  `특정 단어·정답·오답 문자열을 검사하지 마라. 아래 범용 루브릭으로만 판단한다:`,
  `  - goalCoverage: 학습 목표를 실제로 다루는가`,
  `  - unitTopicAlignment: 단원·주제에 맞는가`,
  `  - gradeSuitability: 학년 수준에 맞는가`,
  `  - selfContainedness: 문항 자체만으로 학생이 이해할 수 있는가`,
  `  - answerValidity: 정답 또는 기대 결과의 근거가 명확한가`,
  `  - distractorQuality: 오답이 단순 오류가 아니라 교육적으로 타당한가`,
  `  - hintQuality: 힌트가 사고를 돕고 답을 대신 하지 않는가`,
  `  - distinctRoles: 문항 간 역할과 경험이 실제로 구별되는가`,
  `  - usabilityAsMaterial: 선택한 자료의 형으로써 실제 사용 가능한가`,
  ``,
  `각 재생성 가능 아이템 (question / activity) 에 대해 판정한다.`,
  ``,
  `반드시 다음 JSON 형식으로만 응답하라. 다른 텍스트 금지.`,
  `{`,
  `  "pass": true|false,`,
  `  "reason": "전체 판정 요약",`,
  `  "failedItemIndexes": [0, 3],`,
  `  "items": [`,
  `    {`,
  `      "itemIndex": 0,`,
  `      "itemId": "q_01",`,
  `      "pass": false,`,
  `      "criteria": ["goalCoverage", "hintQuality"],`,
  `      "reason": "계획과 결과가 맞지 않는 의미적 이유",`,
  `      "repairInstruction": "원래 목표와 난이도를 유지하면서 어떤 부분을 어떻게 고칠지"`,
  `    }`,
  `  ]`,
  `}`,
  ``,
  `- pass 가 true 이면 items 는 빈 배열이어도 된다.`,
  `- pass 가 false 이면 실패한 각 아이템에 대해 items 항목을 반드시 채운다.`,
  `- repairInstruction 은 특정 정답이나 금지어를 지시하지 말고, 어떤 사고·구성을 회복해야 하는지 설명한다.`,
].join('\n');

export interface SemanticReviewInput {
  context: GenerationContext;
  plan: ContentPlan;
  document: LearningDocument;
}

export async function runSemanticReview(
  input: SemanticReviewInput,
): Promise<SemanticReviewResult> {
  const started = Date.now();

  const targets = extractTargets(input.document.sections);
  if (targets.length === 0) {
    return {
      pass: true,
      reason: '재생성 가능 아이템 없음 — 검수 스킵',
      failedItemIndexes: [],
      items: [],
      durationMs: Date.now() - started,
    };
  }

  const userPrompt = buildUserPrompt(input, targets);

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
        model: REVIEW_MODEL,
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: REVIEW_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const name = (err as { name?: string }).name;
    return {
      pass: true,
      reason: 'reviewer 호출 실패 — 부분 재생성 없이 계속 진행',
      failedItemIndexes: [],
      items: [],
      reviewerFailure: {
        code: name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_UPSTREAM',
        message: name === 'AbortError' ? 'reviewer 응답 timeout (45s)' : (err as Error).message,
      },
      durationMs: Date.now() - started,
    };
  }
  clearTimeout(timeout);

  if (!res.ok) {
    return {
      pass: true,
      reason: 'reviewer 응답 오류 — 부분 재생성 없이 계속 진행',
      failedItemIndexes: [],
      items: [],
      reviewerFailure: { code: 'AI_UPSTREAM', message: `HTTP ${res.status}` },
      durationMs: Date.now() - started,
    };
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const raw = json.choices?.[0]?.message?.content ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      pass: true,
      reason: 'reviewer 응답 파싱 실패 — 부분 재생성 없이 계속 진행',
      failedItemIndexes: [],
      items: [],
      reviewerFailure: { code: 'PARSE_ERROR', message: 'JSON 파싱 실패' },
      durationMs: Date.now() - started,
    };
  }

  const normalized = normalizeReviewJson(parsed, targets);

  return {
    ...normalized,
    inputTokens: json.usage?.prompt_tokens,
    outputTokens: json.usage?.completion_tokens,
    durationMs: Date.now() - started,
  };
}

// ============================================================
// helpers
// ============================================================
interface TargetSummary {
  itemId: string;
  index: number;
  itemType: 'question' | 'activity';
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
    }
  });
  return out;
}

function buildUserPrompt(input: SemanticReviewInput, targets: TargetSummary[]): string {
  const targetsBlock = targets
    .map(
      (t, i) =>
        `[${i}] itemId=${t.itemId} · ${t.itemType}\n    ${t.text}\n    <blueprint>${JSON.stringify(
          input.plan.itemBlueprints.find((b) => b.itemId === t.itemId) ?? null,
        )}</blueprint>`,
    )
    .join('\n');

  return [
    `<GenerationContext>`,
    JSON.stringify(input.context, null, 2),
    `</GenerationContext>`,
    ``,
    `<ContentPlan overview>`,
    JSON.stringify(
      {
        interpretedGoal: input.plan.interpretedGoal,
        coverageSummary: input.plan.coverageSummary,
      },
      null,
      2,
    ),
    `</ContentPlan overview>`,
    ``,
    `<GeneratedItems (index 는 items 배열의 순번)>`,
    targetsBlock,
    `</GeneratedItems>`,
    ``,
    `모든 아이템을 루브릭으로 판정하고, 하나라도 실패면 pass=false 로 응답하라.`,
    `실패한 아이템은 items[] 에 반드시 포함하고 repairInstruction 을 채운다.`,
    `순수 JSON 만 반환.`,
  ].join('\n');
}

function normalizeReviewJson(
  raw: unknown,
  targets: TargetSummary[],
): SemanticReviewResult {
  const base: SemanticReviewResult = {
    pass: true,
    reason: '',
    failedItemIndexes: [],
    items: [],
    durationMs: 0,
  };
  if (!raw || typeof raw !== 'object') {
    return { ...base, pass: true, reason: 'reviewer 응답이 객체가 아님 (통과 처리)' };
  }
  const obj = raw as Record<string, unknown>;
  const pass = typeof obj.pass === 'boolean' ? obj.pass : true;
  const reason = typeof obj.reason === 'string' ? obj.reason : '';
  const failedIndexes = Array.isArray(obj.failedItemIndexes)
    ? (obj.failedItemIndexes.filter((n): n is number => Number.isInteger(n)) as number[])
    : [];

  const items: SemanticReviewItem[] = [];
  if (Array.isArray(obj.items)) {
    for (const it of obj.items) {
      if (!it || typeof it !== 'object') continue;
      const r = it as Record<string, unknown>;
      const itemIndex = Number.isInteger(r.itemIndex) ? (r.itemIndex as number) : -1;
      if (itemIndex < 0 || itemIndex >= targets.length) continue;
      const itemId =
        typeof r.itemId === 'string' && r.itemId ? r.itemId : targets[itemIndex]!.itemId;
      const passFlag = typeof r.pass === 'boolean' ? r.pass : false;
      const criteria = Array.isArray(r.criteria)
        ? (r.criteria.filter((c) => typeof c === 'string') as string[])
        : [];
      items.push({
        itemIndex,
        itemId,
        pass: passFlag,
        criteria,
        reason: typeof r.reason === 'string' ? r.reason : '',
        repairInstruction:
          typeof r.repairInstruction === 'string'
            ? r.repairInstruction
            : '원래 blueprint 를 유지하면서 지적된 부분을 다시 작성해 주세요.',
      });
    }
  }

  // pass 가 true 라고 왔지만 failedItemIndexes 나 items 에 실패가 있으면 pass=false 로 강제
  const derivedPass = failedIndexes.length === 0 && items.every((it) => it.pass);
  return {
    ...base,
    pass: pass && derivedPass,
    reason: reason || (derivedPass ? '검수 통과' : `${items.length}개 아이템 재검토 필요`),
    failedItemIndexes: derivedPass ? [] : failedIndexes.length > 0 ? failedIndexes : items.map((it) => it.itemIndex),
    items,
  };
}
