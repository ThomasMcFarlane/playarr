-- Postgres mirror of ../sqlite/0014_media_file_duration.sql.
ALTER TABLE media_files ADD COLUMN duration_ms BIGINT;
