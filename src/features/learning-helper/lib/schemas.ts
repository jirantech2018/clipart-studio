// zod schemas for learning-helper API requests.

import { z } from 'zod';

import { isMaterialTypeCode } from '@/features/learning-helper/domain/material-types';
import { isSubjectCode } from '@/features/learning-helper/domain/subjects';

const gradeSchema = z.number().int().min(1).max(6);
const subjectSchema = z.string().refine(isSubjectCode, '지원하지 않는 과목입니다');
const materialTypeSchema = z
  .string()
  .refine(isMaterialTypeCode, '지원하지 않는 자료 유형입니다');

export const createLearningDocumentSchema = z.object({
  orgSlug: z.string().min(1),
  grade: gradeSchema,
  subject: subjectSchema,
  materialType: materialTypeSchema,
  topic: z.string().min(2).max(80),
  questionCount: z.number().int().min(1).max(20).default(5),
  difficulty: z.enum(['easy', 'normal', 'hard']).default('normal'),
  additionalRequest: z.string().max(300).optional(),
});

export type CreateLearningDocumentInput = z.infer<typeof createLearningDocumentSchema>;

export const recommendationsSchema = z.object({
  grade: gradeSchema,
  subject: subjectSchema,
  materialType: materialTypeSchema,
});

export type RecommendationsInput = z.infer<typeof recommendationsSchema>;
