-- Playback analytics tables. Mirrors `playarr_model::{PlaybackSession,
-- PlaybackEvent}` — keep the two in sync when either changes.
--
-- Portability note: UUIDs and timestamps are stored as TEXT in ISO-8601
-- form (`strftime('%Y-%m-%dT%H:%M:%fZ', ...)` on SQLite, `to_char(...)` on
-- Postgres) rather than native UUID/TIMESTAMPTZ types, and counters are
-- plain INTEGER, so the same logical schema (and the same application-level
-- SQL in `playarr-db::analytics`) works unmodified against both engines.
-- `INTEGER` here is SQLite's dynamically-sized integer affinity (effectively
-- 64-bit); the matching Postgres migration uses `BIGINT` for the same
-- columns for identical range, since Postgres `INTEGER` is a fixed 32 bits.

CREATE TABLE IF NOT EXISTS playback_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    media_file_id TEXT NOT NULL,
    rendition_id TEXT,

    started_at TEXT NOT NULL,
    ended_at TEXT,

    play_method TEXT NOT NULL,
    transcode_reason TEXT,

    source_codec TEXT NOT NULL,
    source_container TEXT NOT NULL,
    source_bitrate INTEGER,

    target_codec TEXT NOT NULL,
    target_container TEXT NOT NULL,
    target_bitrate INTEGER,

    client_platform TEXT NOT NULL,
    client_version TEXT NOT NULL,
    ip_address TEXT,

    bytes_streamed INTEGER NOT NULL DEFAULT 0,
    buffering_events INTEGER NOT NULL DEFAULT 0,
    buffering_ms_total INTEGER NOT NULL DEFAULT 0,

    stop_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_playback_sessions_user_id ON playback_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_playback_sessions_started_at ON playback_sessions (started_at);
CREATE INDEX IF NOT EXISTS idx_playback_sessions_media_file_id ON playback_sessions (media_file_id);

CREATE TABLE IF NOT EXISTS playback_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES playback_sessions (id),
    occurred_at TEXT NOT NULL,
    -- Discriminant of `PlaybackEventKind` (e.g. "start", "seek", "stop").
    kind TEXT NOT NULL,
    -- The rest of the event's fields (seek from/to, buffer duration, stop
    -- reason, error message, ...), JSON-encoded. Kept schemaless at the
    -- storage layer because the event shape varies per `kind`; the
    -- authoritative typed shape is `playarr_model::PlaybackEventKind` and
    -- application code decodes this column through that enum.
    payload TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_playback_events_session_id ON playback_events (session_id);
CREATE INDEX IF NOT EXISTS idx_playback_events_occurred_at ON playback_events (occurred_at);

-- Pre-aggregated daily rollups, written by `playarr-telemetry::analytics::rollup`
-- so dashboard/reporting queries never have to scan raw session/event rows.
CREATE TABLE IF NOT EXISTS stats_daily (
    day TEXT NOT NULL,
    client_platform TEXT NOT NULL,
    play_method TEXT NOT NULL,

    sessions_count INTEGER NOT NULL DEFAULT 0,
    unique_users_count INTEGER NOT NULL DEFAULT 0,
    unique_devices_count INTEGER NOT NULL DEFAULT 0,
    total_playback_seconds INTEGER NOT NULL DEFAULT 0,
    transcode_sessions_count INTEGER NOT NULL DEFAULT 0,
    buffering_events_total INTEGER NOT NULL DEFAULT 0,
    buffering_ms_total INTEGER NOT NULL DEFAULT 0,
    bytes_streamed_total INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (day, client_platform, play_method)
);

CREATE INDEX IF NOT EXISTS idx_stats_daily_day ON stats_daily (day);
