-- Migration: 014_generation_jobs
-- Design Ref: §3.3 generation_jobs Job Queue
-- Plan SC: FR-05, FR-12 (credit reserve), NFR one active job per user

CREATE TYPE job_status_enum AS ENUM ('queued', 'running', 'partial', 'done', 'failed');

CREATE TABLE generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  batch_size INT NOT NULL CHECK (batch_size IN (5, 10, 15, 20, 25, 30)),
  diversity_level INT NOT NULL DEFAULT 0 CHECK (diversity_level BETWEEN 0 AND 5),
  reference_image_id UUID REFERENCES images(id) ON DELETE SET NULL,
  school_profile_applied BOOLEAN NOT NULL DEFAULT FALSE,
  reserved_credits INT NOT NULL,
  refunded_credits INT NOT NULL DEFAULT 0,
  status job_status_enum NOT NULL DEFAULT 'queued',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- One active job per user (NFR: prevents parallel abuse + AI cost spikes)
CREATE UNIQUE INDEX idx_jobs_active_per_user
  ON generation_jobs(user_id)
  WHERE status IN ('queued', 'running');

CREATE INDEX idx_jobs_user_created ON generation_jobs(user_id, created_at DESC);
