-- Last good calendar data per source instance and month, refreshed in the
-- background. The calendar API answers from here and never waits on a source.
CREATE TABLE IF NOT EXISTS calendar_source_chunks (
    instance_id TEXT NOT NULL,
    month TEXT NOT NULL,            -- YYYY-MM
    fetched_at TEXT NOT NULL,
    entries_json TEXT NOT NULL,
    PRIMARY KEY (instance_id, month)
);

-- Refresh health per source instance, for admin diagnostics and backoff.
CREATE TABLE IF NOT EXISTS calendar_source_health (
    instance_id TEXT PRIMARY KEY,
    last_success_at TEXT,
    last_attempt_at TEXT,
    last_error_state TEXT,
    last_error_message TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0
);
