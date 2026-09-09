// Legacy validators (M2-1.1 ~ M2-1.7).
//
// 배경:
//   M2-1.8 이전에는 검증 로직이 handler (services/jobs/handlers/learning-doc.ts) 안에
//   케이스별 함수로 파묻혀 있었다. 각 함수는 특정 오류 사례를 잡기 위한 hand-coded
//   가드로, 데이터 (LearningProfile) 로 표현할 수 없어 신규 과목/단원이 늘 때마다
//   코드 수정이 필요했다.
//
// 이관 목적:
//   - 로직 자체는 유지하되 격리하여, 신규 3계층 (L1 structural + L2 deterministic
//     + L3 semantic) 이 안정되기 전까지 회귀 안전망으로 사용.
//   - 회귀 테스트 (R1~R12 fixture) 는 이 파일을 직접 호출해 신규 검증과 대조.
//   - 신규 3계층이 legacy 를 완전히 커버함을 확인한 뒤 삭제 판단 (사용자 지시).
//
// 사용 위치:
//   - services/jobs/handlers/learning-doc.ts 에서 신규 3계층과 병행 실행하여
//     양쪽 결과가 일치하지 않으면 로그로 남긴다 (드리프트 감지).
//   - 회귀 fixture 테스트에서 케이스별 재현.
//
// 삭제 조건 (아직 미충족):
//   - R1~R12 fixture 가 신규 3계층으로만 100% 재현 통과
//   - 프로덕션 배포 후 2주 이상 신규 검증이 legacy 를 앞선다는 지표 확보

import type { LearningDocument, Section } from '@/services/learning-renderer/schema';
import {
  extractTargetJamoFromStem,
  findChoicesContainingJamo,
} from '@/features/learning-helper/lib/hangul';
import { isJamoRelatedTopic } from '@/services/learning-orchestrator/prompts';

type QuestionSection = Extract<Section, { kind: 'question' }>;

export interface LegacyValidationInput {
  subject: string;
  unit: string;
  topic: string;
  materialType: string;
  questionCount: number;
}

export type LegacyCheck =
  | { ok: true }
  | { ok: false; reason: string };

// ============================================================
// 정답 위치 셔플 (M2-1.4)
// ============================================================
export function shuffleMcSections(sections: Section[]): Section[] {
  return sections.map((s) => {
    if (s.kind !== 'question' || s.qtype !== 'mc') return s;
    const choices = s.choices;
    if (!choices || choices.length < 2 || !s.answer) return s;
    const answerIdx = parseAnswerIndex(s.answer, choices.length);
    if (answerIdx === null) return s;
    const correctContent = choices[answerIdx]!;

    const shuffled = [...choices];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = shuffled[i]!;
      shuffled[i] = shuffled[j]!;
      shuffled[j] = tmp;
    }
    const newAnswerIdx = shuffled.indexOf(correctContent);
    if (newAnswerIdx < 0) return s;

    return { ...s, choices: shuffled, answer: String(newAnswerIdx + 1) };
  });
}

