-- Migration: 028_prompt_rules
-- Purpose: 관리자 페이지에서 관리하는 프롬프트 규칙 저장소. 이미지 생성 파이프라인이
-- 각 배치 시작 시 활성화된 rule 을 카테고리별로 로드해서 사용자 프롬프트와 조합한다.
--
-- 설계 결정 (사용자 확정):
--  C. 기존 admin_settings.system_prompt 를 첫 Global Rule 로 자동 이관 (하위 호환)
--  A. structurePrompt 서비스는 별도 계층으로 유지 (rule 은 시스템 지침, structuring 은 자연어 분해)
--
-- 카테고리:
--   global   : 항상 적용되는 최상위 지시 (한국 학교 스타일 등)
--   school   : 학교급 힌트 (초/중/고) — Phase 2 tags 매칭 예정
--   location : 장소 힌트 (과학실/도서관 등) — Phase 2 tags 매칭 예정
--   style    : 렌더링 톤 (실사/일러스트 등) — Phase 2 tags 매칭 예정
--   task     : 작업 유형 (생성/편집/배경제거) — Phase 2 tags 매칭 예정
--   context  : 그 밖의 상황 규칙
--   negative : 부정 프롬프트 (no text, no watermark 등)
--
-- Phase 1 에서는 activated rule 이 category+priority 순으로 무조건 조합된다.
-- Phase 2 에서 gpt-4o-mini classifier + tags 컬럼으로 필요한 rule 만 선택하도록 확장.

-- ---------------------------------------------------------------
-- 1. prompt_rules 테이블
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prompt_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  priority INT NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prompt_rules_category_check
    CHECK (category IN ('global', 'school', 'location', 'style', 'task', 'context', 'negative')),
  CONSTRAINT prompt_rules_priority_range
    CHECK (priority BETWEEN 0 AND 10000),
  CONSTRAINT prompt_rules_content_length
    CHECK (char_length(content) BETWEEN 1 AND 20000)
);

CREATE INDEX IF NOT EXISTS idx_prompt_rules_enabled_category_priority
  ON public.prompt_rules (enabled, category, priority)
  WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_prompt_rules_tags
  ON public.prompt_rules USING GIN (tags);

-- ---------------------------------------------------------------
-- 2. updated_at 자동 갱신 트리거
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_prompt_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prompt_rules_touch_updated_at ON public.prompt_rules;
CREATE TRIGGER trg_prompt_rules_touch_updated_at
  BEFORE UPDATE ON public.prompt_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_prompt_rules_updated_at();

-- ---------------------------------------------------------------
-- 3. RLS (읽기: 파이프라인이 필요, 쓰기: 관리자 API 만)
-- ---------------------------------------------------------------
ALTER TABLE public.prompt_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prompt_rules_read_all ON public.prompt_rules;
CREATE POLICY prompt_rules_read_all
  ON public.prompt_rules
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- ---------------------------------------------------------------
-- 4. GRANT
-- ---------------------------------------------------------------
GRANT SELECT ON public.prompt_rules TO authenticated;
GRANT ALL ON public.prompt_rules TO service_role;

-- ---------------------------------------------------------------
-- 5. 기존 admin_settings.system_prompt 자동 이관 (결정 C)
--    - system_prompt 가 비어있지 않으면 첫 Global Rule 로 복사
--    - 이미 같은 이름의 rule 이 있으면 스킵 (idempotent)
-- ---------------------------------------------------------------
DO $$
DECLARE
  legacy_prompt TEXT;
BEGIN
  SELECT system_prompt INTO legacy_prompt FROM public.admin_settings WHERE id = 1;

  IF legacy_prompt IS NOT NULL AND char_length(trim(legacy_prompt)) > 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.prompt_rules WHERE name = '레거시 시스템 프롬프트'
    ) THEN
      INSERT INTO public.prompt_rules (name, category, priority, enabled, content)
      VALUES ('레거시 시스템 프롬프트', 'global', 10, TRUE, legacy_prompt);
    END IF;
  END IF;
END $$;
