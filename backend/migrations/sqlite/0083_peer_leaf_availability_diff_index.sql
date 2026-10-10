-- Peer availability snapshot diff (row 9935).
--
-- Every sync of a peer's inventory compares the incoming snapshot with what is
-- stored. That compare used to read every column of every stored row of the
-- peer (about 50,000 rows with long paths on a real server), once to decide
-- whether anything changed and again inside the write transaction. It now
-- reads only `(media_file_id, content_hash)`, where `content_hash` is a
-- fingerprint of the row's content (everything except `updated_at`, which
-- records when the sender derived the snapshot, not a property of the file).
--
-- The index covers that read, so it is answered from the index alone: no
-- table lookups, and a few dozen bytes per row instead of the whole row.
-- Rows stored before this migration have a NULL hash; they count as changed
-- the next time their peer syncs and are rewritten once, in small batches.
ALTER TABLE peer_leaf_availability ADD COLUMN content_hash TEXT;

CREATE INDEX idx_peer_leaf_availability_diff
    ON peer_leaf_availability (peer_node_id, media_file_id, content_hash);
