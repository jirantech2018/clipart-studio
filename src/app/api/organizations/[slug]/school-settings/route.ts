// Organization school AI settings (P5-D-B).
//
// GET  — 조직 active 멤버 조회 가능 (없으면 null 반환)
// PUT  — owner 만 upsert (organization_id PK). 최초 저장/이후 수정 모두 이 동사.
// DELETE — owner 만 (조직 학교 설정을 완전히 비움)
//
// 파일 업로드가 아닌 텍스트/enum 필드만. 참조 이미지·로고는 별도 route.

import { ZodError, z } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

import type { OrganizationRole, SchoolLevel } from '@/types/domain';

const schoolLevelEnum = z.enum(['elementary', 'middle', 'high']);

const bodySchema = z.object({
  schoolName: z.string().trim().min(1, '학교명은 필수예요').max(100),
  schoolLevel: schoolLevelEnum.nullable().optional(),
  homepageUrl: z
    .string()
    .trim()
    .url('올바른 URL 이 아니에요')
    .max(500)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  basePrompt: z.string().max(2000).nullable().optional(),
  styleEnabled: z.boolean().default(true),
});

interface SettingsRow {
  organization_id: string;
  school_name: string;
  homepage_url: string | null;
  school_level: SchoolLevel | null;
  mascot_desc: string | null;
  mascot_ref_url: string | null;
  building_ref_url: string | null;
  style_desc: string | null;
  base_prompt: string | null;
  style_enabled: boolean;
  updated_at: string;
}

function rowToDomain(row: SettingsRow) {
  return {
    organizationId: row.organization_id,
    schoolName: row.school_name,
    homepageUrl: row.homepage_url,
    schoolLevel: row.school_level,
    basePrompt: row.base_prompt,
    styleEnabled: row.style_enabled,
    updatedAt: row.updated_at,
  };
}

async function loadContext(slug: string, userId: string) {
  const supabase = createSupabaseServerClient();
  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .is('deleted_at', null)
    .maybeSingle();
  if (!org) return { orgId: null, role: null as OrganizationRole | null };
  const orgId = (org as { id: string }).id;

  const { data: me } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  return {
    orgId,
    role: (me?.role as OrganizationRole | undefined) ?? null,
  };
}

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { orgId, role } = await loadContext(params.slug, user.id);
  if (!orgId) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  if (!role) return apiError('FORBIDDEN', '조직 멤버만 볼 수 있어요');

  const { data, error } = await supabase
    .from('organization_school_settings')
    .select('*')
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) {
    console.error('[org school-settings GET] error', error);
    return apiError('INTERNAL_ERROR', '조회 실패');
  }

  return apiOk({ settings: data ? rowToDomain(data as SettingsRow) : null });
}

export async function PUT(request: Request, { params }: { params: { slug: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { orgId, role } = await loadContext(params.slug, user.id);
  if (!orgId) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  if (role !== 'owner') {
    return apiError('FORBIDDEN', '조직 어드민만 편집할 수 있어요');
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  const payload = {
    organization_id: orgId,
    school_name: body.schoolName,
    homepage_url: body.homepageUrl ?? null,
    school_level: body.schoolLevel ?? null,
    base_prompt: body.basePrompt ?? null,
    style_enabled: body.styleEnabled,
  };

  const { data, error } = await supabase
    .from('organization_school_settings')
    .upsert(payload, { onConflict: 'organization_id' })
    .select('*')
    .single();
  if (error || !data) {
    console.error('[org school-settings PUT] error', error);
    return apiError('INTERNAL_ERROR', '저장 실패');
  }

  const service = createSupabaseServiceClient();
  await service.from('organization_activity_logs').insert({
    organization_id: orgId,
    actor_user_id: user.id,
    activity_type: 'organization_updated',
    metadata: { section: 'school_settings' },
  });

  return apiOk({ settings: rowToDomain(data as SettingsRow) });
}

export async function DELETE(_req: Request, { params }: { params: { slug: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  const { orgId, role } = await loadContext(params.slug, user.id);
  if (!orgId) return apiError('NOT_FOUND', '조직을 찾을 수 없습니다');
  if (role !== 'owner') {
    return apiError('FORBIDDEN', '조직 어드민만 삭제할 수 있어요');
  }

  const { error } = await supabase
    .from('organization_school_settings')
    .delete()
    .eq('organization_id', orgId);
  if (error) {
    console.error('[org school-settings DELETE] error', error);
    return apiError('INTERNAL_ERROR', '삭제 실패');
  }

  return apiOk({ deleted: true });
}
