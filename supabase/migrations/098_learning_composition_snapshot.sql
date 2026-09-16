-- Stage 4.1 감사 감시: WorksheetPlan + PageCompositionPlan + AppliedComposition +
-- LayoutReview 결과를 감사 로그에 저장한다.
--
-- 기존 learning_evaluations.result 는 { plan, context, review1, review2, telemetry } 만
-- 담아 WorksheetPlan / CompositionPlan / 렌더 스냅샷을 사후 재현할 수 없었다. 이 마이그레이션은
-- 별도 컬럼을 신설하여 감사·재현 가능성을 확보.

ALTER TABLE public.learning_evaluations
  ADD COLUMN IF NOT EXISTS worksheet_plan_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS composition_plan_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS applied_composition_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS layout_review_result JSONB;

-- 문서-composition 조회 편의 인덱스.
CREATE INDEX IF NOT EXISTS idx_learning_evaluations_composition
  ON public.learning_evaluations((composition_plan_snapshot IS NOT NULL))
  WHERE composition_plan_snapshot IS NOT NULL;