export function parseAnswerIndex(answer: string, totalChoices: number): number | null {
  const m = answer.trim().match(/^(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1 || n > totalChoices) return null;
  return n - 1;
}

// ============================================================
// 객관식 개별 검증 (M2-1.2 자모 정답 코드 검증 + 중복 방지)
// ============================================================
export function validateMultipleChoice(
  q: QuestionSection,
  questionIndex: number,
): LegacyCheck {
  if (q.qtype !== 'mc' && q.qtype !== 'ox') return { ok: true };
  const choices = q.choices ?? [];

  if (q.qtype === 'ox') {
    if (!q.answer || !/^[OX]$/i.test(q.answer.trim())) {
      return { ok: false, reason: `${questionIndex + 1}번 문항: OX answer 형식 오류` };
    }
    return { ok: true };
  }

  if (choices.length < 3) {
    return {
      ok: false,
      reason: `${questionIndex + 1}번 문항: 선택지가 ${choices.length}개 (최소 3개 필요)`,
    };
  }

  const norm = (s: string) => s.replace(/\s+/g, '').replace(/[.·,]/g, '').trim();
  const seen = new Set<string>();
  for (const c of choices) {
    const key = norm(c);
    if (!key) continue;
    if (seen.has(key)) {
      return {
        ok: false,
        reason: `${questionIndex + 1}번 문항: 선택지 중 실질적으로 같은 항목 존재 ("${c}")`,
      };
    }
    seen.add(key);
  }

  if (!q.answer) {
    return { ok: false, reason: `${questionIndex + 1}번 문항: 정답이 비어 있음` };
  }
  const answerIdx = parseAnswerIndex(q.answer, choices.length);
  if (answerIdx === null) {
    return {
      ok: false,
      reason: `${questionIndex + 1}번 문항: 정답 "${q.answer}" 이 선택지 범위와 일치하지 않음`,
    };
  }

  const targetJamo = extractTargetJamoFromStem(q.stem);
  if (targetJamo) {
    const matched = findChoicesContainingJamo(choices, targetJamo);
    if (matched.length === 0) {
      return {
        ok: false,
        reason: `${questionIndex + 1}번 문항: 목표 자모 "${targetJamo}" 가 어떤 선택지에도 없음`,
      };
    }
    if (matched.length > 1) {
      return {
        ok: false,
        reason: `${questionIndex + 1}번 문항: "${targetJamo}" 를 포함한 선택지가 ${matched.length}개 (정답이 1개가 아님)`,
      };
    }
    if (matched[0] !== answerIdx) {
      return {
        ok: false,
        reason: `${questionIndex + 1}번 문항: 정답 번호 불일치 (실제로 "${targetJamo}" 를 포함한 선택지는 ${matched[0]! + 1}번, AI 는 ${answerIdx + 1}번 응답)`,
      };
    }
  }

  return { ok: true };
}

// ============================================================
// 세트 단위 검증 (M2-1.3)
// ============================================================
const BAD_HINT_PATTERNS: RegExp[] = [
  /앞의?\s*문제와?\s*같/,
  /앞에서\s*나온\s*답과?\s*같/,
  /['‘’][가-힣]+['‘’]와?\s*비슷/,
  /['‘’][가-힣]+['‘’]\s*,?\s*['‘’][가-힣]+['‘’]와?\s*같/,
];

export function validateQuestionSet(questions: QuestionSection[]): LegacyCheck {
  const mcQs = questions.filter((q) => q.qtype === 'mc');
  const n = mcQs.length;
  if (n < 3) return { ok: true };

  const answerContent = new Map<string, number>();
  const answerPos = new Map<number, number>();
  for (const q of mcQs) {
    const choices = q.choices ?? [];
    if (!q.answer || choices.length === 0) continue;
    const idx = parseAnswerIndex(q.answer, choices.length);
    if (idx === null) continue;
    const content = (choices[idx] ?? '').replace(/\s+/g, '').trim();
    if (content) answerContent.set(content, (answerContent.get(content) ?? 0) + 1);
    answerPos.set(idx, (answerPos.get(idx) ?? 0) + 1);
  }

  for (const [content, count] of answerContent) {
    if (count / n > 0.5) {
      const pct = Math.round((count / n) * 100);
      return {
        ok: false,
        reason: `정답 "${content}" 이 전체 문항의 ${pct}% (${count}/${n}) 을 차지 — 정답 내용이 너무 편중됨`,
      };
    }
  }

  for (const [pos, count] of answerPos) {
    if (count / n > 0.5) {
      const pct = Math.round((count / n) * 100);
      return {
        ok: false,
        reason: `정답이 ${pos + 1}번 위치에 ${pct}% (${count}/${n}) 몰림`,
      };
    }
  }

  const targetJamos = mcQs
    .map((q) => extractTargetJamoFromStem(q.stem))
    .filter((j): j is string => j !== null);
  if (targetJamos.length >= 3 && new Set(targetJamos).size === 1) {
    return {
      ok: false,
      reason: `자모 유형 ${targetJamos.length}문항 모두 동일한 자모 "${targetJamos[0]}" 를 다룸 — 서로 다른 자모로 문항을 구성해야 함`,
    };
  }

  for (let i = 1; i < mcQs.length; i += 1) {
    const prev = (mcQs[i - 1]!.choices ?? []).map((c) => c.replace(/\s+/g, '').trim()).join('|');
    const curr = (mcQs[i]!.choices ?? []).map((c) => c.replace(/\s+/g, '').trim()).join('|');
    if (prev && prev === curr) {
      return {
        ok: false,
        reason: `${i}번과 ${i + 1}번 문항의 선택지 배열이 완전히 동일 — 선택지 순서·구성을 다르게 해야 함`,
      };
    }
  }

  for (let i = 0; i < mcQs.length; i += 1) {
    const hint = mcQs[i]!.hint;
    if (!hint) continue;
    for (const pat of BAD_HINT_PATTERNS) {
      if (pat.test(hint)) {
        return {
          ok: false,
          reason: `${i + 1}번 힌트가 이전 문항을 참조: "${hint}"`,
        };
      }
    }
  }

  const stemHeads = mcQs.map((q) => q.stem.replace(/\s+/g, '').slice(0, 5));
  const uniqueHeads = new Set(stemHeads);
  if (uniqueHeads.size < 2) {
    return {
      ok: false,
      reason: `모든 문항 stem 이 같은 표현으로 시작 — 최소 2가지 이상의 문제 표현 사용 필요`,
    };
  }

  return { ok: true };
}

// ============================================================
// M2-1.5 subject/topic 라우팅
// ============================================================
const JAMO_WORD_TOKENS = ['모음', '자음', '초성', '중성', '종성', '받침'];

function stemLooksJamo(stem: string): boolean {
  if (extractTargetJamoFromStem(stem)) return true;
  return JAMO_WORD_TOKENS.some((t) => stem.includes(t));
}

export function validateSubjectTopicAlignment(
  input: LegacyValidationInput,
  doc: LearningDocument,
): LegacyCheck {
  const questions = doc.sections.filter(
    (s): s is QuestionSection => s.kind === 'question',
  );

  if (input.subject === 'MATH' && questions.length > 0) {
    for (let i = 0; i < questions.length; i += 1) {
      const q = questions[i]!;
      if (stemLooksJamo(q.stem)) {
        return {
          ok: false,
          reason: `수학 자료의 ${i + 1}번 문항이 한글 자모/모음/자음 관련 (stem: "${q.stem.slice(0, 30)}") — 과목 불일치`,
        };
      }
    }
  }

  if (
    input.subject === 'KOR' &&
    !isJamoRelatedTopic(input.unit, input.topic) &&
    questions.length > 0
  ) {
    const jamoCount = questions.filter((q) => stemLooksJamo(q.stem)).length;
    if (jamoCount > questions.length / 2) {
      return {
        ok: false,
        reason: `주제 "${input.topic}" 은 자모 학습이 아닌데 ${jamoCount}/${questions.length} 문항이 자모 문제 — 주제와 문항 내용 불일치`,
      };
    }
  }

  return { ok: true };
}

// ============================================================
// M2-1.6a self-contained
// ============================================================
const DEICTIC_PATTERNS = [
  '이 사물', '위 사물', '아래 사물', '다음 사물',
  '이 그림', '위 그림', '아래 그림', '다음 그림',
  '이 사진', '위 사진', '아래 사진', '다음 사진',
  '이 물건', '위 물건', '아래 물건', '다음 물건',
  '화면에 있는', '그림을 보고', '그림에서', '그림 속',
  '사진을 보고', '사진에서',
];

function hasImageSection(sections: Section[]): boolean {
  return sections.some((s) => s.kind === 'image');
}

function findDeicticReference(text: string): string | null {
  for (const pat of DEICTIC_PATTERNS) {
    if (text.includes(pat)) return pat;
  }
  return null;
}

export function validateSelfContained(doc: LearningDocument): LegacyCheck {
  if (hasImageSection(doc.sections)) return { ok: true };

  const questions = doc.sections.filter(
    (s): s is QuestionSection => s.kind === 'question',
  );
  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i]!;
    const hit = findDeicticReference(q.stem);
    if (hit) {
      return {
        ok: false,
        reason: `${i + 1}번 문항이 이미지 없는데 "${hit}" 같은 외부 자료 지시 표현 사용 — stem 만으로 정답 결정 불가`,
      };
    }
  }

  for (const s of doc.sections) {
    if (s.kind === 'paragraph' && findDeicticReference(s.text)) {
      const hit = findDeicticReference(s.text)!;
      return {
        ok: false,
        reason: `문서에 이미지가 없는데 문단이 "${hit}" 표현 사용 — 학생이 참조할 수 없음`,
      };
    }
    if (s.kind === 'activity') {
      for (const step of s.steps) {
        const hit = findDeicticReference(step);
        if (hit) {
          return {
            ok: false,
            reason: `활동 "${s.title ?? ''}" 의 단계가 "${hit}" 표현 사용 — 이미지 없이 참조 불가`,
          };
        }
      }
    }
  }

  return { ok: true };
}

