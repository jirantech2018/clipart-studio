// Domain types — pure, no external dependencies
// Design Ref: §3.1 Entity Definition

export type AccountType = 'teacher' | 'student' | 'school' | 'school_staff' | 'general';
export type SchoolLevel = 'elementary' | 'middle' | 'high';
export type ImageStatus = 'pending' | 'saved' | 'discarded';
export type GenerationMode = 'text2img' | 'img2img' | 'upscale';
export type JobStatus = 'queued' | 'running' | 'partial' | 'done' | 'failed';
export type ImageModel = 'gpt-image-2' | 'gpt-image-1' | 'flux-schnell';

export interface Profile {
  id: string;
  email: string;
  accountType: AccountType;
  credits: number;
  creditsResetAt: string | null;
  createdAt: string;
}

export interface SchoolProfile {
  userId: string;
  schoolName: string;
  homepageUrl: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  mascotDesc: string | null;
  mascotRefUrl: string | null;
  buildingRefUrl: string | null;
  styleDesc: string | null;
  basePrompt: string | null;
  schoolLevel: SchoolLevel | null;
  updatedAt: string;
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  teacher: '선생님',
  student: '학생',
  school: '학교',
  school_staff: '학교 관계자',
  general: '일반',
};

export const SCHOOL_LEVEL_LABELS: Record<SchoolLevel, string> = {
  elementary: '초등학교',
  middle: '중학교',
  high: '고등학교',
};

export const ACCOUNT_TYPE_BADGE: Record<AccountType, string> = {
  teacher: '👤',
  student: '🎒',
  school: '🏫',
  school_staff: '🏫',
  general: '👤',
};

export interface Image {
  id: string;
  userId: string;
  prompt: string;
  negativePrompt: string | null;
  model: ImageModel;
  seed: number | null;
  r2Key: string;
  thumbnailR2Key: string | null;
  isPublic: boolean;
  isUpscaled: boolean;
  upscaledFromId: string | null;
  parentImageId: string | null;
  batchId: string | null;
  generationMode: GenerationMode;
  referenceImageId: string | null;
  schoolProfileApplied: boolean;
  status: ImageStatus;
  pendingExpiresAt: string | null;
  width: number;
  height: number;
  createdAt: string;
}

export interface GenerationJob {
  id: string;
  userId: string;
  prompt: string;
  batchSize: number;
  diversityLevel: number;
  referenceImageId: string | null;
  customReferenceR2Key: string | null;
  schoolProfileApplied: boolean;
  aspectRatio: AspectRatio;
  reservedCredits: number;
  refundedCredits: number;
  status: JobStatus;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ReferenceImageSlot {
  id: string;
  userId: string;
  r2Key: string;
  url: string;
  filename: string | null;
  width: number;
  height: number;
  createdAt: string;
}

export const REFERENCE_IMAGE_SLOT_LIMIT = 5;

export type PromptRuleCategory =
  | 'global'
  | 'school'
  | 'location'
  | 'style'
  | 'task'
  | 'context'
  | 'negative';

export const PROMPT_RULE_CATEGORIES: PromptRuleCategory[] = [
  'global',
  'school',
  'location',
  'style',
  'task',
  'context',
  'negative',
];

export const PROMPT_RULE_CATEGORY_LABELS: Record<PromptRuleCategory, string> = {
  global: 'Global',
  school: 'School',
  location: 'Location',
  style: 'Style',
  task: 'Task',
  context: 'Context',
  negative: 'Negative',
};

export interface PromptRule {
  id: string;
  name: string;
  category: PromptRuleCategory;
  tags: string[];
  priority: number;
  enabled: boolean;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// Image Knowledge CMS — Phase A domain types.
// prompt_rules 를 대체하는 새 구조. 고정 카테고리 없이 트리거 태그로 매칭한다.

export type ReferenceType = 'positive' | 'negative';

export const KNOWLEDGE_POSITIVE_IMAGE_LIMIT = 10;
export const KNOWLEDGE_NEGATIVE_IMAGE_LIMIT = 5;
/** 실제 이미지 생성 요청에 한 번에 전달할 positive 참고 이미지 최대 수. */
export const KNOWLEDGE_API_IMAGE_LIMIT = 5;

export interface KnowledgeImage {
  id: string;
  knowledgeId: string;
  r2Key: string;
  url: string;
  caption: string;
  viewpoint: string;
  referenceType: ReferenceType;
  isPrimary: boolean;
  sortOrder: number;
  width: number;
  height: number;
  filename: string | null;
  createdAt: string;
}

export interface Knowledge {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  negativePrompt: string;
  priority: number;
  enabled: boolean;
  images: KnowledgeImage[];
  createdAt: string;
  updatedAt: string;
}

// gpt-image-1 supports these three sizes. The user picks the semantic label,
// pipeline.ts maps it to the WxH string expected by the API.
export type AspectRatio = 'square' | 'landscape' | 'portrait';
export const ASPECT_RATIOS = ['square', 'landscape', 'portrait'] as const;

export const ASPECT_RATIO_LABELS: Record<AspectRatio, string> = {
  square: '정사각',
  landscape: '가로형',
  portrait: '세로형',
};

export const ASPECT_RATIO_DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  square: { width: 1024, height: 1024 },
  landscape: { width: 1536, height: 1024 },
  portrait: { width: 1024, height: 1536 },
};

export function aspectRatioSizeString(ratio: AspectRatio): string {
  const { width, height } = ASPECT_RATIO_DIMENSIONS[ratio];
  return `${width}x${height}`;
}

// Batch presets shown as one-click chips in the form. Users can also type any
// integer between 1 and MAX_BATCH_SIZE for finer control.
export const BATCH_SIZE_PRESETS = [1, 2, 5, 10] as const;
export const MIN_BATCH_SIZE = 1;
export const MAX_BATCH_SIZE = 50;
export type BatchSize = number;
export const CHUNK_SIZE = 5;

