-- Bookkeeping table recording which logical schema version this database
-- has been migrated to. sqlx already tracks applied migration files in its
-- own `_sqlx_migrations` table; this one is a deliberately separate,
-- human-readable summary that application code and support tooling
-- (`playarr diagnostics`, health checks) can query without depending on
-- sqlx's internal table shape.
CREATE TABLE IF NOT EXISTS schema_version (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO schema_version (id, version)
VALUES (1, 1)
ON CONFLICT (id) DO UPDATE SET
    version = excluded.version,
    applied_at = excluded.applied_at;
