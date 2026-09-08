// kind='learning_doc' job handler.
//
// 흐름:
//   1) orchestrator 호출 → LearningDocument JSON 생성
//   2) 요청과 결과 semantic 검증 (block 개수 · 학생용 정답 부재 · 단원·주제 반영)
//   3) 불일치 시 1회 자동 재생성. 두 번 다 실패면 예외.
//   4) learning_documents INSERT (service role)
//   5) generation_jobs.learning_document_id 업데이트 + status='done'
//   6) LearningDocument + documentId 반환
//
// 실패 시 예외를 던진다. 크레딧 환불·job 정리는 호출자(API route) 책임.

import {
  generateLearningDocument,
  LearningOrchestratorError,
  type GenerateResult,
} from '@/services/learning-orchestrator';
import type { OrchestratorInput } from '@/services/learning-orchestrator/prompts';
import type { LearningDocument, Section } from '@/services/learning-renderer/schema';
import { createSupabaseServiceClient } from '@/services/supabase/server';

import {
  extractTargetJamoFromStem,
  findChoicesContainingJamo,
} from '@/features/learning-helper/lib/hangul';

export interface LearningDocJobInput extends OrchestratorInput {
  jobId: string;
  userId: string;
  organizationId: string;
}

export interface LearningDocJobResult {
  documentId: string;
  document: LearningDocument;
  usage?: GenerateResult['rawUsage'];
}

// ============================================================
// 요청/결과 semantic 검증
// ============================================================
type QuestionSection = Extract<Section, { kind: 'question' }>;

/** answer 문자열에서 정답 번호 파싱 ("2", "2번", "2)", "2. …" 등). */
function parseAnswerIndex(answer: string, totalChoices: number): number | null {
  const m = answer.trim().match(/^(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1 || n > totalChoices) return null;
  return n - 1; // 0-based
}

/** 객관식 문항 하나의 정답·중복·자모 검증. */
function validateMultipleChoice(
  q: QuestionSection,
  questionIndex: number,
): { ok: true } | { ok: false; reason: string } {
  if (q.qtype !== 'mc' && q.qtype !== 'ox') return { ok: true };
  const choices = q.choices ?? [];

  // OX 는 선택지 2개 고정, 정답 O/X.
  if (q.qtype === 'ox') {
    if (!q.answer || !/^[OX]$/i.test(q.answer.trim())) {
      return { ok: false, reason: `${questionIndex + 1}번 문항: OX answer 형식 오류` };
    }
    return { ok: true };
  }

  // 객관식 (mc): 선택지 최소 3개 이상
  if (choices.length < 3) {
    return {
      ok: false,
      reason: `${questionIndex + 1}번 문항: 선택지가 ${choices.length}개 (최소 3개 필요)`,
    };
  }

  // 1) 중복 선택지 검사 (공백/구두점 제거 후 비교)
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

  // 2) 정답 번호 파싱 및 범위 검증
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

  // 3) 자모 유형이면 코드로 정답 검증
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

function validateSemantic(
  input: OrchestratorInput,
  doc: LearningDocument,
): { ok: true } | { ok: false; reason: string } {
  const counts = countSections(doc.sections);

  // 1) 자료유형별 amount 대비 실제 block 개수 일치
  if (input.materialType === 'multiple_choice' || input.materialType === 'ox_quiz') {
    if (counts.questions !== input.questionCount) {
      return {
        ok: false,
        reason: `요청 문항 수 ${input.questionCount} 개인데 실제 ${counts.questions} 개 생성됨`,
      };
    }
  } else if (input.materialType === 'individual_activity') {
    if (counts.activities !== input.questionCount) {
      return {
        ok: false,
        reason: `요청 활동 수 ${input.questionCount} 개인데 실제 ${counts.activities} 개 생성됨`,
      };
    }
    // 개별 활동지는 학생 작성 요소 (worksheet-table or blank-space) 최소 1개 필요
    if (counts.worksheetElements === 0) {
      return {
        ok: false,
        reason: '개별 활동지에 학생 작성 요소 (worksheet-table 또는 blank-space) 가 없음',
      };
    }
  }

  // 2) 객관식·OX 각 문항 검증 (정답 1개·번호 매칭·중복·자모)
  if (input.materialType === 'multiple_choice' || input.materialType === 'ox_quiz') {
    const questions = doc.sections.filter(
      (s): s is QuestionSection => s.kind === 'question',
    );
    for (let i = 0; i < questions.length; i += 1) {
      const check = validateMultipleChoice(questions[i]!, i);
      if (!check.ok) return check;
    }
  }

  // 3) 단원·주제가 title 또는 첫 heading 에 반영됐는지 (부분 문자열 포함 기준, 관대)
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

export async function runLearningDocJob(
  input: LearningDocJobInput,
): Promise<LearningDocJobResult> {
  const service = createSupabaseServiceClient();

  // 1) job 상태 running 으로 전환.
  await service
    .from('generation_jobs')
    .update({ status: 'running' })
    .eq('id', input.jobId);

  // 2) AI 호출 + semantic 검증. 불일치 시 1회 자동 재생성.
  let attempt = 0;
  let result: GenerateResult;
  let lastReason = '';
  while (true) {
    attempt += 1;
    result = await generateLearningDocument(input);
    const check = validateSemantic(input, result.document);
    if (check.ok) break;
    lastReason = check.reason;
    if (attempt >= 2) {
      throw new LearningOrchestratorError(
        'SCHEMA_ERROR',
        `AI 결과가 요청과 일치하지 않아요 (재시도 후에도 실패): ${lastReason}`,
      );
    }
    // 재시도 전 잠깐 대기 (rate limit / transient issue 대응)
    await new Promise((r) => setTimeout(r, 500));
  }
  const doc = result.document;

  // 3) learning_documents INSERT (service role 로 RLS 우회, user_id/organization_id
  //    는 이미 API route 에서 인증됨).
  // M2-1 (v0.5): unit + topic 두 필드를 하나의 topic 컬럼에 concat 저장.
  // 별도 unit 컬럼은 M2-3 이후 검토 (지금은 스키마 마이그레이션 미필요).
  const topicForStorage = `${input.unit} · ${input.topic}`;

  const { data: docRow, error: docErr } = await service
    .from('learning_documents')
    .insert({
      user_id: input.userId,
      organization_id: input.organizationId,
      title: doc.meta.title,
      grade: input.grade,
      subject_code: input.subject,
      material_type_code: input.materialType,
      topic: topicForStorage,
      difficulty: input.difficulty,
      question_count: input.questionCount,
      document_json: doc,
    })
    .select('id')
    .single();

  if (docErr || !docRow) {
    throw new Error(`learning_documents insert 실패: ${docErr?.message ?? 'unknown'}`);
  }

  const documentId = (docRow as { id: string }).id;

  // 4) job 완료 표시 + FK 링크.
  await service
    .from('generation_jobs')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
      learning_document_id: documentId,
    })
    .eq('id', input.jobId);

  return {
    documentId,
    document: doc,
    usage: result.rawUsage,
  };
}
