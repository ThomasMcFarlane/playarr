-- Remote-hosted episode stills as JSON-encoded `ImageAsset[]`, following
-- the existing `works.images` storage convention.
ALTER TABLE episodes ADD COLUMN images TEXT NOT NULL DEFAULT '[]';
