// Plan M4: Admin 조직 개설 신청 목록 API.
//
// GET /api/admin/organization-requests?status=all|SUBMITTED|REVIEWING|APPROVED|REJECTED
//   - Super Admin (ADMIN_EMAIL) 만 접근.
//   - service_role 로 조회 → 신청자 email · reviewer email 을 함께 매핑해 반환.
//   - 기본 정렬: submitted_at DESC.

import { z } from 'zod';

import { isAdmin } from '@/lib/admin';
import { apiError, apiOk } from '@/lib/api-error';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/services/supabase/server';

import type { OrganizationRequest, OrganizationRequestStatus } from '@/types/domain';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  status: z
    .enum(['all', 'SUBMITTED', 'REVIEWING', 'APPROVED', 'REJECTED'])
    .default('all'),
});

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
    status: row.status as OrganizationRequestStatus,
    submittedAt: row.submitted_at as string,
    reviewStartedAt: (row.review_started_at as string) ?? null,
    reviewedAt: (row.reviewed_at as string) ?? null,
    reviewedBy: (row.reviewed_by as string) ?? null,
    reviewerEmail,
    rejectionReason: (row.rejection_reason as string) ?? null,
    approvedOrganizationId: (row.approved_organization_id as string) ?? null,
  };
}

export async function GET(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', '로그인이 필요합니다');
  if (!isAdmin(user.email)) return apiError('FORBIDDEN', '관리자만 접근할 수 있어요');

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    status: url.searchParams.get('status') ?? undefined,
  });
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', '쿼리 파라미터가 올바르지 않습니다', {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const service = createSupabaseServiceClient();
  let query = service
    .from('organization_requests')
    .select('*')
    .order('submitted_at', { ascending: false });
  if (parsed.data.status !== 'all') {
    query = query.eq('status', parsed.data.status);
  }
  const { data: rows, error } = await query;
  if (error) {
    console.error('[admin org-requests GET] query error', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return apiError('INTERNAL_ERROR', '신청 목록 조회 실패');
  }

  const userIds = Array.from(
    new Set(
      ((rows ?? []) as Array<{ applicant_user_id: string; reviewed_by: string | null }>).flatMap(
        (r) => [r.applicant_user_id, r.reviewed_by].filter((v): v is string => !!v),
      ),
    ),
  );
  const emailByUserId = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profs, error: profErr } = await service
      .from('profiles')
      .select('id, email')
      .in('id', userIds);
    if (profErr) {
      console.error('[admin org-requests GET] profiles error', {
        code: profErr.code,
        message: profErr.message,
      });
    }
    for (const p of profs ?? []) {
      const r = p as { id: string; email: string | null };
      if (r.email) emailByUserId.set(r.id, r.email);
    }
  }

  const requests = (rows ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const applicantId = r.applicant_user_id as string;
    const reviewerId = (r.reviewed_by as string | null) ?? null;
    return rowToRequest(
      r,
      emailByUserId.get(applicantId) ?? null,
      reviewerId ? emailByUserId.get(reviewerId) ?? null : null,
    );
  });

  return apiOk({ requests });
}
