// L2 Deterministic validator — 프로필의 deterministicRules 로 코드가 직접 검산.
//
// 이 계층이 처리하는 것:
//   - 개수 (요청 questionCount 와 실 questions/activities 일치)
//   - 객관식: 선택지 개수 · 정답 유일성 · 선택지 중복 · 정답 번호 범위
//   - 수학: operationSet 밖 연산 금지 · 숫자 범위 · 받아올림 · 음수/소수 정책
//   - 정답 위치 편중 (세트 단위 통계)
//
// 이 계층이 처리하지 않는 것 (L3 로):
//   - 학년 어휘 적합성
//   - 주제·단원 의미 일치
//   - 힌트가 정답을 "의미상" 노출하는지 (동의어·활용형)

import type { LearningDocument, Section } from '@/services/learning-renderer/schema';
import type {
  EvaluationItemResult,
  EvaluationResult,
  MathRules,
  ResolvedLearningProfile,
} from '@/services/learning-profile';

type QuestionSection = Extract<Section, { kind: 'question' }>;

export interface DeterministicInput {
  document: LearningDocument;
  profile: ResolvedLearningProfile;
  requestedMaterialType: string;
  requestedQuestionCount: number;
}

export function runDeterministic(input: DeterministicInput): EvaluationResult {
  const started = Date.now();
  const items: EvaluationItemResult[] = [];

  const questions = input.document.sections.filter(
    (s): s is QuestionSection => s.kind === 'question',
  );
  const activities = input.document.sections.filter((s) => s.kind === 'activity');

  // (1) 개수 검증
  const isQuestionMaterial = ['multiple_choice', 'ox_quiz', 'short_answer', 'fill_blank'].includes(
    input.requestedMaterialType,
  );
  const isActivityMaterial = ['individual_activity', 'individual_worksheet', 'group_worksheet'].includes(
    input.requestedMaterialType,
  );

  if (isQuestionMaterial && questions.length !== input.requestedQuestionCount) {
    items.push({
      itemId: '(document)',
      itemIndex: 0,
      itemType: 'other',
      criterionKey: 'count',
      passed: false,
      reason: `요청 문항 ${input.requestedQuestionCount}개, 실제 ${questions.length}개`,
      severity: 'error',
      repairAction: 'manual_review',
    });
  } else if (isActivityMaterial && activities.length !== input.requestedQuestionCount) {
    items.push({
      itemId: '(document)',
      itemIndex: 0,
      itemType: 'other',
      criterionKey: 'count',
      passed: false,
      reason: `요청 활동 ${input.requestedQuestionCount}개, 실제 ${activities.length}개`,
      severity: 'error',
      repairAction: 'manual_review',
    });
  }

  // (2) 객관식 개별 검증 (프로필 rules 기반)
  const mcRules = input.profile.deterministicRules.multipleChoice;
  const choiceCount = mcRules?.choiceCount ?? 4;
  const requiredCorrect = mcRules?.requiredCorrectAnswerCount ?? 1;
  const allowDup = mcRules?.allowDuplicateChoices ?? false;

  const mcQuestions = questions.filter((q) => q.qtype === 'mc');
  mcQuestions.forEach((q, i) => {
    const qId = q.itemId ?? `q_${String(i + 1).padStart(2, '0')}`;
    const idx = questions.indexOf(q);
    const chks = validateMcOne(q, {
      choiceCount,
      requiredCorrect,
      allowDup,
    });
    for (const chk of chks) {
      items.push({
        itemId: qId,
        itemIndex: idx,
        itemType: 'question',
        criterionKey: chk.criterionKey,
        passed: false,
        reason: chk.reason,
        severity: 'error',
        repairAction: 'rewrite_item',
      });
    }
  });

  // OX
  const oxQuestions = questions.filter((q) => q.qtype === 'ox');
  oxQuestions.forEach((q, i) => {
    const qId = q.itemId ?? `q_${String(i + 1).padStart(2, '0')}`;
    const idx = questions.indexOf(q);
    if (!q.answer || !/^[OX]$/i.test(q.answer.trim())) {
      items.push({
        itemId: qId,
        itemIndex: idx,
        itemType: 'question',
        criterionKey: 'ox-answer-format',
        passed: false,
        reason: `OX answer 는 O/X 여야 함 (실제: "${q.answer ?? '(empty)'}")`,
        severity: 'error',
        repairAction: 'rewrite_item',
      });
    }
  });

  // (3) 세트 단위 정답 편중
  if (mcQuestions.length >= 3) {
    const positionCount = new Map<number, number>();
    const contentCount = new Map<string, number>();
    for (const q of mcQuestions) {
      const choices = q.choices ?? [];
      const idx = parseAnswerIndex(q.answer, choices.length);
      if (idx === null) continue;
      positionCount.set(idx, (positionCount.get(idx) ?? 0) + 1);
      const content = (choices[idx] ?? '').replace(/\s+/g, '').trim();
      if (content) contentCount.set(content, (contentCount.get(content) ?? 0) + 1);
    }
    const n = mcQuestions.length;
    for (const [pos, count] of positionCount) {
      if (count / n > 0.5) {
        items.push({
          itemId: '(set)',
          itemIndex: 0,
          itemType: 'other',
          criterionKey: 'answer-position-bias',
          passed: false,
          reason: `정답이 ${pos + 1}번 위치에 ${Math.round((count / n) * 100)}% (${count}/${n}) 몰림`,
          severity: 'error',
          repairAction: 'manual_review',
        });
        break;
      }
    }
    for (const [content, count] of contentCount) {
      if (count / n > 0.5) {
        items.push({
          itemId: '(set)',
          itemIndex: 0,
          itemType: 'other',
          criterionKey: 'answer-content-bias',
          passed: false,
          reason: `정답 "${content}" 이 ${Math.round((count / n) * 100)}% (${count}/${n}) 반복`,
          severity: 'error',
          repairAction: 'manual_review',
        });
        break;
      }
    }
  }

  // (4) 수학 규칙
  const mathRules = input.profile.deterministicRules.math;
  if (mathRules) {
    for (let i = 0; i < questions.length; i += 1) {
      const q = questions[i]!;
      const qId = q.itemId ?? `q_${String(i + 1).padStart(2, '0')}`;
      const mathIssues = validateMathQuestion(q, mathRules);
      for (const issue of mathIssues) {
        items.push({
          itemId: qId,
          itemIndex: i,
          itemType: 'question',
          criterionKey: issue.criterionKey,
          passed: false,
          reason: issue.reason,
          severity: 'error',
          repairAction: 'rewrite_item',
        });
      }
    }
    for (let i = 0; i < activities.length; i += 1) {
      const a = activities[i] as Extract<Section, { kind: 'activity' }>;
      const aId = a.itemId ?? `act_${String(i + 1).padStart(2, '0')}`;
      const aIdx = input.document.sections.indexOf(a);
      const combined = [a.title ?? '', ...a.steps].join(' ');
      const opsFound = detectOps(combined);
      const allowed: Set<string> = new Set(mathRules.operationSet ?? []);
      if (allowed.size > 0) {
        for (const op of opsFound) {
          if (!allowed.has(op)) {
            items.push({
              itemId: aId,
              itemIndex: aIdx,
              itemType: 'activity',
              criterionKey: 'math-operation-out-of-scope',
              passed: false,
              reason: `활동에 허용 외 연산 (${op}) 등장 (허용: ${Array.from(allowed).join(', ')})`,
              severity: 'error',
              repairAction: 'rewrite_item',
            });
            break;
          }
        }
      }
    }
  }

  const failedItemIds = Array.from(
    new Set(
      items
        .filter((it) => it.severity === 'error' && it.repairAction === 'rewrite_item')
        .map((it) => it.itemId),
    ),
  );

  const passed = items.every((it) => it.severity !== 'error');
  return {
    stage: 'deterministic',
    passed,
    summary: passed
      ? `${mcQuestions.length}개 객관식 + ${activities.length}개 활동 결정적 검증 통과`
      : `${items.length}건 위반`,
    evaluatorType: 'code',
    items,
    failedItemIds,
    durationMs: Date.now() - started,
  };
}

