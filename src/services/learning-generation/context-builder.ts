// GenerationContext 조립기 (V2 최소 스코프).
//
// 원칙:
//   - 특정 과목·단원·주제 문자열로 코드가 갈라지지 않는다.
//   - LearningProfile 데이터 (5-scope 병합 결과) 를 그대로 컨텍스트에 담는다.
//   - subject/domain/unit/topic 는 값으로 전달 (하드코딩 아님).
//   - 프로필이 없거나 EMPTY 이면 caller (handler) 가 V1 폴백을 선택한다.

import {
  resolveLearningProfile,
  type ResolvedLearningProfile,
} from '@/services/learning-profile';

import { SUBJECT_LABEL } from '@/features/learning-helper/domain/subjects';
import type { SubjectCode } from '@/features/learning-helper/domain/subjects';
import type { MaterialTypeCode } from '@/features/learning-helper/domain/material-types';
import { materialTypeLabel } from '@/features/learning-helper/domain/material-types';

export interface GenerationContextInput {
  grade: number;
  subject: SubjectCode;
  materialType: MaterialTypeCode;
  unit: string;
  topic: string;
  questionCount: number;
  difficulty: 'easy' | 'normal' | 'hard';
  additionalRequest?: string;
}

export interface GenerationContext {
  learner: {
    grade: number;
    vocabularyLevel?: string;
  };
  curriculum: {
    subject: string;
    subjectLabel: string;
    unit: string;
    topic: string;
    learningGoals: Array<{ code: string; description: string; required: boolean }>;
    allowedScope: Array<{ key: string; description?: string }>;
    excludedScope: Array<{ key: string; description?: string }>;
    profileChain: Array<{ scopeType: string; title: string }>;
  };
  material: {
    type: string;
    typeLabel: string;
  };
  request: {
    amount: number;
    difficulty: string;
    additionalInstructions?: string;
  };
  qualityRubric: {
    criteria: Array<{ key: string; label?: string; instruction: string }>;
  };
  /** 감사·표시용 — 프로필이 실제로 조회됐는지. false 면 caller 가 V1 폴백 결정. */
  hasActiveProfile: boolean;
  /** 표시용 — 사용자에게 노출할 프로필 요약 문자열. */
  appliedProfileSummary: string;
}

/** 6개 범용 루브릭 (subject-invariant). 프로필의 semanticCriteria 와 병합됨. */
const UNIVERSAL_RUBRIC = [
  {
    key: 'goalCoverage',
    label: '학습 목표 부합',
    instruction: '요청한 학습 목표를 실제로 다루는가?',
  },
  {
    key: 'gradeSuitability',
    label: '학년 적합성',
    instruction: '해당 학년 학생이 이해하고 수행할 수 있는가?',
  },
  {
    key: 'materialFit',
    label: '자료유형 적합',
    instruction: '자료유형의 교육적 목적에 맞는가?',
  },
  {
    key: 'selfContained',
    label: '자기완결성',
    instruction: '외부 정보 없이 문제를 이해할 수 있는가?',
  },
  {
    key: 'internalConsistency',
    label: '내적 일관성',
    instruction: '내용·정답·설명이 서로 모순되지 않는가?',
  },
  {
    key: 'diversity',
    label: '구성 다양성',
    instruction: '반복적이거나 편향된 구성이 아닌가?',
  },
];

/**
 * Build a GenerationContext from a user request and the merged LearningProfile.
 *
 * The context is a pure data structure. No subject/topic-specific branching happens
 * here — every field is filled by looking up data (profile / labels / rubric).
 */
export async function buildGenerationContext(
  input: GenerationContextInput,
): Promise<GenerationContext> {
  let profile: ResolvedLearningProfile;
  try {
    profile = await resolveLearningProfile({
      subjectCode: input.subject,
      grade: input.grade,
      unitName: input.unit,
    });
  } catch (err) {
    console.warn('[context-builder] profile resolve failed, treating as no profile:', err);
    profile = {
      profileSetCode: '(unresolved)',
      scopeChain: [],
      learningGoals: [],
      allowedScope: [],
      excludedScope: [],
      vocabularyGuidance: {},
      contentGuidance: {},
      deterministicRules: {},
      semanticCriteria: [],
    };
  }

  const hasActiveProfile = profile.scopeChain.length > 0;

  // Vocabulary level derived from profile data if present, otherwise generic hint.
  const vocab = profile.vocabularyGuidance;
  const vocabParts: string[] = [];
  if (vocab.readingLevel) vocabParts.push(vocab.readingLevel);
  if (vocab.maxSentenceLength) vocabParts.push(`한 문장 ${vocab.maxSentenceLength}자 이내`);
  const vocabularyLevel = vocabParts.length > 0 ? vocabParts.join(', ') : undefined;

  // Semantic criteria: profile + universal rubric (unique by key, profile wins).
  const mergedCriteria = new Map<string, { key: string; label?: string; instruction: string }>();
  for (const c of UNIVERSAL_RUBRIC) mergedCriteria.set(c.key, c);
  for (const c of profile.semanticCriteria) {
    mergedCriteria.set(c.key, { key: c.key, label: c.label, instruction: c.instruction });
  }

  const subjectLabel = SUBJECT_LABEL[input.subject as 'KOR' | 'MATH'] ?? input.subject;
  const typeLabel = materialTypeLabel(
    input.materialType as
      | 'multiple_choice'
      | 'individual_activity'
      | 'ox_quiz'
      | 'concept_summary'
      | 'reading_material',
  );

  const profileChain = profile.scopeChain.map((s) => ({
    scopeType: s.scopeType,
    title: s.title,
  }));

  const appliedProfileSummary = hasActiveProfile
    ? profile.scopeChain.map((s) => s.title).join(' → ')
    : '(활성 프로필 없음)';

  return {
    learner: {
      grade: input.grade,
      vocabularyLevel,
    },
    curriculum: {
      subject: input.subject,
      subjectLabel,
      unit: input.unit,
      topic: input.topic,
      learningGoals: profile.learningGoals.map((g) => ({
        code: g.code,
        description: g.description,
        required: g.required,
      })),
      allowedScope: profile.allowedScope.map((r) => ({ key: r.key, description: r.description })),
      excludedScope: profile.excludedScope.map((r) => ({ key: r.key, description: r.description })),
      profileChain,
    },
    material: {
      type: input.materialType,
      typeLabel,
    },
    request: {
      amount: input.questionCount,
      difficulty: input.difficulty,
      additionalInstructions: input.additionalRequest,
    },
    qualityRubric: {
      criteria: Array.from(mergedCriteria.values()),
    },
    hasActiveProfile,
    appliedProfileSummary,
  };
}
