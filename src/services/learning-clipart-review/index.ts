// 생성 클립아트 교육 적합성 검수 (원칙 §6 · 독립 검수).
//
// 판정 축:
//   - purposeMatch: 이미지가 VisualPlan.purpose 를 충족하는가
//   - subjectMatterMatch: 표현 대상이 subjectMatter 와 일치하는가
//   - answerLeakage: 정답이 이미지에 직접 노출되지 않았는가 (answerLeakPolicy 반영)
//   - textPolicyCompliance: textPolicy 조건 준수
//   - ageAppropriate: 학년 수준 표현
//
// 검수 자체가 실패 (네트워크·모델 오류) 시 pass=true 로 두되 reviewerFailure 기록 (감사).

import type { VisualPlan } from '@/services/learning-generation/types';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const REVIEW_MODEL = process.env.LEARNING_CLIPART_REVIEW_MODEL || 'gpt-4o-mini';

function baseUrl(): string {
  return process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
}
function apiKey(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error('OPENAI_API_KEY missing');
  return k;
}

export interface ClipartReviewInput {
  itemId: string;
  visualPlan: VisualPlan;
  imageUrl: string;
  /** 원래 문항 stem·정답 등 (정답 노출 검사 시 참고). */
  itemContext: {
    stem: string;
    answer?: string;
    hint?: string;
  };
}

export interface ClipartReviewResult {
  pass: boolean;
  reason: string;
  reviewerFailure?: { code: string; message: string };
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export async function reviewClipart(
  input: ClipartReviewInput,
): Promise<ClipartReviewResult> {
  const started = Date.now();

  const userPrompt = [
    '초등 학습자료용 클립아트 이미지를 교육 적합성 관점에서 검수한다.',
    '',
    '<VisualPlan>',
    JSON.stringify(input.visualPlan, null, 2),
    '</VisualPlan>',
    '',
    '<ItemContext>',
    JSON.stringify(input.itemContext, null, 2),
    '</ItemContext>',
    '',
    '판정 기준:',
    '- purposeMatch: 이미지가 VisualPlan.purpose 의 사고 지원 목적을 충족하는가',
    '- subjectMatterMatch: 표현 대상이 VisualPlan.subjectMatter 와 일치하는가',
    '- answerLeakage: 이미지가 ItemContext.answer 를 직접 노출하지 않는가 (VisualPlan.answerLeakPolicy 준수)',
    '- textPolicyCompliance: VisualPlan.textPolicy 조건을 준수하는가',
    '- ageAppropriate: 학년 수준에 적합한 표현인가',
    '',
    '반환 JSON 스키마:',
    '{ "pass": true|false, "reason": "간단한 근거", "failedCriteria": ["..."] }',
    '',
    '순수 JSON 만.',
  ].join('\n');

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
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              { type: 'image_url', image_url: { url: input.imageUrl } },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    return {
      pass: true,
      reason: '검수 호출 실패 — 서비스 지속을 위해 통과 처리 (감사 기록)',
      reviewerFailure: { code: 'REVIEW_UPSTREAM', message: (err as Error).message },
      durationMs: Date.now() - started,
    };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      pass: true,
      reason: '검수 호출 실패 — 서비스 지속을 위해 통과 처리 (감사 기록)',
      reviewerFailure: { code: `REVIEW_${res.status}`, message: body.slice(0, 200) },
      durationMs: Date.now() - started,
    };
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const raw = json.choices?.[0]?.message?.content ?? '';
  let parsed: { pass?: boolean; reason?: string; failedCriteria?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      pass: true,
      reason: '검수 응답 파싱 실패 — 통과 처리',
      reviewerFailure: { code: 'REVIEW_PARSE', message: raw.slice(0, 200) },
      durationMs: Date.now() - started,
    };
  }

  const pass = parsed.pass !== false;
  const reason = typeof parsed.reason === 'string' ? parsed.reason : pass ? '통과' : '판정 실패';

  return {
    pass,
    reason,
    durationMs: Date.now() - started,
    inputTokens: json.usage?.prompt_tokens,
    outputTokens: json.usage?.completion_tokens,
  };
}
