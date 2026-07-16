-- Per-user player audio preference. The non-null database default upgrades
-- every existing account to English and gives direct SQL inserts the same
-- default as newly-created application users.
ALTER TABLE users
ADD COLUMN preferred_audio_language TEXT NOT NULL DEFAULT 'en';
