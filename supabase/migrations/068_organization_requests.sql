-- Migration: 068_organization_requests
-- Milestone: M4 Organization Approval Flow
-- Depends on: 033_organizations_expand, 056_organizations_type_and_reserved_slugs,
--             057_token_pools, 067_token_pools_auto_provision
-- Plan Ref: docs/01-plan/features/organization-token-management.plan.md §M4 Approval Flow
--
-- 목적:
--   사용자가 새 조직을 요청하는 신청서를 `organizations` 와 분리된 별도
--   테이블 `organization_requests` 로 저장. Super Admin 이 승인한 시점에만
--   실제 `organizations` + owner membership + token_pool (Migration 067
--   트리거로 자동) 이 생성된다.
--
-- 원칙:
--   * 승인 전 신청은 실제 Organization 이 아니다.
--   * 승인은 원자적: request 상태 변경 + org insert + owner membership 이
--     하나의 트랜잭션. RPC `approve_organization_request` 로 제공.
--   * 중복 승인 방지: RPC 안에서 status 검사 + FOR UPDATE lock.
--   * slug 충돌: 신청 시점과 승인 시점 사이에 이미 사용된 slug 는 조용히
--     대체하지 않고 SLUG_TAKEN 예외 → admin UI 가 안내.

-- ============================================================
-- (1) 상태 enum
-- ============================================================
CREATE TYPE public.organization_request_status AS ENUM (
  'SUBMITTED',
  'REVIEWING',
  'APPROVED',
  'REJECTED'
);

-- ============================================================
-- (2) 신청 테이블
-- ============================================================
CREATE TABLE public.organization_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_name TEXT NOT NULL,
  desired_slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  homepage_url TEXT,
  status public.organization_request_status NOT NULL DEFAULT 'SUBMITTED',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  review_started_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  approved_organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (status = 'REJECTED' AND rejection_reason IS NOT NULL) OR status <> 'REJECTED'
  ),
  CHECK (
    (status = 'APPROVED' AND approved_organization_id IS NOT NULL) OR status <> 'APPROVED'
  )
);

CREATE INDEX idx_org_req_applicant
  ON public.organization_requests(applicant_user_id, submitted_at DESC);
CREATE INDEX idx_org_req_status
  ON public.organization_requests(status, submitted_at DESC);

-- ============================================================
-- (3) updated_at 자동 갱신
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_org_requests_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_requests_updated_at
  BEFORE UPDATE ON public.organization_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_org_requests_updated_at();

-- ============================================================
-- (4) RLS — 본인 신청만 SELECT/INSERT. 상태 전이·admin 조회는 service_role.
-- ============================================================
ALTER TABLE public.organization_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_req_select_own ON public.organization_requests
  FOR SELECT
  USING (auth.uid() = applicant_user_id);

CREATE POLICY org_req_insert_own ON public.organization_requests
  FOR INSERT
  WITH CHECK (
    auth.uid() = applicant_user_id
    AND status = 'SUBMITTED'
    AND reviewed_at IS NULL
    AND approved_organization_id IS NULL
  );

-- UPDATE / DELETE 정책 없음 — 신청자는 상태를 바꿀 수 없고, admin 은
-- service_role 을 통해서만 조작한다.

-- ============================================================
-- (5) 승인 RPC (원자적)
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_organization_request(
  p_request_id UUID,
  p_reviewer_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req RECORD;
  v_org_id UUID;
  v_slug_conflict BOOLEAN;
BEGIN
  -- FOR UPDATE 로 lock. 두 admin 이 동시에 승인을 눌러도 두 번째 호출은
  -- 첫 번째 완료 후 상태 검증에서 ALREADY_APPROVED 로 실패한다.
  SELECT * INTO v_req
    FROM public.organization_requests
   WHERE id = p_request_id
     FOR UPDATE;

  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND';
  END IF;
  IF v_req.status = 'APPROVED' THEN
    RAISE EXCEPTION 'ALREADY_APPROVED';
  END IF;
  IF v_req.status = 'REJECTED' THEN
    RAISE EXCEPTION 'ALREADY_REJECTED';
  END IF;

  -- slug 충돌 검사. 신청 시점 이후 다른 조직이 이미 이 slug 를 가져갔다면
  -- 임의로 대체하지 않고 예외를 던진다 (admin UI 에서 처리).
  SELECT EXISTS(SELECT 1 FROM public.organizations WHERE slug = v_req.desired_slug)
    INTO v_slug_conflict;
  IF v_slug_conflict THEN
    RAISE EXCEPTION 'SLUG_TAKEN';
  END IF;

  -- 실제 Organization 생성. Migration 067 트리거가 token_pool 을 자동 생성.
  INSERT INTO public.organizations
    (slug, name, description, homepage_url, owner_id, type)
  VALUES (
    v_req.desired_slug,
    v_req.organization_name,
    COALESCE(v_req.description, ''),
    v_req.homepage_url,
    v_req.applicant_user_id,
    'general'::public.organization_type_enum
  )
  RETURNING id INTO v_org_id;

  -- Owner Membership
  INSERT INTO public.organization_members
    (organization_id, user_id, role, status)
  VALUES (v_org_id, v_req.applicant_user_id, 'owner', 'active');

  -- Request 상태 확정
  UPDATE public.organization_requests
     SET status = 'APPROVED',
         approved_organization_id = v_org_id,
         reviewed_at = NOW(),
         reviewed_by = p_reviewer_id
   WHERE id = p_request_id;

  -- Organization 활동 로그
  INSERT INTO public.organization_activity_logs
    (organization_id, actor_user_id, activity_type, metadata)
  VALUES (
    v_org_id,
    p_reviewer_id,
    'organization_created',
    jsonb_build_object('via', 'approval', 'request_id', p_request_id)
  );

  RETURN jsonb_build_object(
    'organization_id', v_org_id,
    'slug', v_req.desired_slug
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_organization_request(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_organization_request(UUID, UUID) TO service_role;

-- ============================================================
-- (6) Table grants
-- 이 Supabase 프로젝트는 "Automatically expose new tables" 옵션이 OFF 라
-- authenticated / service_role 모두 신규 테이블에 대해 기본 grant 를 받지
-- 않는다 (Migration 018 이 image 계열에 같은 이유로 명시 grant 를 준 전례).
--
--   * authenticated : 본인 신청 SELECT/INSERT (RLS 통과 필요)
--   * service_role  : admin API 가 UPDATE 포함 모든 상태 전이를 수행
-- ============================================================
GRANT SELECT, INSERT ON public.organization_requests TO authenticated;
GRANT ALL ON public.organization_requests TO service_role;

-- Supabase PostgREST 는 새 테이블 감지 시 schema cache 를 갱신한다. 즉시
-- 반영이 필요하면 대시보드에서 "API → Reload schema" 또는 아래를 실행.
NOTIFY pgrst, 'reload schema';
