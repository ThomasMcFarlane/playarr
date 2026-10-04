-- Home rails: admin-managed, per-library Home shelves plus per-user
-- hide/reorder overrides. Defaults are seeded at boot (stable ids); custom
-- rails point at a saved library view. `config` is a JSON object
-- (playarr_model::HomeRailConfig). Postgres mirror: ../postgres/0072_home_rails.sql.
CREATE TABLE IF NOT EXISTS home_rails (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    library TEXT,
    name TEXT,
    view_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0,
    config TEXT NOT NULL DEFAULT '{}',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS home_rail_user_prefs (
    user_id TEXT NOT NULL,
    rail_id TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    position INTEGER,
    PRIMARY KEY (user_id, rail_id)
);
