// Organization list + create.
//
// GET  /api/organizations         — 내가 active 멤버인 조직 목록 (내 role 포함)
// POST /api/organizations         — 새 조직 생성. 요청자가 자동으로 owner
//
// 모든 접근 제어는 RLS 로 강제됨:
//   - organizations SELECT policy: 소속 멤버 or owner 만
//   - organizations INSERT policy: auth.uid() = owner_id
//   - organization_members INSERT policy: auth.uid() = user_id (자기 자신만)
// API 는 편의 계층 (매핑 + 검증 + 활동 로그 기록).

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
import { createOrganizationSchema } from '@/types/schemas';

import type { OrganizationRole } from '@/types/domain';

export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  // 내가 active 멤버인 조직 + 내 role. organization_members 를 시작점으로
  // JOIN 해서 한 쿼리로 organization row 를 가져온다.
  const { data: rows, error } = await supabase
    .from('organization_members')
    .select('role, organization:organizations(*)')
    .eq('user_id', user.id)
    .eq('status', 'active');

  if (error) {
    console.error('[organizations GET] query error', error);
    return apiError('INTERNAL_ERROR', '조직 목록 조회 실패');
  }

  // 각 조직의 멤버 수를 별도로 조회 (뷰 도입 전까지 간단한 방식).
  const orgs = (rows ?? [])
    .map((r) => {
      const org = r.organization as unknown as OrganizationRow | null;
      if (!org) return null;
      return {
        row: org,
        role: r.role as OrganizationRole,
      };
    })
    .filter(<T,>(v: T | null): v is T => v !== null);

  // 멤버 수 병렬 조회
  const orgIds = orgs.map((o) => o.row.id);
  const memberCountMap = new Map<string, number>();
  if (orgIds.length > 0) {
    const { data: counts } = await supabase
      .from('organization_members')
      .select('organization_id')
      .in('organization_id', orgIds)
      .eq('status', 'active');
    for (const row of counts ?? []) {
      const orgId = (row as { organization_id: string }).organization_id;
      memberCountMap.set(orgId, (memberCountMap.get(orgId) ?? 0) + 1);
    }
  }

  const organizations = orgs.map((o) =>
    withMyRole(
      organizationRowToDomain(o.row),
      o.role,
      memberCountMap.get(o.row.id) ?? 0,
    ),
  );

  return apiOk({ organizations });
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  let body;
  try {
    body = createOrganizationSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  // 1) 조직 생성 (요청자 = owner)
  const { data: orgRow, error: insertError } = await supabase
    .from('organizations')
    .insert({
      slug: body.slug,
      name: body.name,
      description: body.description ?? '',
      homepage_url: body.homepageUrl ?? null,
      owner_id: user.id,
    })
    .select('*')
    .single();

  if (insertError || !orgRow) {
    // Postgres 23505 = unique violation → slug 중복
    if (insertError?.code === '23505') {
      return apiError('CONFLICT', '이미 사용 중인 URL 이름이에요');
    }
    console.error('[organizations POST] insert error', insertError);
    return apiError('INTERNAL_ERROR', '조직 생성 실패');
  }

  const orgId = (orgRow as { id: string }).id;

  // 2) 요청자를 owner 로 organization_members 에 INSERT.
  //    RLS 는 WITH CHECK (auth.uid() = user_id) 만 검증하므로 self insert 정상 통과.
  const { error: memberError } = await supabase
    .from('organization_members')
    .insert({
      organization_id: orgId,
      user_id: user.id,
      role: 'owner',
      status: 'active',
    });

  if (memberError) {
    // 조직만 생성되고 멤버십이 없으면 나중에 접근 불가하니 이 경우 조직도 롤백.
    console.error('[organizations POST] member insert error', memberError);
    const service = createSupabaseServiceClient();
    await service.from('organizations').delete().eq('id', orgId);
    return apiError('INTERNAL_ERROR', '조직 초기화 실패');
  }

  // 3) 활동 로그 (service role 로 기록 — RLS 는 SELECT 만 admin+ 로 제한)
  const service = createSupabaseServiceClient();
  await service.from('organization_activity_logs').insert({
    organization_id: orgId,
    actor_user_id: user.id,
    activity_type: 'organization_created',
    metadata: { slug: body.slug, name: body.name },
  });

  const domain = organizationRowToDomain(orgRow as OrganizationRow);
  return apiOk(
    { organization: withMyRole(domain, 'owner', 1) },
    201,
  );
}
