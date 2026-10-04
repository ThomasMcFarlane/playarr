-- Audio and subtitle language index per media file (task 180).
-- `lang` is a canonical ISO 639 code (ISO 639-1 where one exists). `source`
-- is the producer: 'arr' (Sonarr/Radarr mediaInfo), 'probe' (ffprobe of the
-- file) or 'sidecar' (subtitle files next to the video); a producer replaces
-- only its own rows, readers take the union. The state table records that a
-- producer has run for a file (even when it found nothing) so the backfill
-- never rescans it. SQLite mirror: ../sqlite/0052_media_file_languages.sql.
CREATE TABLE IF NOT EXISTS media_file_languages (
    media_file_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    lang TEXT NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY (media_file_id, kind, lang, source)
);
CREATE INDEX IF NOT EXISTS idx_media_file_languages_lookup ON media_file_languages (kind, lang);

CREATE TABLE IF NOT EXISTS media_file_language_state (
    media_file_id TEXT NOT NULL,
    source TEXT NOT NULL,
    scanned_ms BIGINT NOT NULL,
    PRIMARY KEY (media_file_id, source)
);
