-- Peer leaf availability -- `docs/architecture/peer-groups.md` §2.3/§4
-- (Phase 2).
--
-- Read-only annotation of what each OTHER peer reports having, at leaf
-- (movie / episode / track / book) granularity -- not per-work, so a TV
-- series with some episodes on node A and others on node B is
-- representable. Never written for `peer_node_id` = self (self's own
-- availability is a live read of this node's own `MediaFileRepo`, not
-- cached here). Never a second writer of `works`/`media_files` -- see §4.1
-- for why `Work`/`MediaFile` stay strictly node-local and single-writer.
--
-- `provider`/`external_id` are the portable cross-node title key
-- (`ExternalProvider`/`ExternalRef`, already stable and dedup-able --
-- `playarr_model::work`). `leaf_selector` is the portable substitute for
-- a peer-local `LeafRef`/`Uuid`, which is meaningless off the node that
-- minted it -- see `playarr_model::group_library::LeafSelector` (§2.4/
-- §4.2). `local_work_id` is a cache of the local `Work` this row matches,
-- recomputed at ingest by the same external-ref-match algorithm §4.2
-- describes; `NULL` means this peer has zero local record of the title at
-- all (the partial-cache-node case, §4.3).
--
-- `title`/`kind`/`release_date` are the reporting peer's own values for
-- this title: the matching input `resolve_local_work`'s (`playarr-peer-
-- sync::availability_sync`) normalized-title + release-year fallback reads
-- on every ingest, and, when `local_work_id` is `NULL`, the only display
-- data available for the partial-cache-node `RemoteOnlyWork` case
-- (`playarr-catalog`'s browse/search hydration, §4.3) -- there is no
-- local `works` row to read a title/kind from in that case.
CREATE TABLE IF NOT EXISTS peer_leaf_availability (
    peer_node_id TEXT NOT NULL,
    provider TEXT NOT NULL,            -- ExternalProvider discriminant, reuses existing codec
    external_id TEXT NOT NULL,
    leaf_selector TEXT NOT NULL,       -- serialized LeafSelector, see §4.2
    group_library_id TEXT,
    availability TEXT NOT NULL,        -- reuses codec::availability_to_str/from_str
    container TEXT,
    codec TEXT,
    bitrate INTEGER,
    size_bytes INTEGER,
    duration_ms INTEGER,
    local_work_id TEXT,
    title TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'movie', -- WorkKind discriminant, reuses existing codec
    release_date TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (peer_node_id, provider, external_id, leaf_selector)
);
CREATE INDEX IF NOT EXISTS idx_peer_leaf_availability_local_work ON peer_leaf_availability (local_work_id);
