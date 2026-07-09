-- Migration: 023_admin_settings
-- Purpose: single-row table storing the global system prompt that is prepended
-- to every image generation request. Editable only by the admin (email
-- whitelist enforced in Route Handlers, not in Postgres).
--
-- Design intent: this is the "A" phase of Korean-context enforcement. Later,
-- 024_admin_references will add a reference-image library for the "B" phase.

CREATE TABLE admin_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  system_prompt TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed row + a sensible default so day-1 generations already carry the guidance.
INSERT INTO admin_settings (id, system_prompt) VALUES (
  1,
  '항상 한국인의 얼굴과 체형으로 그리세요. 학교/교실/운동장 등 공간은 한국 K-12 학교의 실제 모습(교복 스타일, 급식실, 태극기가 있는 교실, 한국식 책상 배치)으로 표현하세요. 인물의 헤어스타일과 의상도 한국식이어야 합니다. 아시아 일반 이미지 아닌 한국 특정 스타일을 우선합니다.'
) ON CONFLICT (id) DO NOTHING;

ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read (pipeline needs it), writes go through the
-- Route Handler which enforces the ADMIN_EMAIL whitelist.
CREATE POLICY admin_settings_read_all ON admin_settings
  FOR SELECT USING (auth.role() = 'authenticated');

GRANT SELECT ON admin_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON admin_settings TO service_role;
