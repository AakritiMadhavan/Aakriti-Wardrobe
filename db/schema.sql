-- Aakriti's Wardrobe: PostgreSQL schema. Safe to run more than once.

CREATE TABLE IF NOT EXISTS settings (
  key   text PRIMARY KEY,
  value text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS categories (
  id       text PRIMARY KEY,
  name     text NOT NULL UNIQUE,
  position integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subcategories (
  id          text PRIMARY KEY,
  category_id text NOT NULL REFERENCES categories (id) ON UPDATE CASCADE ON DELETE CASCADE,
  name        text NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  UNIQUE (category_id, name),
  UNIQUE (category_id, id)
);

CREATE TABLE IF NOT EXISTS items (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  category_id   text NOT NULL REFERENCES categories (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  subcategory_id text,
  price         integer NOT NULL CHECK (price > 0),
  original_link text NOT NULL DEFAULT '',
  is_sample     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT items_category_subcategory_fkey
    FOREIGN KEY (category_id, subcategory_id) REFERENCES subcategories (category_id, id) ON UPDATE CASCADE ON DELETE RESTRICT
);
ALTER TABLE items ADD COLUMN IF NOT EXISTS subcategory_id text;
CREATE INDEX IF NOT EXISTS items_category_idx ON items (category_id);
CREATE INDEX IF NOT EXISTS items_subcategory_idx ON items (subcategory_id);
CREATE INDEX IF NOT EXISTS items_created_idx ON items (created_at DESC);

-- Photos are stored in the database so they survive redeploys on hosts
-- with temporary disks (Render). The browser resizes each photo before upload.
CREATE TABLE IF NOT EXISTS item_images (
  id           serial PRIMARY KEY,
  item_id      text NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  content_type text NOT NULL,
  data         bytea NOT NULL,
  position     integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS item_images_item_idx ON item_images (item_id, position);
