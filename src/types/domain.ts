// Domain types — pure, no external dependencies
// Design Ref: §3.1 Entity Definition

export type AccountType = 'teacher' | 'student' | 'school' | 'school_staff' | 'general';
export type SchoolLevel = 'kindergarten' | 'elementary' | 'middle' | 'high' | 'other';
export type ImageStatus = 'pending' | 'saved' | 'discarded';

// 이미지의 접근 범위. 각 값은 누적적 (public 이 가장 넓음):
//   private       - 소유자만
//   organization  - 소유자 + image_organization_shares 로 공유받은 조직의 active 멤버
//   authenticated - 로그인 회원 누구나 (링크 있어야; unlisted)
//   public        - 로그인 회원 누구나 (검색·발견 대상; listed)
// Community 페이지 노출 여부는 별도 boolean `isOnCommunity` 로 결정.
export type ImageVisibility = 'private' | 'organization' | 'authenticated' | 'public';
export type GenerationMode = 'text2img' | 'img2img' | 'upscale';

// Organization 도메인 (P5)
export type OrganizationRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type OrganizationMemberStatus = 'active' | 'suspended';

export interface Organization {
  id: string;
  slug: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  homepageUrl: string | null;
  ownerId: string;
  maxVisibility: ImageVisibility;
  /** 조직 (=학교) 학교급. AI 생성 스타일 힌트로 사용. */
  schoolLevel: SchoolLevel | null;
  /** 조직 컨텍스트 생성 시 프롬프트 앞에 붙일 학교 기본 설명. */
  basePrompt: string | null;
  /** 조직 컨텍스트에서 학교 스타일 (base_prompt 등) 적용 여부. */
  styleEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// 내가 속한 조직 목록에서 각 항목에 내 role 을 함께 실어 보낸다.
export interface OrganizationWithMyRole extends Organization {
  myRole: OrganizationRole;
  memberCount: number;
}

// 조직 멤버 상세 — 멤버 관리 페이지에서 표시.
export interface OrganizationMember {
  userId: string;
  email: string;
  accountType: AccountType;
  role: OrganizationRole;
  status: OrganizationMemberStatus;
  joinedAt: string;
  isMe: boolean;
}

// 조직 초대 (pending or accepted). 관리 페이지에서 pending 목록 표시.
export interface OrganizationInvite {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationRole;
  invitedBy: string;
  token: string;
  inviteUrl: string; // 클라이언트 편의를 위해 서버에서 조립해 내려줌
  expiresAt: string;
  createdAt: string;
}

// 초대 링크 진입 시 로그인한 사용자에게 미리 보여주는 요약 정보.
export interface InvitePreview {
  organizationName: string;
  organizationSlug: string;
  role: OrganizationRole;
  inviterEmail: string | null;
  targetEmail: string;
  expiresAt: string;
  expired: boolean;
  alreadyMember: boolean; // 로그인 사용자가 지금 이 조직의 active 멤버
  alreadyAccepted: boolean; // 초대 자체가 이미 사용됨 (accepted_at 세팅)
  emailMismatch: boolean; // 로그인 사용자 이메일 ≠ 초대 대상 이메일
}
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
  kindergarten: '유치원',
  elementary: '초등학교',
  middle: '중학교',
  high: '고등학교',
  other: '특수학교 · 기타',
};

/** 조직 설정 폼의 학교급 버튼 그룹 표시 순서. */
export const SCHOOL_LEVEL_ORDER: SchoolLevel[] = [
  'kindergarten',
  'elementary',
  'middle',
  'high',
  'other',
];

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
  visibility: ImageVisibility;
  isOnCommunity: boolean;
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

// Image Knowledge CMS — 이미지 생성 파이프라인의 유일한 시스템 지식 소스.
// 고정 카테고리 없이 트리거 태그로 매칭한다.

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
  /** 자유 입력 카테고리. 빈 문자열은 "미분류". */
  category: string;
  /** 카테고리 내 정렬 순서 (작을수록 위). */
  sortOrder: number;
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

