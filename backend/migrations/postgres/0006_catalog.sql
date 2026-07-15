-- Catalog + device + rendition tables backing `streamarr_model::{Work,
-- Device, Rendition}` and the `WorkRepo`/`DeviceRepo`/`RenditionRepo` traits
-- in `streamarr-db::repo`.
--
-- Portability note (same convention as `0002_analytics.sql`): ids are TEXT
-- (stringified UUIDs), timestamps are TEXT in ISO-8601 form, and the closed
-- Rust enums (`WorkKind`, `Availability`, `RenditionStatus`, `ProducedBy`,
-- `ClientPlatform`) are stored as their lowercase discriminant string — see
-- `streamarr_db::codec` for the single place those mappings live — so the
-- same application-level SQL works unmodified against both engines. BIGINT
-- for `bitrate` matches SQLite's dynamically-sized `INTEGER` (Postgres's own
-- `INTEGER` is a fixed 32 bits and would silently narrow the range).

CREATE TABLE IF NOT EXISTS works (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    sort_title TEXT NOT NULL,
    overview TEXT,
    -- JSON-encoded `Vec<ImageAsset>` / `Vec<String>`. Never filtered/sorted
    -- on at the SQL level (browse/sort uses `sort_title`, not genre/tag), so
    -- a portable opaque TEXT blob is simpler and cheaper than a join table.
    images TEXT NOT NULL DEFAULT '[]',
    genres TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    added_at TEXT NOT NULL,
    -- 0/1, not a native `boolean` column — kept as `INTEGER` on this side
    -- too (rather than the engine-appropriate native type) so the
    -- application-level SQL and Rust row-mapping in `streamarr_db::codec`
    -- stay identical across both engines; see `bool_to_i64` for the SQLite
    -- driver limitation that motivates it.
    monitored INTEGER NOT NULL DEFAULT 0,
    availability TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_works_kind ON works (kind);

-- Normalized (unlike images/genres/tags above) because
-- `WorkRepo::find_by_external_ref` needs to look a work up *by* one of
-- these, not just carry them along for display.
CREATE TABLE IF NOT EXISTS work_external_refs (
    work_id TEXT NOT NULL REFERENCES works (id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    PRIMARY KEY (work_id, provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_work_external_refs_lookup ON work_external_refs (provider, external_id);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    client_version TEXT NOT NULL,
    last_seen_at TEXT,
    trusted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices (user_id);

CREATE TABLE IF NOT EXISTS renditions (
    id TEXT PRIMARY KEY,
    media_file_id TEXT NOT NULL,
    profile TEXT NOT NULL,
    container TEXT NOT NULL,
    codec TEXT NOT NULL,
    bitrate BIGINT,
    output_path TEXT NOT NULL,
    produced_by TEXT NOT NULL,
    produced_at TEXT NOT NULL,
    status TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_renditions_media_file_id ON renditions (media_file_id);
CREATE INDEX IF NOT EXISTS idx_renditions_lookup ON renditions (media_file_id, profile, status);
