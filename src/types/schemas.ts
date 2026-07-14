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
