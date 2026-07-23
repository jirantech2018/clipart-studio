// Single organization: get / update / soft-delete.
//
// GET    /api/organizations/[slug]  — member+ 만 조회 (RLS)
// PATCH  /api/organizations/[slug]  — admin+ 만 (RLS + API 추가 검증)
// DELETE /api/organizations/[slug]  — owner 만 soft delete (deleted_at 세팅)

import { ZodError } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import {
  organizationRowToDomain,
  withMyRole,
  type OrganizationRow,
} from '@/services/organization';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';
import { updateOrganizationSchema } from '@/types/schemas';

import type { OrganizationRole } from '@/types/domain';

async function loadOrgAndRole(slug: string, userId: string) {
  const supabase = createSupabaseServerClient();
  const { data: org, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !org) return { org: null as OrganizationRow | null, role: null };

  const { data: member } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', (org as { id: string }).id)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  return {
    org: org as OrganizationRow,
    role: (member?.role as OrganizationRole | undefined) ?? null,
  };
}

async function memberCount(orgId: string): Promise<number> {
  const supabase = createSupabaseServerClient();
  const { count } = await supabase
    .from('organization_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('status', 'active');
  return count ?? 0;
}

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { org, role } = await loadOrgAndRole(params.slug, user.id);
  if (!org || !role) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');

  const count = await memberCount(org.id);
  return apiOk({
    organization: withMyRole(organizationRowToDomain(org), role, count),
  });
}

export async function PATCH(request: Request, { params }: { params: { slug: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { org, role } = await loadOrgAndRole(params.slug, user.id);
  if (!org || !role) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  // P5-D-B: 명시적으로 owner 만 허용. 036 이후 admin 은 발급되지 않지만
  // 향후 역할 확장 시에도 조직 설정은 owner 전용으로 유지.
  if (role !== 'owner') {
    return apiError('FORBIDDEN', '조직 어드민만 수정할 수 있어요');
  }

  let body;
  try {
    body = updateOrganizationSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.description !== undefined) update.description = body.description;
  if (body.homepageUrl !== undefined) update.homepage_url = body.homepageUrl;
  if (body.avatarUrl !== undefined) update.avatar_url = body.avatarUrl;
  if (body.maxVisibility !== undefined) update.max_visibility = body.maxVisibility;
  if (body.schoolLevel !== undefined) update.school_level = body.schoolLevel;
  if (body.basePrompt !== undefined) update.base_prompt = body.basePrompt;
  if (body.styleEnabled !== undefined) update.style_enabled = body.styleEnabled;

  if (Object.keys(update).length === 0) {
    const count = await memberCount(org.id);
    return apiOk({
      organization: withMyRole(organizationRowToDomain(org), role, count),
    });
  }

  const { data: updated, error: updateError } = await supabase
    .from('organizations')
    .update(update)
    .eq('id', org.id)
    .select('*')
    .single();

  if (updateError || !updated) {
    console.error('[organizations PATCH] update error', updateError);
    return apiError('INTERNAL_ERROR', '조직 정보 수정 실패');
  }

  // 활동 로그
  const service = createSupabaseServiceClient();
  await service.from('organization_activity_logs').insert({
    organization_id: org.id,
    actor_user_id: user.id,
    activity_type: 'organization_updated',
    metadata: { updated_fields: Object.keys(update) },
  });

  const count = await memberCount(org.id);
  return apiOk({
    organization: withMyRole(
      organizationRowToDomain(updated as OrganizationRow),
      role,
      count,
    ),
  });
}

export async function DELETE(_req: Request, { params }: { params: { slug: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { org, role } = await loadOrgAndRole(params.slug, user.id);
  if (!org || !role) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  if (role !== 'owner') {
    return apiError('FORBIDDEN', '조직 삭제는 소유자만 할 수 있어요');
  }

  // Soft delete (deleted_at 세팅). 30일 유예 후 배치가 하드 삭제 예정.
  const { error: delError } = await supabase
    .from('organizations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', org.id);

  if (delError) {
    console.error('[organizations DELETE] soft delete error', delError);
    return apiError('INTERNAL_ERROR', '조직 삭제 실패');
  }

  return apiOk({ id: org.id, slug: org.slug });
}