// ============================================================
// M2-1.6b 힌트 답 노출
// ============================================================
function hintRevealsAnswer(hint: string, correctChoice: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '').replace(/[.,·!?]/g, '');
  const answer = norm(correctChoice);
  if (answer.length < 3) return false;
  const h = norm(hint);
  return h.includes(answer);
}

export function validateHintDoesNotRevealAnswer(
  questions: QuestionSection[],
): LegacyCheck {
  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i]!;
    if (q.qtype !== 'mc' || !q.hint || !q.answer || !q.choices) continue;
    const idx = parseAnswerIndex(q.answer, q.choices.length);
    if (idx === null) continue;
    const correct = q.choices[idx];
    if (!correct) continue;
    if (hintRevealsAnswer(q.hint, correct)) {
      return {
        ok: false,
        reason: `${i + 1}번 힌트가 정답 "${correct}" 을 그대로 노출: "${q.hint}"`,
      };
    }
  }
  return { ok: true };
}

// ============================================================
// M2-1.6c 수학 활동지 연산 정합
// ============================================================
const OP_KEYWORDS: Record<string, RegExp[]> = {
  addition: [/\+/, /더하기/, /덧셈/],
  subtraction: [/-\s*\d/, /빼기/, /뺄셈/],
  multiplication: [/×/, /곱하기/, /곱셈/, /씩\s*\d+개(?:면|이면|일 때)/],
  division: [/÷/, /나누기/, /나눗셈/],
};

