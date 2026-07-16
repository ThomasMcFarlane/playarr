-- Postgres mirror of sqlite/0016_user_preferred_audio_language.sql.
-- Existing and newly-inserted users default to English.
ALTER TABLE users
ADD COLUMN preferred_audio_language TEXT NOT NULL DEFAULT 'en';
