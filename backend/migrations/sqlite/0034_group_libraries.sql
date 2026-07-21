-- Group libraries -- `docs/architecture/peer-groups.md` §2.3 (Phase 2).
--
-- Why this table exists at all: `SourceInstance` is the only thing an
-- operator can currently call a "library," and its id is minted
-- independently per node -- there is no value that means "the Movies
-- library" the same way on every peer. `GroupLibrary` is that value: a
-- stable, group-wide id an operator maps each node's own `SourceInstance`
-- onto via the new `source_instances.group_library_id` column below (§5.1).
CREATE TABLE IF NOT EXISTS group_libraries (
    id TEXT PRIMARY KEY,           -- stable across the whole group
    group_id TEXT NOT NULL REFERENCES peer_groups (id) ON DELETE CASCADE,
    name TEXT NOT NULL,            -- "Movies", "TV", "Music" -- operator-defined, syncs
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Nullable: NULL for a `SourceInstance` not part of any cross-node
-- grouping, fully backward compatible.
ALTER TABLE source_instances ADD COLUMN group_library_id TEXT;

-- Additive, portable sibling to the existing `policies.library_allow`
-- (which stays exactly as-is -- still "this specific local
-- `SourceInstance` id, on whichever node evaluates this policy"). This one
-- is meaningful regardless of which group node evaluates the policy.
ALTER TABLE policies ADD COLUMN group_library_allow TEXT NOT NULL DEFAULT '[]';
