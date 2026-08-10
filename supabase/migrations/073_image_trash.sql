-- Migration: 073_image_trash
-- Milestone: M5 Image Trash & Review
-- Depends on: 011_images, 033_organizations_expand, 037_images_select_via_org_share, 065_migrate_personal_data_to_my_org
--
-- 목적:
--   Image 를 실제 삭제하지 않고 "휴지통" 상태로 옮길 수 있게 한다.
--   ACTIVE ↔ TRASHED 상태만 전환. DB row/R2 파일/share/creator 는 모두 그대로.
--
-- 원칙 (지시서 §1):
--   * 실제 DELETE 금지 (row/파일/share/organization_id/creator 모두 유지)
--   * TRASHED → ACTIVE 복원 시 기존 관계 그대로 재활성화
--   * Credit 무변화 (Migration 없이 지시서 §15)
--
-- 구조:
--   1) images.trash_status + trashed_at + trashed_by + trash_reason
--      + trash_actor_type (표시용, 실제 권한 판정은 서버에서 재확인)
--   2) image_trash_logs — append-only 이력
--   3) Migration 067/018/070 패턴대로 service_role GRANT + NOTIFY

-- ============================================================
-- (1) 상태 enum
-- ============================================================
CREATE TYPE public.image_trash_status_enum AS ENUM ('ACTIVE', 'TRASHED');
CREATE TYPE public.image_trash_action_enum AS ENUM ('TRASH', 'RESTORE');
CREATE TYPE public.image_trash_actor_type_enum AS ENUM ('USER', 'ORG_ADMIN', 'SUPER_ADMIN');

-- ============================================================
-- (2) images 컬럼 추가 (기본값 ACTIVE 로 backfill)
-- ============================================================
ALTER TABLE public.images
  ADD COLUMN trash_status public.image_trash_status_enum NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN trashed_at TIMESTAMPTZ,
  ADD COLUMN trashed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN trash_reason TEXT,
  ADD COLUMN trash_actor_type public.image_trash_actor_type_enum;

-- 기본 라이브러리 조회 (ACTIVE 필터) 를 위한 부분 index. TRASHED 는 카운트가
-- 작으니 별도 index 없어도 됨.
CREATE INDEX idx_images_trash_active
  ON public.images(organization_id, created_at DESC)
  WHERE trash_status = 'ACTIVE';

CREATE INDEX idx_images_trashed
  ON public.images(organization_id, trashed_at DESC)
  WHERE trash_status = 'TRASHED';

-- ============================================================
-- (3) 이력 테이블 (append-only)
-- ============================================================
CREATE TABLE public.image_trash_logs (
  id BIGSERIAL PRIMARY KEY,
  image_id UUID NOT NULL REFERENCES public.images(id) ON DELETE CASCADE,
  action public.image_trash_action_enum NOT NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_type public.image_trash_actor_type_enum NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_image_trash_logs_image
  ON public.image_trash_logs(image_id, created_at DESC);
CREATE INDEX idx_image_trash_logs_actor
  ON public.image_trash_logs(actor_user_id, created_at DESC);

-- Append-only 보장: UPDATE/DELETE 금지.
CREATE OR REPLACE FUNCTION public.tg_image_trash_logs_readonly()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'image_trash_logs is append-only';
END;
$$;

CREATE TRIGGER image_trash_logs_no_update
  BEFORE UPDATE ON public.image_trash_logs
  FOR EACH ROW EXECUTE FUNCTION public.tg_image_trash_logs_readonly();

CREATE TRIGGER image_trash_logs_no_delete
  BEFORE DELETE ON public.image_trash_logs
  FOR EACH ROW EXECUTE FUNCTION public.tg_image_trash_logs_readonly();

-- ============================================================
-- (4) RLS — 로그는 owner 또는 조직 owner/admin 이 조회. INSERT/UPDATE/DELETE
--   는 오직 service_role (앱이 admin 검증 후 실행).
-- ============================================================
ALTER TABLE public.image_trash_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY image_trash_logs_select_own_or_admin
  ON public.image_trash_logs
  FOR SELECT
  USING (
    -- 이미지 소유자
    EXISTS (
      SELECT 1 FROM public.images i
       WHERE i.id = image_trash_logs.image_id
         AND i.user_id = auth.uid()
    )
    OR
    -- 이미지가 속한 조직의 owner/admin
    EXISTS (
      SELECT 1
        FROM public.images i
        JOIN public.organization_members m
          ON m.organization_id = i.organization_id
       WHERE i.id = image_trash_logs.image_id
         AND m.user_id = auth.uid()
         AND m.status = 'active'
         AND m.role IN ('owner', 'admin')
    )
  );
-- INSERT/UPDATE/DELETE 정책 없음 → authenticated 는 쓸 수 없음.

-- ============================================================
-- (5) Grants — "Automatically expose new tables" OFF 대비 (Migration 018/070).
-- ============================================================
GRANT SELECT ON public.image_trash_logs TO authenticated;
GRANT ALL ON public.image_trash_logs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE image_trash_logs_id_seq TO service_role;

NOTIFY pgrst, 'reload schema';