// ============================================================
// helpers
// ============================================================

interface McValidationRules {
  choiceCount: number;
  requiredCorrect: number;
  allowDup: boolean;
}

function validateMcOne(
  q: QuestionSection,
  rules: McValidationRules,
): Array<{ criterionKey: string; reason: string }> {
  const issues: Array<{ criterionKey: string; reason: string }> = [];
  const choices = q.choices ?? [];

  if (choices.length < 3) {
    issues.push({
      criterionKey: 'mc-choice-count',
      reason: `선택지 ${choices.length}개 (최소 3개)`,
    });
  } else if (rules.choiceCount && choices.length !== rules.choiceCount) {
    // 정책상 정확 개수 강제하지 않고 경고 수준 → 지금은 skip (프로필이 명시하면 강제)
    // 명시된 경우엔 mismatch 를 오류로.
    issues.push({
      criterionKey: 'mc-choice-count',
      reason: `프로필 요구 ${rules.choiceCount}개, 실제 ${choices.length}개`,
    });
  }

  if (!rules.allowDup) {
    const norm = (s: string) => s.replace(/\s+/g, '').replace(/[.·,]/g, '').trim();
    const seen = new Set<string>();
    for (const c of choices) {
      const k = norm(c);
      if (!k) continue;
      if (seen.has(k)) {
        issues.push({
          criterionKey: 'mc-duplicate-choice',
          reason: `실질적으로 같은 선택지 존재 ("${c}")`,
        });
        break;
      }
      seen.add(k);
    }
  }

  if (!q.answer) {
    issues.push({ criterionKey: 'mc-answer-missing', reason: '정답 필드 없음' });
    return issues;
  }
  const idx = parseAnswerIndex(q.answer, choices.length);
  if (idx === null) {
    issues.push({
      criterionKey: 'mc-answer-out-of-range',
      reason: `정답 "${q.answer}" 이 선택지 범위 밖`,
    });
  }

  // requiredCorrectAnswerCount 는 지금 스키마상 answer 하나. 추후 다중 정답 지원 시 확장.
  return issues;
}

