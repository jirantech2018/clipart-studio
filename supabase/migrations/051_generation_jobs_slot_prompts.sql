-- Migration: 051_generation_jobs_slot_prompts
--
-- 다양성 생성 (Custom Diversity) — 하나의 배치 안에서 각 슬롯이 서로 다른
-- 추가 프롬프트를 갖도록 지원한다.
--
-- 스토리지:
--   generation_jobs.slot_prompts JSONB (nullable)
--     - NULL              → 기존 동작 (모든 슬롯이 같은 job.prompt 사용)
--     - JSON string array → 다양성 생성 모드. 배열 길이 = batch_size,
--                           index i 는 order=i 슬롯의 "이미지별 추가 프롬프트"
--
-- 파이프라인 (pipeline.ts runOne):
--   slot_prompts 가 있으면 finalPrompt = merge(job.prompt, slot_prompts[order])
--   없으면 기존 로직 그대로. Diversity 강화 (자동) 와도 조합 가능
--   (isDiversityChunk 는 그대로 유지, seed 만 다양화).

ALTER TABLE public.generation_jobs
  ADD COLUMN IF NOT EXISTS slot_prompts JSONB;

-- 배열 형태만 허용 + 각 원소가 문자열이어야 함. NULL 은 허용.
ALTER TABLE public.generation_jobs
  ADD CONSTRAINT generation_jobs_slot_prompts_shape
  CHECK (
    slot_prompts IS NULL
    OR jsonb_typeof(slot_prompts) = 'array'
  );