function detectOpsInText(text: string): Set<string> {
  const found = new Set<string>();
  for (const [op, patterns] of Object.entries(OP_KEYWORDS)) {
    if (patterns.some((p) => p.test(text))) found.add(op);
  }
  return found;
}

function expectedOpFromTopic(unit: string, topic: string): string | null {
  const t = `${unit} ${topic}`;
  if (/(받아올림|덧셈|더하기)/.test(t)) return 'addition';
  if (/(받아내림|뺄셈|빼기)/.test(t)) return 'subtraction';
  if (/(곱셈|곱하기|구구)/.test(t)) return 'multiplication';
  if (/(나눗셈|나누기)/.test(t)) return 'division';
  return null;
}

export function validateMathActivityOperationAlignment(
  input: LegacyValidationInput,
  doc: LearningDocument,
): LegacyCheck {
  if (
    input.subject !== 'MATH' ||
    (input.materialType !== 'individual_activity' && input.materialType !== 'individual_worksheet')
  ) {
    return { ok: true };
  }
  const expectedOp = expectedOpFromTopic(input.unit, input.topic);
  if (!expectedOp) return { ok: true };

  const activityIndices: number[] = [];
  doc.sections.forEach((s, i) => {
    if (s.kind === 'activity') activityIndices.push(i);
  });

  for (let a = 0; a < activityIndices.length; a += 1) {
    const start = activityIndices[a]!;
    const end = a + 1 < activityIndices.length ? activityIndices[a + 1]! : doc.sections.length;
    const blockTexts: string[] = [];
    for (let j = start; j < end; j += 1) {
      const sec = doc.sections[j]!;
      if (sec.kind === 'paragraph') blockTexts.push(sec.text);
      else if (sec.kind === 'activity') {
        if (sec.title) blockTexts.push(sec.title);
        blockTexts.push(...sec.steps);
      } else if (sec.kind === 'table') {
        for (const row of sec.rows) blockTexts.push(...row);
        if (sec.headers) blockTexts.push(...sec.headers);
      } else if (sec.kind === 'worksheet-table') {
        blockTexts.push(...sec.headers);
        if (sec.caption) blockTexts.push(sec.caption);
      } else if (sec.kind === 'heading') {
        blockTexts.push(sec.text);
      }
    }
    const combined = blockTexts.join(' \n ');
    const opsFound = detectOpsInText(combined);
    if (opsFound.size === 0) continue;
    for (const op of opsFound) {
      if (op !== expectedOp) {
        return {
          ok: false,
          reason: `활동 ${a + 1}이(가) 주제 "${input.topic}" 과 다른 연산 (${op}) 사용 — 활동별 topic 불일치`,
        };
      }
    }
  }
  return { ok: true };
}

