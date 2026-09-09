// LearningProfile Zod 스키마.
// DB 저장 컬럼 (learning_profiles) 과 1:1 대응. JSONB 필드는 각각 세부 Zod.
//
// 병합 결과 (ResolvedLearningProfile) 는 여러 프로필의 계층 병합 결과.

import { z } from 'zod';

// ============================================================
// Sub schemas
// ============================================================

export const LearningGoalSchema = z.object({
  code: z.string().min(1),
  description: z.string().min(1),
  required: z.boolean().default(false),
});
export type LearningGoal = z.infer<typeof LearningGoalSchema>;

export const ScopeRuleSchema = z.object({
  key: z.string().min(1),
  description: z.string().optional(),
});
export type ScopeRule = z.infer<typeof ScopeRuleSchema>;

export const VocabularyGuidanceSchema = z.object({
  readingLevel: z.string().optional(),
  maxSentenceLength: z.number().int().positive().optional(),
  useConcreteVocabulary: z.boolean().optional(),
  avoid: z.array(z.string()).optional(),
  notes: z.array(z.string()).optional(),
});
export type VocabularyGuidance = z.infer<typeof VocabularyGuidanceSchema>;

export const ContentGuidanceSchema = z
  .object({
    tone: z.string().optional(),
    perspective: z.string().optional(),
    forbiddenTopics: z.array(z.string()).optional(),
  })
  .passthrough();
export type ContentGuidance = z.infer<typeof ContentGuidanceSchema>;

// 결정적 검증 규칙 — 코드가 직접 검산.
export const MultipleChoiceRulesSchema = z.object({
  choiceCount: z.number().int().min(2).max(6).optional(),
  requiredCorrectAnswerCount: z.number().int().min(1).default(1),
  allowDuplicateChoices: z.boolean().default(false),
});
export type MultipleChoiceRules = z.infer<typeof MultipleChoiceRulesSchema>;

export const NumberRangeSchema = z.object({
  min: z.number(),
  max: z.number(),
});
export type NumberRange = z.infer<typeof NumberRangeSchema>;

export const MathRulesSchema = z.object({
  operationSet: z
    .array(z.enum(['addition', 'subtraction', 'multiplication', 'division']))
    .optional(),
  numberRange: NumberRangeSchema.optional(),
  requiresCarry: z.boolean().optional(),
  allowsNegative: z.boolean().optional(),
  allowsDecimal: z.boolean().optional(),
});
export type MathRules = z.infer<typeof MathRulesSchema>;

export const DeterministicRulesSchema = z
  .object({
    multipleChoice: MultipleChoiceRulesSchema.optional(),
    math: MathRulesSchema.optional(),
  })
  .passthrough();
export type DeterministicRules = z.infer<typeof DeterministicRulesSchema>;

// 의미 검수 기준 — L3 AI 가 판정. instruction 은 프롬프트에 그대로 전달.
export const SemanticCriterionSchema = z.object({
  key: z.string().min(1),
  label: z.string().optional(),
  required: z.boolean().default(true),
  instruction: z.string().min(1),
});
export type SemanticCriterion = z.infer<typeof SemanticCriterionSchema>;

// ============================================================
// LearningProfile (DB row 대응)
// ============================================================
export const ScopeTypeSchema = z.enum([
  'curriculum',
  'grade_subject',
  'domain',
  'unit',
  'exception',
]);
export type ScopeType = z.infer<typeof ScopeTypeSchema>;

export const LearningProfileSchema = z.object({
  id: z.string().uuid(),
  profileSetId: z.string().uuid(),
  scopeType: ScopeTypeSchema,
  subjectCode: z.string().nullable(),
  domainId: z.string().uuid().nullable(),
  unitName: z.string().nullable(),
  gradeMin: z.number().int().min(1).max(6),
  gradeMax: z.number().int().min(1).max(6),
  title: z.string(),
  description: z.string().nullable(),
  learningGoals: z.array(LearningGoalSchema).default([]),
  prerequisites: z.array(z.unknown()).default([]),
  allowedScope: z.array(ScopeRuleSchema).default([]),
  excludedScope: z.array(ScopeRuleSchema).default([]),
  vocabularyGuidance: VocabularyGuidanceSchema.default({}),
  contentGuidance: ContentGuidanceSchema.default({}),
  deterministicRules: DeterministicRulesSchema.default({}),
  semanticCriteria: z.array(SemanticCriterionSchema).default([]),
  priority: z.number().int().default(0),
  status: z.enum(['draft', 'active', 'archived']),
  version: z.number().int().default(1),
});
export type LearningProfile = z.infer<typeof LearningProfileSchema>;

// ============================================================
// ResolvedLearningProfile — 여러 프로필 병합 결과
// ============================================================
export const ResolvedLearningProfileSchema = z.object({
  profileSetCode: z.string(),
  scopeChain: z.array(
    z.object({
      profileId: z.string().uuid(),
      scopeType: ScopeTypeSchema,
      title: z.string(),
      priority: z.number().int(),
      version: z.number().int(),
    }),
  ),
  learningGoals: z.array(LearningGoalSchema),
  allowedScope: z.array(ScopeRuleSchema),
  excludedScope: z.array(ScopeRuleSchema),
  vocabularyGuidance: VocabularyGuidanceSchema,
  contentGuidance: ContentGuidanceSchema,
  deterministicRules: DeterministicRulesSchema,
  semanticCriteria: z.array(SemanticCriterionSchema),
});
export type ResolvedLearningProfile = z.infer<typeof ResolvedLearningProfileSchema>;

// ============================================================
// Evaluation results (DB 저장 스키마와 대응)
// ============================================================
export const EvaluationItemResultSchema = z.object({
  itemId: z.string(),
  itemIndex: z.number().int().min(0),
  itemType: z.enum(['question', 'activity', 'table', 'blank_space', 'reading_passage', 'other']),
  criterionKey: z.string(),
  passed: z.boolean(),
  reason: z.string().nullable().optional(),
  severity: z.enum(['warning', 'error']).default('error'),
  repairAction: z
    .enum(['none', 'rewrite_item', 'replace_item', 'recalculate', 'manual_review'])
    .nullable()
    .optional(),
});
export type EvaluationItemResult = z.infer<typeof EvaluationItemResultSchema>;

export const EvaluationStageSchema = z.enum(['structure', 'deterministic', 'semantic', 'final']);
export type EvaluationStage = z.infer<typeof EvaluationStageSchema>;

export const EvaluationResultSchema = z.object({
  stage: EvaluationStageSchema,
  passed: z.boolean(),
  summary: z.string().optional(),
  evaluatorType: z.enum(['code', 'ai', 'hybrid']),
  evaluatorModel: z.string().optional(),
  items: z.array(EvaluationItemResultSchema).default([]),
  failedItemIds: z.array(z.string()).default([]),
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
  durationMs: z.number().int().min(0).optional(),
});
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;
