-- DRAFT — 원격 apply 금지.
--
-- Migration draft: 087_learning_profile_material_types
-- Feature: learning-helper (Phase 1 M2-1.8)
--
-- 목적:
--   프로필 × 자료유형 결합. 자료유형별 권장·허용·비권장 설정 + guidance.
--   실 스키마 준수: learning_material_types.code = TEXT PK.

CREATE TABLE IF NOT EXISTS public.learning_profile_material_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  profile_id UUID NOT NULL
    REFERENCES public.learning_profiles(id) ON DELETE CASCADE,

  material_type_code TEXT NOT NULL
    REFERENCES public.learning_material_types(code) ON DELETE RESTRICT,

  suitability TEXT NOT NULL
    CHECK (suitability IN ('recommended', 'allowed', 'unsuitable')),

  priority INTEGER NOT NULL DEFAULT 0,

  guidance JSONB NOT NULL DEFAULT '{}'::JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT learning_profile_material_type_unique
    UNIQUE (profile_id, material_type_code)
);

CREATE INDEX IF NOT EXISTS idx_learning_profile_material_types_profile
  ON public.learning_profile_material_types (profile_id, suitability);

ALTER TABLE public.learning_profile_material_types ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='learning_profile_material_types'
      AND policyname='learning_profile_material_types_select_via_profile'
  ) THEN
    CREATE POLICY learning_profile_material_types_select_via_profile
      ON public.learning_profile_material_types
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.learning_profiles p
          WHERE p.id = learning_profile_material_types.profile_id
            AND p.status = 'active'
        )
      );
  END IF;
END $$;

GRANT SELECT ON public.learning_profile_material_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_profile_material_types TO service_role;

NOTIFY pgrst, 'reload schema';
