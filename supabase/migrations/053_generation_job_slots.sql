-- Migration: 053_generation_job_slots
--
-- Package job 의 개별 결과물 slot. 하나의 job 아래 여러 slot 이 각기 다른
-- prompt hint / aspect ratio / transparent background 로 이미지 하나씩 생성.
--
-- Slot claim 정책 (Phase 2):
--   pending → running → done       (성공)
--   pending → running → failed     (실패)
--   pending → canceled             (미착수 취소)
--
-- pending → running 전이는 원자적 UPDATE (WHERE status='pending' + RETURNING)
-- 으로 처리한다. SSE 재접속·중복 loop 상황에서도 하나의 slot 이 두 번 실행
-- 되지 않는다.
--
-- 시간 필드 (started_at / completed_at / refunded_at / attempt_count) 는
-- 재시도·환불 중복 방지·이상 감지에 필수. 향후 stuck running slot 복구
-- 로직도 이 필드를 근거로 설계된다 (Phase 3 이후).

CREATE TYPE slot_status_enum AS ENUM (
  'pending',
  'running',
  'done',
  'failed',
  'canceled'
);

CREATE TABLE public.generation_job_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.generation_jobs(id) ON DELETE CASCADE,
  "order" INT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  prompt_hint TEXT NOT NULL DEFAULT '',
  aspect_ratio aspect_ratio_enum NOT NULL DEFAULT 'square',
  transparent_background BOOLEAN NOT NULL DEFAULT FALSE,
  status slot_status_enum NOT NULL DEFAULT 'pending',
  image_id UUID REFERENCES public.images(id) ON DELETE SET NULL,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  attempt_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, "order")
);

CREATE INDEX idx_generation_job_slots_job
  ON public.generation_job_slots(job_id);

CREATE INDEX idx_generation_job_slots_status
  ON public.generation_job_slots(job_id, status);

-- RLS: owner (job.user_id) 만 SELECT.
ALTER TABLE public.generation_job_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY generation_job_slots_select_own
  ON public.generation_job_slots
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.generation_jobs j
      WHERE j.id = generation_job_slots.job_id
        AND j.user_id = auth.uid()
    )
  );

-- 앱 로직에서 authenticated 는 SELECT 만. INSERT/UPDATE/DELETE 는 service_role
-- (파이프라인 · slot claim · 취소 처리) 전용.
GRANT SELECT ON public.generation_job_slots TO authenticated;
GRANT ALL ON public.generation_job_slots TO service_role;

-- updated_at 자동 갱신 트리거.
CREATE OR REPLACE FUNCTION public.tg_generation_job_slots_touch_updated_at()
  RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_generation_job_slots_updated_at
  BEFORE UPDATE ON public.generation_job_slots
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_generation_job_slots_touch_updated_at();
