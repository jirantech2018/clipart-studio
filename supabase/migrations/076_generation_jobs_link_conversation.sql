-- Migration: 076_generation_jobs_link_conversation
-- Feature: conversation-server-storage (v0.2)
-- Depends on: 014_generation_jobs (원본), 075_conversations_and_messages
-- Plan Ref: docs/01-plan/features/conversation-server-storage.plan.md §2.3
--
-- 목적:
--   기존 generation_jobs 에 conversation_id / message_id 컬럼을 추가해
--   Conversation → Message → Job → Image 관계를 완성한다. 기존 Job 파이프라인·
--   크레딧 차감·SSE·R2 저장 로직은 무변경. 두 링크는 옵션 컬럼(NULL 허용)이므로
--   구 클라이언트 호환성 유지.
--
-- 정책:
--   - 신규 job 은 conversation_id / message_id 를 반드시 채우도록 클라이언트가
--     책임 (POST /api/jobs 확장). 서버 스키마는 강제하지 않음 (구 호출부 호환).
--   - Backfill 없음: 기존 job 은 대화 컨텍스트 없이 만들어졌으므로 NULL 유지.

ALTER TABLE public.generation_jobs
  ADD COLUMN IF NOT EXISTS conversation_id UUID
    REFERENCES public.conversations(id) ON DELETE SET NULL;

ALTER TABLE public.generation_jobs
  ADD COLUMN IF NOT EXISTS message_id UUID
    REFERENCES public.conversation_messages(id) ON DELETE SET NULL;

-- 대화 컨텍스트로부터 관련 job 조회용.
CREATE INDEX IF NOT EXISTS idx_generation_jobs_conversation
  ON public.generation_jobs(conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generation_jobs_message
  ON public.generation_jobs(message_id)
  WHERE message_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
