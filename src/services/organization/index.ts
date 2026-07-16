// Organization service layer — DB row ↔ domain 매핑 + 공통 조회 헬퍼.
// Design Ref: docs/02-design/features/organization.design.md v0.3

import type {
  ImageVisibility,
  Organization,
  OrganizationRole,
  OrganizationWithMyRole,
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
