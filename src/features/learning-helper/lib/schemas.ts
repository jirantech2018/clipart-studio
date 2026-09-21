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
  // M2-1 (v0.5): 단원과 주제 필드 분리. AI 프롬프트에는 둘 다 전달.
  unit: z.string().min(1).max(80),
  topic: z.string().min(2).max(80),
  questionCount: z.number().int().min(1).max(20).default(5),
  difficulty: z.enum(['easy', 'normal', 'hard']).default('normal'),
  additionalRequest: z.string().max(300).optional(),
  /**
   * 클립아트 자동 삽입 모드.
   *   - 'auto': ContentPlan 이 학습 목표와 문항 구성에 따라 시각자료를 적극적으로 설계.
   *             교육적으로 도움이 되지 않는 문항만 visualPlan=null 허용.
   *   - 'none': 이미지 없이 텍스트만.
   * 기본값 'auto' (UI 에 자동 삽입이 기본 선택됨).
   */
  clipartMode: z.enum(['auto', 'none']).default('auto'),
  /**
   * Stage 4.4: 렌더 방식.
   * 사용자 요청으로 UI 선택 옵션은 제거됐고, 기본값을 'ai_designed' 로 고정.
   * 'standard' 는 legacy 호환용으로 스키마에 남겨두되 클라이언트는 전송하지 않는다.
   */
  renderMode: z.enum(['standard', 'ai_designed']).default('ai_designed'),
});

export type CreateLearningDocumentInput = z.infer<typeof createLearningDocumentSchema>;

export const recommendationsSchema = z.object({
  grade: gradeSchema,
  subject: subjectSchema,
  materialType: materialTypeSchema,
});

export type RecommendationsInput = z.infer<typeof recommendationsSchema>;
