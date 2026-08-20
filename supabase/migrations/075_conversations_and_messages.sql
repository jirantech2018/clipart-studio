-- Migration: 075_conversations_and_messages
-- Feature: conversation-server-storage (v0.2)
-- Depends on: 001_profiles, 033_organizations_expand, 016_rls_images_jobs
-- Plan Ref: docs/01-plan/features/conversation-server-storage.plan.md §2.1 §2.2
--
-- 목적:
--   Zustand + localStorage 로만 관리되던 대화 히스토리를 Supabase 로 이관하여
--   Source of Truth 를 서버로 통일한다. 프롬프트 작성만 하고 이탈해도 유실
--   되지 않고, 다른 기기·브라우저에서도 동일 계정의 대화가 복원된다.
--
-- 정책:
--   - 유저 소유만 조회/수정 (RLS). 조직 관리자 조회는 별도 Feature (D-3).
--   - Soft Delete: status='deleted' + deleted_at=NOW(). Hard delete 는 이후 cron.
--   - draft 메시지도 정상 저장 (프롬프트 입력 순간부터 서버 upsert).

-- ============================================================
-- (1) Enums
-- ============================================================
CREATE TYPE conversation_status_enum AS ENUM (
  'active',
  'archived',
  'deleted'
);

CREATE TYPE conversation_message_role_enum AS ENUM (
  'user',
  'assistant',
  'system'
);

CREATE TYPE conversation_message_status_enum AS ENUM (
  'draft',
  'submitted',
  'completed',
  'failed'
);

-- ============================================================
-- (2) conversations 테이블
-- ============================================================
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  title TEXT,
  status conversation_status_enum NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- 사이드바 목록 조회용 인덱스 (soft-deleted 제외, 최근 활동순).
CREATE INDEX idx_conversations_sidebar
  ON public.conversations(user_id, organization_id, last_activity_at DESC)
  WHERE deleted_at IS NULL;

-- 조직 통계용 (향후 관리자 뷰).
CREATE INDEX idx_conversations_org_status
  ON public.conversations(organization_id, status)
  WHERE deleted_at IS NULL;

-- updated_at 자동 갱신 트리거.
CREATE OR REPLACE FUNCTION public.tg_conversations_touch_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_touch_updated_at ON public.conversations;
CREATE TRIGGER conversations_touch_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.tg_conversations_touch_updated_at();

-- ============================================================
-- (3) conversation_messages 테이블
-- ============================================================
CREATE TABLE public.conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role conversation_message_role_enum NOT NULL DEFAULT 'user',
  prompt TEXT NOT NULL DEFAULT '',
  options JSONB,
  package_plan JSONB,
  status conversation_message_status_enum NOT NULL DEFAULT 'draft',
  job_id UUID REFERENCES public.generation_jobs(id) ON DELETE SET NULL,
  order_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 대화 열기 시 순서 정렬 조회용.
CREATE INDEX idx_conversation_messages_order
  ON public.conversation_messages(conversation_id, order_index);

-- Job → Message 역참조용 (drift reconciliation 시).
CREATE INDEX idx_conversation_messages_job
  ON public.conversation_messages(job_id)
  WHERE job_id IS NOT NULL;

-- updated_at 자동 갱신.
CREATE OR REPLACE FUNCTION public.tg_conversation_messages_touch_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversation_messages_touch_updated_at ON public.conversation_messages;
CREATE TRIGGER conversation_messages_touch_updated_at
  BEFORE UPDATE ON public.conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_conversation_messages_touch_updated_at();

-- message 변경 시 parent conversation.last_activity_at 동기화.
CREATE OR REPLACE FUNCTION public.tg_conversation_messages_touch_conversation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.conversations
     SET last_activity_at = NOW()
   WHERE id = COALESCE(NEW.conversation_id, OLD.conversation_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS conversation_messages_touch_conversation ON public.conversation_messages;
CREATE TRIGGER conversation_messages_touch_conversation
  AFTER INSERT OR UPDATE OR DELETE ON public.conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_conversation_messages_touch_conversation();

-- ============================================================
-- (4) RLS — 유저 소유만
-- ============================================================
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;

-- conversations: 소유자만 CRUD (soft delete 는 UPDATE 로 처리하므로 DELETE 정책 없음).
CREATE POLICY conversations_select_own ON public.conversations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY conversations_insert_own ON public.conversations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY conversations_update_own ON public.conversations
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- conversation_messages: parent conversation 소유자만.
CREATE POLICY conversation_messages_select_own ON public.conversation_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
       WHERE c.id = conversation_messages.conversation_id
         AND c.user_id = auth.uid()
    )
  );

CREATE POLICY conversation_messages_insert_own ON public.conversation_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
       WHERE c.id = conversation_messages.conversation_id
         AND c.user_id = auth.uid()
    )
  );

CREATE POLICY conversation_messages_update_own ON public.conversation_messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
       WHERE c.id = conversation_messages.conversation_id
         AND c.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
       WHERE c.id = conversation_messages.conversation_id
         AND c.user_id = auth.uid()
    )
  );

-- ============================================================
-- (5) GRANTs — 이 프로젝트는 "Automatically expose new tables" OFF 라
--     service_role 도 명시 grant 필요 (Migration 070/072 전례).
-- ============================================================
GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.conversation_messages TO authenticated;

GRANT ALL ON public.conversations TO service_role;
GRANT ALL ON public.conversation_messages TO service_role;

NOTIFY pgrst, 'reload schema';
