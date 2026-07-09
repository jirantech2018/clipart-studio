-- Migration: 013_image_categories
-- Design Ref: §3.3 image_categories (auto-tagged)

CREATE TABLE image_categories (
  image_id UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  PRIMARY KEY (image_id, category)
);

CREATE INDEX idx_categories_category ON image_categories(category);
