-- Real grab and import events reported by the *arr webhooks, used to compute
-- the average time from release to library availability per series.
CREATE TABLE IF NOT EXISTS availability_events (
    source_instance_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    season_number INTEGER NOT NULL,
    episode_number INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('grab', 'import')),
    occurred_at TEXT NOT NULL,
    air_at TEXT,
    is_upgrade INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (source_instance_id, provider, external_id, season_number,
                 episode_number, item_id, event_type, occurred_at)
);

CREATE INDEX IF NOT EXISTS idx_availability_events_work
    ON availability_events (provider, external_id);
