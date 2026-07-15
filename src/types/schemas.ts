// Zod schemas — shared between server and client
// Design Ref: §10.4 Convention (Zod for validation)

import { z } from 'zod';

export const accountTypeSchema = z.enum([
  'teacher',
  'student',
  'school',
  'school_staff',
  'general',
]);

export const schoolLevelSchema = z.enum(['elementary', 'middle', 'high']);

export const updateProfileSchema = z.object({
  accountType: accountTypeSchema.optional(),
});

export const schoolProfileSchema = z.object({
  schoolName: z.string().min(1, '학교명은 필수입니다').max(100),
  homepageUrl: z.string().url('올바른 URL이 아닙니다').optional().or(z.literal('')),
  logoUrl: z.string().url().nullable().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, '#RRGGBB 형식이어야 합니다')
    .nullable()
    .optional(),
  mascotDesc: z.string().max(500).nullable().optional(),
  mascotRefUrl: z.string().url().nullable().optional(),
  buildingRefUrl: z.string().url().nullable().optional(),
  styleDesc: z.string().max(500).nullable().optional(),
  basePrompt: z.string().max(1000).nullable().optional(),
  schoolLevel: schoolLevelSchema.nullable().optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type SchoolProfileInput = z.infer<typeof schoolProfileSchema>;

// Generation Job creation (POST /api/jobs)
export const generationModeSchema = z.enum(['text2img', 'img2img', 'upscale']);

export const aspectRatioSchema = z.enum(['square', 'landscape', 'portrait']);

export const createJobSchema = z
  .object({
    prompt: z.string().min(2, '프롬프트는 최소 2자').max(500, '프롬프트는 500자 이내'),
    batchSize: z
      .number()
      .int()
      .min(1, '배치 크기는 1장 이상')
      .max(50, '배치 크기는 최대 50장까지'),
    diversityLevel: z.number().int().min(0).max(5).default(0),
    referenceImageId: z.string().uuid().nullable().optional(),
    customReferenceId: z.string().uuid().nullable().optional(),
    schoolProfileApplied: z.boolean().default(true),
    generationMode: generationModeSchema.default('text2img'),
    aspectRatio: aspectRatioSchema.default('square'),
  })
  .refine((data) => !(data.referenceImageId && data.customReferenceId), {
    message: '라이브러리 참조와 업로드 참조는 동시에 사용할 수 없어요',
    path: ['customReferenceId'],
  });

export type CreateJobInput = z.infer<typeof createJobSchema>;

// Knowledge CMS — admin CRUD 입력 검증.
export const referenceTypeSchema = z.enum(['positive', 'negative']);

export const createKnowledgeSchema = z.object({
  name: z.string().min(1, '이름은 필수입니다').max(200, '이름은 200자 이내'),
  description: z
    .string()
    .min(1, '설명은 필수입니다')
    .max(20000, '설명은 20000자 이내'),
  triggers: z.array(z.string().min(1).max(100)).max(50).default([]),
  negativePrompt: z.string().max(5000, '금지 조건은 5000자 이내').default(''),
  category: z.string().max(100, '카테고리 이름은 100자 이내').default(''),
  sortOrder: z.number().int().min(0).max(100000).default(100),
  priority: z.number().int().min(0).max(10000).default(100),
  enabled: z.boolean().default(true),
});

export const updateKnowledgeSchema = createKnowledgeSchema.partial();

export type CreateKnowledgeInput = z.infer<typeof createKnowledgeSchema>;
export type UpdateKnowledgeInput = z.infer<typeof updateKnowledgeSchema>;

/**
 * knowledge_images 는 파일 업로드가 있으므로 별도 multipart 처리.
 * 이 스키마는 텍스트 필드만 검증 (이미지 자체는 route 에서 처리).
 */
export const updateKnowledgeImageSchema = z.object({
  caption: z.string().max(1000).optional(),
  viewpoint: z.string().max(100).optional(),
  referenceType: referenceTypeSchema.optional(),
  isPrimary: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

export type UpdateKnowledgeImageInput = z.infer<typeof updateKnowledgeImageSchema>;
