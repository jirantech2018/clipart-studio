-- Migration: 081_learning_documents
-- Feature: learning-helper (Phase 1 M1)
-- Plan Ref: docs/01-plan/features/learning-helper.plan.md v0.4 §M1
--
-- 목적:
--   AI 가 생성한 LearningDocument JSON 을 사용자·조직 스코프로 영구 저장.
--   M1 은 이 테이블에서 직접 renderer 를 호출해 PDF 를 즉시 반환한다 (R2 캐싱
--   은 M3 에서).
--
-- 정책:
--   - RLS: 조직 활성 멤버만 조직 문서 SELECT/INSERT
--   - 소유자만 UPDATE/DELETE (편집·삭제는 M4 이후)
--   - document_json 은 learning-renderer/schema.ts 의 LearningDocument 구조

CREATE TABLE IF NOT EXISTS public.learning_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  grade INT NOT NULL CHECK (grade BETWEEN 1 AND 6),
  subject_code TEXT NOT NULL REFERENCES public.learning_subjects(code),
  material_type_code TEXT NOT NULL REFERENCES public.learning_material_types(code),
  topic TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'normal' CHECK (difficulty IN ('easy', 'normal', 'hard')),
  question_count INT NOT NULL DEFAULT 5 CHECK (question_count BETWEEN 1 AND 30),
  document_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_documents_org_created
  ON public.learning_documents(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_learning_documents_user_created
  ON public.learning_documents(user_id, created_at DESC);

-- ============================================================
-- RLS
-- ============================================================
-- ENABLE ROW LEVEL SECURITY 자체는 이미 활성이면 no-op (Postgres 15 는 IF NOT EXISTS
-- 미지원이지만 재실행해도 오류가 아닌 "already enabled" 안내 수준).
ALTER TABLE public.learning_documents ENABLE ROW LEVEL SECURITY;

-- 정책 재실행 안전성 (사용자 지시, 2026-09-07):
--   CREATE POLICY 는 IF NOT EXISTS 를 지원하지 않으므로, 각 정책별로 pg_policies 를
--   확인해 없을 때만 생성한다. 기존 정책을 무조건 DROP 후 재생성하는 방식은 사용
--   금지 (레이스 컨디션 · 감사 로그 손실 위험).
DO $$
BEGIN
  -- 1) 조직 활성 멤버만 조직 문서 조회
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'learning_documents'
      AND policyname = 'learning_documents_select_by_org_member'
  ) THEN
    CREATE POLICY learning_documents_select_by_org_member
      ON public.learning_documents
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.organization_members om
          WHERE om.organization_id = learning_documents.organization_id
            AND om.user_id = (SELECT auth.uid())
            AND om.status = 'active'
        )
      );
  END IF;

  -- 2) 조직 활성 멤버만 자기 이름으로 INSERT
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'learning_documents'
      AND policyname = 'learning_documents_insert_by_org_member'
  ) THEN
    CREATE POLICY learning_documents_insert_by_org_member
      ON public.learning_documents
      FOR INSERT
      TO authenticated
      WITH CHECK (
        user_id = (SELECT auth.uid())
        AND EXISTS (
          SELECT 1 FROM public.organization_members om
          WHERE om.organization_id = learning_documents.organization_id
            AND om.user_id = (SELECT auth.uid())
            AND om.status = 'active'
        )
      );
  END IF;

  -- 3) 소유자만 삭제 (M1 은 삭제 UI 없음, RLS 만 준비)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'learning_documents'
      AND policyname = 'learning_documents_delete_by_owner'
  ) THEN
    CREATE POLICY learning_documents_delete_by_owner
      ON public.learning_documents
      FOR DELETE
      TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;
END $$;

GRANT SELECT, INSERT, DELETE ON public.learning_documents TO authenticated;

NOTIFY pgrst, 'reload schema';
