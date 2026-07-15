-- Migration: 029_knowledge
-- Image Knowledge CMS 의 저장소. OpenAI 이미지 모델이 잘 이해하지 못하는
-- 대한민국 학교 고유의 사물/공간/구조/문화를 텍스트 설명 + 참고 이미지로 관리한다.
--
-- 사용자 확정 사양:
--   1) Negative 이미지는 이미지 생성 API 에 전달하지 않음 (관리자 비교/텍스트 변환 전용)
--   2) Knowledge 당 이미지 개수 상한: Positive 10 / Negative 5
--   3) 실제 API 전달은 Positive 만 최대 5장 (파이프라인 Phase C 에서 반영)
--   4) 기존 prompt_rules 는 검증 완료 후 별도로 폐기 (이 migration 에선 건드리지 않음)
--   5) authenticated 는 이 테이블에 직접 접근 금지. service_role 만 허용.

-- ---------------------------------------------------------------
-- 1. knowledge 테이블
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  triggers TEXT[] NOT NULL DEFAULT '{}',
  negative_prompt TEXT NOT NULL DEFAULT '',
  priority INT NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT knowledge_name_length CHECK (char_length(name) BETWEEN 1 AND 200),
  CONSTRAINT knowledge_desc_length CHECK (char_length(description) BETWEEN 1 AND 20000),
  CONSTRAINT knowledge_negative_length CHECK (char_length(negative_prompt) <= 5000),
  CONSTRAINT knowledge_priority_range CHECK (priority BETWEEN 0 AND 10000)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_enabled_priority
  ON public.knowledge (enabled, priority)
  WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_knowledge_triggers
  ON public.knowledge USING GIN (triggers);

-- ---------------------------------------------------------------
-- 2. knowledge_images 테이블
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_id UUID NOT NULL REFERENCES public.knowledge(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  viewpoint TEXT NOT NULL DEFAULT '',
  reference_type TEXT NOT NULL DEFAULT 'positive',
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  width INT NOT NULL,
  height INT NOT NULL,
  filename TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT knowledge_images_reference_type_check
    CHECK (reference_type IN ('positive', 'negative')),
  CONSTRAINT knowledge_images_caption_length CHECK (char_length(caption) <= 1000),
  CONSTRAINT knowledge_images_viewpoint_length CHECK (char_length(viewpoint) <= 100)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_images_knowledge
  ON public.knowledge_images (knowledge_id, reference_type, sort_order);

-- 각 Knowledge 안에서 positive / negative 각각 대표 이미지는 최대 1장.
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_images_primary_per_type
  ON public.knowledge_images (knowledge_id, reference_type)
  WHERE is_primary = TRUE;

-- ---------------------------------------------------------------
-- 3. 이미지 개수 상한 트리거 (positive 10, negative 5)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_knowledge_image_limit()
RETURNS TRIGGER AS $$
DECLARE
  existing INT;
  cap INT;
BEGIN
  IF NEW.reference_type = 'positive' THEN
    cap := 10;
  ELSIF NEW.reference_type = 'negative' THEN
    cap := 5;
  ELSE
    -- CHECK constraint 가 잡지만 방어적 처리
    RAISE EXCEPTION 'knowledge_images_invalid_reference_type: %', NEW.reference_type
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*) INTO existing
  FROM public.knowledge_images
  WHERE knowledge_id = NEW.knowledge_id
    AND reference_type = NEW.reference_type;

  IF existing >= cap THEN
    RAISE EXCEPTION 'knowledge_%_image_limit_reached: max %', NEW.reference_type, cap
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_knowledge_image_limit ON public.knowledge_images;
CREATE TRIGGER trg_enforce_knowledge_image_limit
  BEFORE INSERT ON public.knowledge_images
  FOR EACH ROW EXECUTE FUNCTION public.enforce_knowledge_image_limit();

-- ---------------------------------------------------------------
-- 4. updated_at 자동 갱신 트리거 (knowledge 테이블)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_knowledge_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_knowledge_touch_updated_at ON public.knowledge;
CREATE TRIGGER trg_knowledge_touch_updated_at
  BEFORE UPDATE ON public.knowledge
  FOR EACH ROW EXECUTE FUNCTION public.touch_knowledge_updated_at();

-- ---------------------------------------------------------------
-- 5. RLS — authenticated 접근 금지, service_role 만 허용
--    SELECT policy 를 만들지 않음 → authenticated 는 조회 자체가 차단.
--    service_role 은 RLS 를 우회하므로 별도 정책 불필요.
-- ---------------------------------------------------------------
ALTER TABLE public.knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_images ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- 6. GRANT — authenticated 에는 아무 권한도 주지 않음
-- ---------------------------------------------------------------
GRANT ALL ON public.knowledge TO service_role;
GRANT ALL ON public.knowledge_images TO service_role;

-- ---------------------------------------------------------------
-- 참고: 기존 prompt_rules 폐기는 이 migration 에서 하지 않는다.
-- Phase C (파이프라인 이관) 완료 후 관리자 검증을 거쳐 별도 migration 으로 폐기 예정.
-- ---------------------------------------------------------------
