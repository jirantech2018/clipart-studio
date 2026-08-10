// Plan M4: 사용자 조직 개설 신청 API.
//
// POST /api/organization-requests   body: createOrganizationRequestSchema
//   - 요청자 = auth 유저. status='SUBMITTED' 로 새 row.
//   - 승인 전에는 organizations / members / token_pools 를 만들지 않는다.
//   - slug 는 신청 시점에도 (1) 기존 organizations 와 (2) 승인 대기중인 다른
//     신청과 충돌하는지 서버가 확인해 조기 안내한다. 실제 최종 검증은 승인
//     RPC 안에서 다시 이뤄지므로 여기서는 조기 안내 목적.
//
// GET /api/organization-requests
//   - 세션 유저 본인의 신청 목록만. RLS org_req_select_own 이 통과 조건.
//   - APPROVED 는 이미 실제 org 로 반영되므로 목록에서 제외 (사용자 화면은
//     승인 후 상태 배너를 계속 노출하지 않는다는 UX 원칙).

import { ZodError } from 'zod';

import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';
import { createOrganizationRequestSchema } from '@/types/schemas';

import type { OrganizationRequest } from '@/types/domain';

export const dynamic = 'force-dynamic';

function rowToRequest(
  row: Record<string, unknown>,
  applicantEmail: string | null,
  reviewerEmail: string | null,
): OrganizationRequest {
  return {
    id: row.id as string,
    applicantUserId: row.applicant_user_id as string,
    applicantEmail,
    organizationName: row.organization_name as string,
    desiredSlug: row.desired_slug as string,
    description: (row.description as string) ?? '',
    homepageUrl: (row.homepage_url as string) ?? null,
    status: row.status as OrganizationRequest['status'],
    submittedAt: row.submitted_at as string,
    reviewStartedAt: (row.review_started_at as string) ?? null,
    reviewedAt: (row.reviewed_at as string) ?? null,
    reviewedBy: (row.reviewed_by as string) ?? null,
    reviewerEmail,
    rejectionReason: (row.rejection_reason as string) ?? null,
    approvedOrganizationId: (row.approved_organization_id as string) ?? null,
  };
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  let body;
  try {
    body = createOrganizationRequestSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return apiError('VALIDATION_ERROR', '입력값을 확인해주세요', {
        fieldErrors: err.flatten().fieldErrors,
      });
    }
    return apiError('VALIDATION_ERROR', '요청 형식이 올바르지 않습니다');
  }

  // Slug 조기 충돌 확인 — service_role 로 organizations + 대기중 신청 검사.
  const service = createSupabaseServiceClient();
  const { data: existingOrg } = await service
    .from('organizations')
    .select('id')
    .eq('slug', body.slug)
    .maybeSingle();
  if (existingOrg) {
    return apiError('CONFLICT', '이미 사용 중인 URL 이름이에요');
  }
  const { data: pendingSameSlug } = await service
    .from('organization_requests')
    .select('id, applicant_user_id')
    .eq('desired_slug', body.slug)
    .in('status', ['SUBMITTED', 'REVIEWING'])
    .maybeSingle();
  if (pendingSameSlug) {
    return apiError('CONFLICT', '같은 URL 이름의 다른 신청이 검토 중이에요');
  }

  // INSERT (RLS: applicant_user_id = auth.uid() AND status='SUBMITTED')
  const { data: inserted, error: insertErr } = await supabase
    .from('organization_requests')
    .insert({
      applicant_user_id: user.id,
      organization_name: body.name,
      desired_slug: body.slug,
      description: body.description ?? '',
      homepage_url: body.homepageUrl ?? null,
      status: 'SUBMITTED',
    })
    .select('*')
    .single();

  if (insertErr || !inserted) {
    console.error('[org-requests POST] insert error', insertErr);
    return apiError('INTERNAL_ERROR', '신청 저장 실패');
  }

  return apiOk(
    {
      request: rowToRequest(
        inserted as Record<string, unknown>,
        user.email ?? null,
        null,
      ),
    },
    201,
  );
}

export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');

  // APPROVED 는 조회 결과에서 제외 (UX: 승인 후에는 실제 org 카드로 대체).
  const { data: rows, error } = await supabase
    .from('organization_requests')
    .select('*')
    .eq('applicant_user_id', user.id)
    .in('status', ['SUBMITTED', 'REVIEWING', 'REJECTED'])
    .order('submitted_at', { ascending: false });
  if (error) return apiError('INTERNAL_ERROR', '신청 목록 조회 실패');

  // reviewer email 은 admin 만 참조하기에 서비스 계정으로 별도 매핑.
  const reviewerIds = Array.from(
    new Set(
      ((rows ?? []) as Array<{ reviewed_by: string | null }>)
        .map((r) => r.reviewed_by)
        .filter((v): v is string => !!v),
    ),
  );
  const emailByUserId = new Map<string, string>();
  if (reviewerIds.length > 0) {
    const service = createSupabaseServiceClient();
    const { data: profs } = await service.from('profiles').select('id, email').in('id', reviewerIds);
    for (const p of profs ?? []) {
      const r = p as { id: string; email: string | null };
      if (r.email) emailByUserId.set(r.id, r.email);
    }
  }

  const requests = (rows ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const reviewerId = (r.reviewed_by as string | null) ?? null;
    return rowToRequest(r, user.email ?? null, reviewerId ? emailByUserId.get(reviewerId) ?? null : null);
  });

  return apiOk({ requests });
}
