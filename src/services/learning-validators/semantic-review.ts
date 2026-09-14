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
  `hintPlan 계약 존중 (매우 중요, 원칙 §4):`,
  `- 각 blueprint 의 hintPlan.needed 를 반드시 참고한다.`,
  `- needed === false 인 문항은 hint 필드가 없어야 정상이다. hint 필드가 없다는 이유만으로`,
  `  hintQuality 를 실패로 판정하지 마라. 오히려 needed === false 인데 hint 필드가 존재하면`,
  `  hintQuality 실패로 판정한다.`,
  `- needed === true 인 문항만 hint 존재·품질을 평가한다. 이 경우 hint 가 hintPlan.strategy 에`,
  `  부합하고 정답 그 자체·동의어·정의를 담지 않는지만 본다.`,
  ``,
  `이미지 계획 존중 (매우 중요):`,
  `- 각 아이템의 blueprint.visualPlan 이 non-null 이면 이 아이템에는 이후 단계에서 실제 이미지가 생성·삽입된다.`,
  `- 너는 텍스트만 볼 뿐이고, 이 시점에 이미지는 아직 생성되지 않았다. 이미지의 내용·품질·연관성을 절대 추측하지 마라.`,
  `- visualPlan 이 non-null 인 아이템에 대해서는 selfContained·selfContainedness 를 평가에서 제외한다`,
  `  (stem 만으로 정답 결정 요구는 이미지 기반 학습 목표를 오판정하므로).`,
  `- 대신 그 아이템의 stem 이 학생에게 관찰·행동 지시를 명확히 하는지, 선택지·정답·힌트가 blueprint 와 일관되는지 등`,
  `  텍스트로 판정 가능한 부분만 평가한다.`,
  `- visualPlan 이 null 인 아이템은 기존 루브릭 전체 적용.`,
  ``,
  `객관식 선택지 판정 (매우 중요):`,
  `- 객관식 문항의 선택지 중 답이 아닌 것 (오답) 은 "정답과 다른 특성"을 보이는 것이 정상이다.`,
  `- 오답이 정답과 같은 특성을 공유하지 않는다는 이유만으로 goalCoverage 또는 internalConsistency 를 실패로 판정하지 마라.`,
  `- 오답 판정은 오직 distractorQuality (교육적으로 타당한 오답인가) 로만 한다.`,
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

  // 텍스트 검수는 모든 아이템 대상. 이미지가 계획된 (visualPlan 존재) 아이템도 텍스트
  // (stem/choices/answer/hint) 는 여기서 판정한다. 이미지 내용은 뒤에서 vision 검수가 담당하며
  // 이 단계에서 이미지 품질을 추측하지 않는다 (프롬프트에서 명시).
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

  // Advisory-only 실패는 파이프라인을 막지 않는다.
  //   - 하드 실패 기준 (정답·힌트·학년·자기완결성·목표 부합 등) 은 그대로 fail.
  //   - Advisory 는 리뷰어의 주관적 스타일 판단 (오답 유사성·역할 구별·다양성·자료 사용성 등)
  //     이며 fail 시 감사 로그에는 남기되 pipeline 은 계속 진행한다.
  const filtered = filterAdvisoryOnly(normalized);

  return {
    ...filtered,
    inputTokens: json.usage?.prompt_tokens,
    outputTokens: json.usage?.completion_tokens,
    durationMs: Date.now() - started,
  };
}

const HARD_CRITERIA = new Set([
  'answerValidity',
  'hintQuality',
  'goalCoverage',
  'gradeSuitability',
  'selfContained',
  'selfContainedness',
  'unitTopicAlignment',
  'hintLeakage',
  // 정답·문항·이미지 소재 간 논리 불일치는 하드 실패로 판정 (오답이 아닌 자체 모순).
  'internalConsistency',
]);
const ADVISORY_CRITERIA = new Set([
  'distractorQuality',
  'distinctRoles',
  'diversity',
  'materialFit',
  'usabilityAsMaterial',
]);

function filterAdvisoryOnly(result: SemanticReviewResult): SemanticReviewResult {
  if (result.items.length === 0) return result;
  // 각 실패 아이템에 대해 하드 실패 존재 여부 판단.
  const strictlyFailedItems = result.items.filter(
    (it) => !it.pass && it.criteria.some((c) => HARD_CRITERIA.has(c)),
  );
  const advisoryOnly = result.items.filter(
    (it) => !it.pass && !it.criteria.some((c) => HARD_CRITERIA.has(c)),
  );

  const pass = strictlyFailedItems.length === 0;
  return {
    ...result,
    pass,
    reason: pass
      ? advisoryOnly.length > 0
        ? `advisory-only failures: ${advisoryOnly.length}건 (파이프라인 통과)`
        : result.reason
      : result.reason,
    // items 는 원본 그대로 유지 (감사 로그·repair 결정에 필요).
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
    .map((t, i) => {
      const bp = input.plan.itemBlueprints.find((b) => b.itemId === t.itemId) ?? null;
      const visualPlanned = bp?.visualPlan ? true : false;
      return `[${i}] itemId=${t.itemId} · ${t.itemType} · visualPlanned=${visualPlanned}\n    ${t.text}\n    <blueprint>${JSON.stringify(bp)}</blueprint>`;
    })
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
    `이미지 계획 관련 판정 규칙 (이미지는 이후 단계에서 생성됨, 지금은 텍스트만 존재):`,
    `- visualPlanned=true 인 아이템은 blueprint.visualPlan 이 있어 이후에 이미지가 삽입된다.`,
    `  이 단계에서 이미지는 아직 존재하지 않으므로 이미지 내용·품질을 추측하지 마라.`,
    `  이런 아이템에서는 selfContained/selfContainedness 를 평가하지 않는다 (이미지 기반 학습 목표를 잘못 실패 처리하지 않도록).`,
    `  대신 stem 이 관찰·행동 지시를 명확히 하는지, choices/answer/hint 가 blueprint 와 일관되는지만 본다.`,
    `- visualPlanned=false 인 아이템은 기존대로 stem 만으로 자기완결성을 판정한다.`,
    ``,
    `객관식 오답 판정 규칙:`,
    `- 정답이 아닌 선택지가 정답과 같은 특성을 공유하지 않는 것은 정상이다 (그래서 오답이다).`,
    `- 오답이 학습 목표와 무관하다는 이유만으로 goalCoverage / internalConsistency 를 실패로 판정하지 마라.`,
    `- 오답 판정은 distractorQuality 기준으로만 하며, "학습 목표에 부합하는 오해를 유도하는가" 를 본다.`,
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
