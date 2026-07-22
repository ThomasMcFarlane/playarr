-- Postgres mirror of ../sqlite/0041_peer_media_inventory.sql. This table is
-- a derived peer cache and is safely repopulated by the next push/pull sync.
DROP TABLE peer_leaf_availability;

CREATE TABLE peer_leaf_availability (
    peer_node_id TEXT NOT NULL,
    media_file_id TEXT NOT NULL,
    source_instance_id TEXT NOT NULL,
    path TEXT NOT NULL,
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    leaf_selector TEXT NOT NULL,
    group_library_id TEXT,
    availability TEXT NOT NULL,
    container TEXT,
    codec TEXT,
    bitrate BIGINT,
    size_bytes BIGINT,
    duration_ms BIGINT,
    local_work_id TEXT,
    title TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'movie',
    release_date TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (peer_node_id, media_file_id)
);

CREATE INDEX idx_peer_leaf_availability_local_work ON peer_leaf_availability (local_work_id);
CREATE INDEX idx_peer_leaf_availability_leaf ON peer_leaf_availability (provider, external_id, leaf_selector);