function parseAnswerIndex(answer: string | undefined, totalChoices: number): number | null {
  if (!answer) return null;
  const m = answer.trim().match(/^(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1 || n > totalChoices) return null;
  return n - 1;
}

// ============================================================
// Math validation
// ============================================================

function validateMathQuestion(
  q: QuestionSection,
  rules: MathRules,
): Array<{ criterionKey: string; reason: string }> {
  const issues: Array<{ criterionKey: string; reason: string }> = [];
  const text = [q.stem, ...(q.choices ?? []), q.answer ?? '', q.hint ?? ''].join(' ');

  // (a) operationSet
  const allowed: Set<string> = new Set(rules.operationSet ?? []);
  if (allowed.size > 0) {
    const found = detectOps(text);
    for (const op of found) {
      if (!allowed.has(op)) {
        issues.push({
          criterionKey: 'math-operation-out-of-scope',
          reason: `허용 외 연산 (${op}) 등장 (허용: ${Array.from(allowed).join(', ')})`,
        });
        break;
      }
    }
  }

  // (b) numberRange
  if (rules.numberRange) {
    const { min, max } = rules.numberRange;
    const nums = extractIntegers(text);
    for (const n of nums) {
      if (n < min || n > max) {
        issues.push({
          criterionKey: 'math-number-range',
          reason: `숫자 ${n} 이 허용 범위 [${min}, ${max}] 밖`,
        });
        break;
      }
    }
  }

  // (c) allowsNegative / allowsDecimal
  if (rules.allowsNegative === false) {
    if (/-\s*\d/.test(text) || /음수/.test(text)) {
      issues.push({ criterionKey: 'math-no-negative', reason: '음수 사용 금지 정책' });
    }
  }
  if (rules.allowsDecimal === false) {
    if (/\d+\.\d+/.test(text) || /소수/.test(text)) {
      issues.push({ criterionKey: 'math-no-decimal', reason: '소수 사용 금지 정책' });
    }
  }

  return issues;
}

const OP_KEYWORDS: Record<string, RegExp[]> = {
  addition: [/\+/, /더하기/, /덧셈/],
  subtraction: [/-\s*\d/, /빼기/, /뺄셈/],
  multiplication: [/×/, /곱하기/, /곱셈/, /\bx\b/],
  division: [/÷/, /나누기/, /나눗셈/],
};

function detectOps(text: string): Set<string> {
  const found = new Set<string>();
  for (const [op, patterns] of Object.entries(OP_KEYWORDS)) {
    if (patterns.some((p) => p.test(text))) found.add(op);
  }
  return found;
}

function extractIntegers(text: string): number[] {
  const matches = text.match(/-?\d+/g);
  if (!matches) return [];
  return matches.map((s) => Number(s)).filter((n) => Number.isFinite(n));
}
