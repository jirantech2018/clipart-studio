// Organization service layer — DB row ↔ domain 매핑 + 공통 조회 헬퍼.
// Design Ref: docs/02-design/features/organization.design.md v0.3

import type {
  ImageVisibility,
  Organization,
  OrganizationRole,
  OrganizationWithMyRole,
  SchoolLevel,
} from '@/types/domain';

export interface OrganizationRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  avatar_url: string | null;
  homepage_url: string | null;
  owner_id: string;
  max_visibility: ImageVisibility;
  school_level: SchoolLevel | null;
  base_prompt: string | null;
  style_enabled: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function organizationRowToDomain(row: OrganizationRow): Organization {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? '',
    avatarUrl: row.avatar_url,
    homepageUrl: row.homepage_url,
    ownerId: row.owner_id,
    maxVisibility: row.max_visibility,
    schoolLevel: row.school_level,
    basePrompt: row.base_prompt,
    styleEnabled: row.style_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function withMyRole(
  org: Organization,
  myRole: OrganizationRole,
  memberCount: number,
): OrganizationWithMyRole {
  return { ...org, myRole, memberCount };
}

// 활동 로그 종류. Migration 033 의 org_activity_type enum 과 정확히 일치해야 함.
export type OrgActivityType =
  | 'organization_created'
  | 'organization_updated'
  | 'member_invited'
  | 'member_joined'
  | 'member_removed'
  | 'member_role_changed'
  | 'invite_revoked'
  | 'image_shared'
  | 'image_unshared'
  | 'image_visibility_changed';
