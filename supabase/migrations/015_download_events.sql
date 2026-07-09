-- Migration: 015_download_events
-- Design Ref: §3.3 download_events (reuse KPI source)
-- Plan SC: KPI reuse rate

CREATE TABLE download_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  image_id UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('download', 'copy_link', 'chain_source')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_user_created ON download_events(user_id, created_at DESC);
CREATE INDEX idx_events_image ON download_events(image_id);
