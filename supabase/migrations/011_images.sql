-- Migration: 011_images
-- Design Ref: §3.3 images table + FTS
-- Plan SC: FR-05, FR-07, FR-08, FR-13, FR-19, FR-20

CREATE TYPE image_status_enum AS ENUM ('pending', 'saved', 'discarded');
CREATE TYPE generation_mode_enum AS ENUM ('text2img', 'img2img', 'upscale');

CREATE TABLE images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  negative_prompt TEXT,
  model TEXT NOT NULL,
  seed BIGINT,
  r2_key TEXT NOT NULL,
  thumbnail_r2_key TEXT,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  is_upscaled BOOLEAN NOT NULL DEFAULT FALSE,
  upscaled_from_id UUID REFERENCES images(id) ON DELETE SET NULL,
  parent_image_id UUID REFERENCES images(id) ON DELETE SET NULL,
  batch_id UUID,
  generation_mode generation_mode_enum NOT NULL DEFAULT 'text2img',
  reference_image_id UUID REFERENCES images(id) ON DELETE SET NULL,
  school_profile_applied BOOLEAN NOT NULL DEFAULT FALSE,
  status image_status_enum NOT NULL DEFAULT 'pending',
  pending_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Full-text search vector generated from prompt
ALTER TABLE images ADD COLUMN search_vector TSVECTOR
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', COALESCE(prompt, '')), 'A')
  ) STORED;

CREATE INDEX idx_images_user_status ON images(user_id, status);
CREATE INDEX idx_images_public ON images(is_public) WHERE is_public = TRUE;
CREATE INDEX idx_images_pending_expires ON images(pending_expires_at) WHERE status = 'pending';
CREATE INDEX idx_images_parent ON images(parent_image_id) WHERE parent_image_id IS NOT NULL;
CREATE INDEX idx_images_batch ON images(batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX idx_images_search ON images USING GIN (search_vector);
