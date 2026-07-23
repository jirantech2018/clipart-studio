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

export const schoolLevelSchema = z.enum([
  'kindergarten',
  'elementary',
  'middle',
  'high',
  'other',
]);

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
    // P5-D-C: /generate?org=<slug> 컨텍스트에서 사용할 조직 정보.
    // orgSlug 가 있으면 그 조직의 base_prompt 를 소비하고 (styleEnabled 등은
    // 배제 — 조직 선택 자체가 apply 신호), orgReferenceId 가 있으면 그 조직
    // 참조 이미지를 img2img 참조로 사용한다.
    orgSlug: z.string().min(1).max(64).nullable().optional(),
    orgReferenceId: z.string().uuid().nullable().optional(),
  })
  .refine((data) => !(data.referenceImageId && data.customReferenceId), {
    message: '라이브러리 참조와 업로드 참조는 동시에 사용할 수 없어요',
    path: ['customReferenceId'],
  })
  .refine((data) => !(data.customReferenceId && data.orgReferenceId), {
    message: '개인·조직 참조 이미지는 동시에 사용할 수 없어요',
    path: ['orgReferenceId'],
  })
  .refine((data) => !(data.orgReferenceId && !data.orgSlug), {
    message: '조직 참조 이미지는 조직 컨텍스트에서만 사용할 수 있어요',
    path: ['orgReferenceId'],
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

// Organization (P5)
// Migration 033 의 CHECK constraint 와 정확히 동일한 규칙을 클라이언트에도 강제.
export const organizationRoleSchema = z.enum(['owner', 'admin', 'editor', 'viewer']);
export const imageVisibilitySchema = z.enum([
  'private',
  'organization',
  'authenticated',
  'public',
]);

// 조직 slug 예약어. 033 SQL 의 CHECK 와 동기화.
const RESERVED_ORG_SLUGS = new Set([
  'admin', 'api', 'auth', 'login', 'logout', 'signup',
  'settings', 'organization', 'organizations', 'library',
  'community', 'profile', 'account', 'help', 'support',
  'new', 'edit', 'invite', 'invites',
  'image', 'images', 'generate', 'onboarding', 'search',
  'callback', 'knowledge', 'dashboard',
  '_next', '_static', '_vercel',
  'sitemap', 'robots', 'favicon', 'manifest',
  'www', 'mail', 'ftp', 'ns1', 'ns2',
  'null', 'undefined',
]);

export const organizationSlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{2,63}$/, {
    message: '3~64자, 소문자·숫자·하이픈만 (첫 글자는 소문자/숫자)',
  })
  .refine((slug) => !RESERVED_ORG_SLUGS.has(slug), {
    message: '이 URL 이름은 예약되어 있어요. 다른 이름을 선택해주세요.',
  });

export const createOrganizationSchema = z.object({
  slug: organizationSlugSchema,
  name: z.string().trim().min(1, '조직 이름을 입력해주세요').max(100, '100자 이내'),
  description: z.string().max(500, '500자 이내').default(''),
  homepageUrl: z
    .string()
    .trim()
    .url('올바른 URL 형식이 아닙니다')
    .max(500)
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  homepageUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .nullable()
    .optional(),
  avatarUrl: z.string().trim().url().max(500).nullable().optional(),
  maxVisibility: imageVisibilitySchema.optional(),
  // P5-D-B: 학교 AI 생성 관련 필드도 조직 기본 정보의 일부로 통합.
  schoolLevel: schoolLevelSchema.nullable().optional(),
  basePrompt: z.string().max(2000).nullable().optional(),
  styleEnabled: z.boolean().optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

// 멤버 초대 (POST /api/organizations/[slug]/invites)
// role 은 P5-B 이후 UI 상 단일화되어 "멤버(editor)" 로만 발급됨. 스키마는
// 후방 호환을 위해 optional 로 두고 기본값 editor. admin/owner 로 초대
// 시도는 API 에서 별도 거부.
export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email('올바른 이메일 형식이 아닙니다').max(200),
  role: organizationRoleSchema.optional().default('editor'),
});

// 초대 수락 시 owner 지정은 불가 (Zod refine)
export const updateMemberRoleSchema = z.object({
  role: organizationRoleSchema,
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
