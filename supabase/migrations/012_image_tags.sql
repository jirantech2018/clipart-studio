-- Migration: 012_image_tags
-- Design Ref: §3.3 image_tags for FTS

CREATE TABLE image_tags (
  image_id UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (image_id, tag)
);

CREATE INDEX idx_tags_tag ON image_tags(tag);
