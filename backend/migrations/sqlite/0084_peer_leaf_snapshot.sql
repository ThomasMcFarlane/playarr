-- Peer availability snapshot marker (row 9952).
--
-- A peer re-sends its whole inventory every minute and it almost never
-- changes. Even with the covering index of migration 0083, finding that out
-- meant reading every stored `(media_file_id, content_hash)` pair of the peer
-- (about 50,000 rows) through the driver, 1.3 to 3.8 s on a loaded server.
--
-- This row says which snapshot the peer's rows currently are: how many rows
-- and a digest that combines their `content_hash` values (order independent).
-- A replacement whose digest and the stored row count both match changes
-- nothing and reads one row. The row is deleted before a replacement starts
-- writing and written again after its last chunk, so a replacement that was
-- interrupted part-way never leaves a marker claiming a snapshot the rows do
-- not match. No row for a peer means "unknown": the next replacement compares
-- row by row, as before.
CREATE TABLE peer_leaf_snapshot (
    peer_node_id TEXT PRIMARY KEY NOT NULL,
    row_count INTEGER NOT NULL,
    digest TEXT NOT NULL,
    -- The sender's own digest of the snapshot as sent (`wire_digest`), when known.
    -- Valid exactly while this row exists, so it is forgotten with the marker.
    wire_digest TEXT
);
