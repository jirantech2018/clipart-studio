-- Migration: 030_knowledge_grouping
-- Knowledge 관리 UX 개선: 카테고리별 그룹핑 + 카테고리 내 드래그 정렬.
-- 매칭 로직에는 영향 없음 (classifier 는 여전히 triggers + priority + LLM score 기준).
--
-- 두 컬럼 추가:
--   category   TEXT   자유 입력 카테고리 이름. 빈 문자열이면 "미분류".
--                     고정 enum 이 아닌 이유: 관리자가 새 그룹을 원할 때
--                     코드 수정 없이 즉시 만들 수 있어야 함.
--   sort_order INT    카테고리 내부 정렬 순서. 값이 작을수록 위에 표시.
--                     드래그 앤 드롭 후 한 카테고리 안의 값을 다시 부여한다.
--
-- parent_id (계층 3단계) 는 이번 migration 에 포함하지 않는다.
-- 추후 별도 migration 으로 확장 예정.

ALTER TABLE public.knowledge
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 100;

-- 카테고리 이름은 100자 이내로 제한.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'knowledge'
      AND constraint_name = 'knowledge_category_length'
  ) THEN
    ALTER TABLE public.knowledge
      ADD CONSTRAINT knowledge_category_length CHECK (char_length(category) <= 100);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'knowledge'
      AND constraint_name = 'knowledge_sort_order_range'
  ) THEN
    ALTER TABLE public.knowledge
      ADD CONSTRAINT knowledge_sort_order_range CHECK (sort_order BETWEEN 0 AND 100000);
  END IF;
END $$;

-- 목록 화면 정렬 인덱스: (category, sort_order).
CREATE INDEX IF NOT EXISTS idx_knowledge_category_sort
  ON public.knowledge (category, sort_order);

-- 기존 행이 있다면 sort_order 초기값을 서로 다르게 배정해서 드래그 정렬 시작점을
-- 잡아준다. 현재는 대부분 sort_order=100 이므로 created_at 순서대로 100, 200, 300...
-- (필요시 관리자가 UI 에서 재정렬)
DO $$
DECLARE
  r RECORD;
  seq INT := 100;
BEGIN
  FOR r IN
    SELECT id FROM public.knowledge
    WHERE sort_order = 100
    ORDER BY category, created_at
  LOOP
    UPDATE public.knowledge SET sort_order = seq WHERE id = r.id;
    seq := seq + 100;
  END LOOP;
END $$;
