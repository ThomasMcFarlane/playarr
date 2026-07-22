ALTER TABLE source_instances ADD COLUMN origin_peer_id TEXT;

-- The previous release advanced these cursors after exchanging identity-only
-- rows. Force one complete replay so existing source configurations replicate.
DELETE FROM peer_sync_state WHERE entity IN ('libraries', 'push');