// ============================================================
// legacy 전체 실행 — 첫 실패 반환
// ============================================================
function countSections(sections: Section[]): {
  questions: number;
  activities: number;
  answerKeys: number;
  worksheetElements: number;
} {
  let questions = 0;
  let activities = 0;
  let answerKeys = 0;
  let worksheetElements = 0;
  for (const s of sections) {
    if (s.kind === 'question') questions += 1;
    else if (s.kind === 'activity') activities += 1;
    else if (s.kind === 'answer-key') answerKeys += 1;
    else if (s.kind === 'worksheet-table' || s.kind === 'blank-space') worksheetElements += 1;
  }
  return { questions, activities, answerKeys, worksheetElements };
}

export function runLegacyValidators(
  input: LegacyValidationInput,
  doc: LearningDocument,
): LegacyCheck {
  const counts = countSections(doc.sections);

  if (input.materialType === 'multiple_choice' || input.materialType === 'ox_quiz') {
    if (counts.questions !== input.questionCount) {
      return {
        ok: false,
        reason: `요청 문항 수 ${input.questionCount} 개인데 실제 ${counts.questions} 개 생성됨`,
      };
    }
  } else if (
    input.materialType === 'individual_activity' ||
    input.materialType === 'individual_worksheet'
  ) {
    if (counts.activities !== input.questionCount) {
      return {
        ok: false,
        reason: `요청 활동 수 ${input.questionCount} 개인데 실제 ${counts.activities} 개 생성됨`,
      };
    }
    if (counts.worksheetElements === 0) {
      return {
        ok: false,
        reason: '개별 활동지에 학생 작성 요소 (worksheet-table 또는 blank-space) 가 없음',
      };
    }
  }

  if (input.materialType === 'multiple_choice' || input.materialType === 'ox_quiz') {
    const questions = doc.sections.filter(
      (s): s is QuestionSection => s.kind === 'question',
    );
    for (let i = 0; i < questions.length; i += 1) {
      const check = validateMultipleChoice(questions[i]!, i);
      if (!check.ok) return check;
    }
    const setCheck = validateQuestionSet(questions);
    if (!setCheck.ok) return setCheck;
  }

  const alignCheck = validateSubjectTopicAlignment(input, doc);
  if (!alignCheck.ok) return alignCheck;

  const selfContainedCheck = validateSelfContained(doc);
  if (!selfContainedCheck.ok) return selfContainedCheck;

  if (input.materialType === 'multiple_choice') {
    const questions = doc.sections.filter(
      (s): s is QuestionSection => s.kind === 'question',
    );
    const hintCheck = validateHintDoesNotRevealAnswer(questions);
    if (!hintCheck.ok) return hintCheck;
  }

  const opCheck = validateMathActivityOperationAlignment(input, doc);
  if (!opCheck.ok) return opCheck;

  const firstHeadingText =
    (doc.sections.find(
      (s): s is Extract<Section, { kind: 'heading' }> =>
        s.kind === 'heading' && s.level === 1,
    )?.text) ?? '';
  const titleAndFirstHeading = [doc.meta.title, firstHeadingText].filter(Boolean).join(' ');
  const unitToken = input.unit.split(/[·\s]/)[0]?.trim() ?? input.unit;
  const topicToken = input.topic.split(/[·\s]/)[0]?.trim() ?? input.topic;
  const hasUnit = titleAndFirstHeading.includes(unitToken);
  const hasTopic = titleAndFirstHeading.includes(topicToken);
  if (!hasUnit && !hasTopic) {
    return {
      ok: false,
      reason: `단원 "${input.unit}" 이나 주제 "${input.topic}" 이 제목에 반영되지 않음`,
    };
  }

  return { ok: true };
}
