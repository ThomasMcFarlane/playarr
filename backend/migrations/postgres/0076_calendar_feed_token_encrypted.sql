-- The subscription URL can be shown again: the token is also stored sealed
-- (ChaCha20-Poly1305 under a key derived from this node's identity). Rows
-- created before this column existed have no sealed copy and are rotated the
-- next time the user asks for their link.
ALTER TABLE calendar_feed_tokens ADD COLUMN token_encrypted TEXT;
