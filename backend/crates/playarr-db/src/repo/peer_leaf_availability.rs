//! Cross-node leaf availability cache -- Phase 2 of
//! `docs/architecture/peer-groups.md` (see that document's §2.3/§4 for the
//! full design and rationale).
//!
//! One row per physical media file an OTHER peer reports having, keyed by
//! `(peer_node_id, media_file_id)`. The portable leaf identity remains
//! queryable, while distinct Source copies of the same leaf can coexist.
//! Never written for `peer_node_id` = self: this node's own availability is
//! a live read of its own [`crate::repo::MediaFileRepo`], not cached here. Never a second
//! writer of `works`/`media_files` -- see §4.1 for why `Work`/`MediaFile`
//! stay strictly node-local and single-writer, with `availability_sync.rs`
//! (`playarr-peer-sync`) as this table's only writer.
//!
//! `local_work_id` is a cache of the local `Work` this row matches,
//! recomputed at ingest by the external-ref-match algorithm §4.2 describes;
//! `NULL` means this peer has zero local record of the title at all -- the
//! partial-cache-node case, read back here via
//! [`PeerLeafAvailabilityRepo::list_unmatched_for_group`] (§4.3).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use async_trait::async_trait;
use dashmap::DashMap;
use playarr_model::PeerLeafAvailability;
use sha2::{Digest, Sha256};
use sqlx::any::AnyRow;
use sqlx::Row;
use uuid::Uuid;

use crate::codec::{
    availability_from_str, availability_to_str, format_datetime, parse_datetime, parse_uuid,
    provider_from_str, provider_to_str, work_kind_from_str, work_kind_to_str,
};
use crate::error::DbError;
use crate::pool::DbPool;
use crate::write_queue::{write, WriteQueue};

/// Rows written per write-queue operation (and so per savepoint) when a
/// snapshot is applied. A real inventory is tens of thousands of rows; one
/// operation per chunk keeps each stretch that holds the database's write lock
/// short, so other queued writes (watch progress, pollers) interleave between
/// chunks instead of waiting for the whole replacement.
const WRITE_CHUNK_ROWS: usize = 2_000;

// `leaf_selector` round-trips through its own serde-derived JSON form
// (`LeafSelector`'s `#[serde(rename_all = "snake_case")]`) directly via
// `serde_json::to_string`/`from_str` at the call sites below -- the same
// "JSON-encode the type's own wire form into a TEXT column" convention
// `peer_node.rs` uses for `PeerNode::addresses`, rather than inventing a
// bespoke compact encoding the way `crate::codec::leaf_ref_to_str` does for
// the (much smaller) `LeafRef`.

fn from_row(row: &AnyRow) -> Result<PeerLeafAvailability, DbError> {
    let peer_node_id: String = row.try_get("peer_node_id")?;
    let media_file_id: String = row.try_get("media_file_id")?;
    let source_instance_id: String = row.try_get("source_instance_id")?;
    let path: String = row.try_get("path")?;
    let provider: String = row.try_get("provider")?;
    let external_id: String = row.try_get("external_id")?;
    let leaf_selector: String = row.try_get("leaf_selector")?;
    let group_library_id: Option<String> = row.try_get("group_library_id")?;
    let availability: String = row.try_get("availability")?;
    let container: Option<String> = row.try_get("container")?;
    let codec: Option<String> = row.try_get("codec")?;
    let bitrate: Option<i64> = row.try_get("bitrate")?;
    let size_bytes: Option<i64> = row.try_get("size_bytes")?;
    let duration_ms: Option<i64> = row.try_get("duration_ms")?;
    let local_work_id: Option<String> = row.try_get("local_work_id")?;
    let title: String = row.try_get("title")?;
    let kind: String = row.try_get("kind")?;
    let release_date: Option<String> = row.try_get("release_date")?;
    let updated_at: String = row.try_get("updated_at")?;

    Ok(PeerLeafAvailability {
        peer_node_id: parse_uuid(&peer_node_id)?,
        media_file_id: parse_uuid(&media_file_id)?,
        source_instance_id: parse_uuid(&source_instance_id)?,
        path,
        provider: provider_from_str(&provider),
        external_id,
        leaf_selector: serde_json::from_str(&leaf_selector)?,
        group_library_id: group_library_id.as_deref().map(parse_uuid).transpose()?,
        availability: availability_from_str(&availability)?,
        container,
        codec,
        // Bitrate/size/duration are always written from non-negative
        // `u64`s (see `SqlxPeerLeafAvailabilityRepo::upsert` below), so
        // casting back is lossless for any value this repository itself
        // ever stored -- same convention as `media_file.rs::from_row`.
        bitrate: bitrate.map(|b| b as u64),
        size_bytes: size_bytes.map(|b| b as u64),
        duration_ms: duration_ms.map(|d| d as u64),
        local_work_id: local_work_id.as_deref().map(parse_uuid).transpose()?,
        title,
        kind: work_kind_from_str(&kind)?,
        release_date: release_date.as_deref().map(parse_datetime).transpose()?,
        updated_at: parse_datetime(&updated_at)?,
    })
}

const COLUMNS: &str = "peer_node_id, media_file_id, source_instance_id, path, \
                        provider, external_id, leaf_selector, group_library_id, \
                        availability, container, codec, bitrate, size_bytes, duration_ms, \
                        local_work_id, title, kind, release_date, updated_at";

/// Read-only, per-peer annotation of what leaves (movie / episode / track /
/// book) each OTHER peer reports having. See
/// `docs/architecture/peer-groups.md` §2.3/§4.
#[async_trait]
pub trait PeerLeafAvailabilityRepo: Send + Sync {
    /// Insert-or-update keyed by the table's own primary key --
    /// `(peer_node_id, media_file_id)` -- exactly
    /// what `availability_sync.rs`'s ingest loop calls for every row a peer
    /// reports via `GET /api/v1/peer/availability` (§3.1/§4.2).
    async fn upsert(&self, availability: &PeerLeafAvailability) -> Result<(), DbError>;

    /// Removes one peer's derived snapshot before a full replacement. The
    /// availability endpoint always returns a complete current inventory.
    async fn delete_for_peer(&self, peer_node_id: Uuid) -> Result<(), DbError>;

    /// Replaces one peer's whole snapshot with `rows`. The SQL repo does it in
    /// a single transaction (one commit instead of one per row); the default
    /// deletes and upserts row by row.
    async fn replace_for_peer(
        &self,
        peer_node_id: Uuid,
        rows: &[PeerLeafAvailability],
    ) -> Result<(), DbError> {
        self.delete_for_peer(peer_node_id).await?;
        for row in rows {
            self.upsert(row).await?;
        }
        Ok(())
    }

    /// Every leaf availability row ingested from one specific peer -- the
    /// full-refresh starting point for `availability_sync.rs`, and the
    /// admin/debug "what does this peer report" view.
    async fn list_for_peer(&self, peer_node_id: Uuid)
        -> Result<Vec<PeerLeafAvailability>, DbError>;

    /// Availability rows whose cached `local_work_id` is one of
    /// `local_work_ids` -- the catalog hydration read (§4.3):
    /// `CatalogService` calls this with the `Work::id`s on a browse/detail
    /// page and attaches each match to that `Work` as an
    /// `AvailabilityBadge`. Returns `Ok(vec![])` without querying when
    /// `local_work_ids` is empty (an empty SQL `IN (...)` list is invalid
    /// syntax, not merely a no-op match, on at least one supported
    /// backend).
    async fn list_by_local_work_ids(
        &self,
        local_work_ids: &[Uuid],
    ) -> Result<Vec<PeerLeafAvailability>, DbError>;

    /// Rows with no local `Work` match at all (`local_work_id IS NULL`),
    /// scoped to one `GroupLibrary` -- the partial-cache-node /
    /// `RemoteOnlyWork` case `browse_catalog_handler`/
    /// `search_catalog_handler` union in alongside locally-known works
    /// (§4.3).
    async fn list_unmatched_for_group(
        &self,
        group_library_id: Uuid,
    ) -> Result<Vec<PeerLeafAvailability>, DbError>;

    /// Every peer's reported row for one exact portable leaf. Phase 3's
    /// routing-context gathering (`playarr-api::playback::
    /// resolve_route_for_local_media_file`/
    /// `by_external_ref_playback_info_handler`, `docs/architecture/
    /// peer-groups.md` §5.2) is this method's caller: it needs "does any
    /// peer report *this specific* leaf available" for one already-known
    /// leaf identity, not a whole peer's or a whole group-library's rows.
    async fn list_for_leaf(
        &self,
        provider: &playarr_model::ExternalProvider,
        external_id: &str,
        leaf_selector: &playarr_model::LeafSelector,
    ) -> Result<Vec<PeerLeafAvailability>, DbError>;
}

/// One incoming row, ready to write: its serialised leaf selector and its
/// content fingerprint.
struct PreparedRow {
    row: PeerLeafAvailability,
    leaf_selector: String,
    content_hash: String,
}

/// The fingerprint of a row's content: everything except `peer_node_id` (the
/// key being replaced) and `updated_at`. `updated_at` is when the sender
/// derived the snapshot, not a property of the file, so a row that differs only
/// in `updated_at` is unchanged. Uses the stored text forms, so the same row
/// read back from the database hashes the same.
fn content_hash(row: &PeerLeafAvailability, leaf_selector: &str) -> String {
    let mut hasher = Sha256::new();
    let mut field = |value: &str| {
        hasher.update(value.as_bytes());
        hasher.update([0x1f]);
    };
    field(&row.media_file_id.to_string());
    field(&row.source_instance_id.to_string());
    field(&row.path);
    field(&provider_to_str(&row.provider));
    field(&row.external_id);
    field(leaf_selector);
    field(
        &row.group_library_id
            .map(|id| id.to_string())
            .unwrap_or_default(),
    );
    field(availability_to_str(row.availability));
    field(row.container.as_deref().unwrap_or("\u{0}"));
    field(row.codec.as_deref().unwrap_or("\u{0}"));
    field(&row.bitrate.map(|v| v.to_string()).unwrap_or_default());
    field(&row.size_bytes.map(|v| v.to_string()).unwrap_or_default());
    field(&row.duration_ms.map(|v| v.to_string()).unwrap_or_default());
    field(
        &row.local_work_id
            .map(|id| id.to_string())
            .unwrap_or_default(),
    );
    field(&row.title);
    field(work_kind_to_str(row.kind));
    field(&row.release_date.map(format_datetime).unwrap_or_default());
    let digest = hasher.finalize();
    digest[..16].iter().map(|b| format!("{b:02x}")).collect()
}

fn prepare(rows: &[PeerLeafAvailability]) -> Result<Vec<PreparedRow>, DbError> {
    rows.iter()
        .map(|row| {
            let leaf_selector = serde_json::to_string(&row.leaf_selector)?;
            let content_hash = content_hash(row, &leaf_selector);
            Ok(PreparedRow {
                row: row.clone(),
                leaf_selector,
                content_hash,
            })
        })
        .collect()
}

/// `(media_file_id, content_hash)` of every stored row of one peer. The query
/// is answered from `idx_peer_leaf_availability_diff` alone (see the plan test
/// below), so it touches neither the table nor the wide columns. A row stored
/// before the hash existed has `None`.
const STORED_FINGERPRINTS_SQL: &str =
    "SELECT media_file_id, content_hash FROM peer_leaf_availability WHERE peer_node_id = ?";

async fn load_fingerprints(
    pool: &DbPool,
    peer_node_id: Uuid,
) -> Result<HashMap<String, Option<String>>, DbError> {
    let rows = sqlx::query(STORED_FINGERPRINTS_SQL)
        .bind(peer_node_id.to_string())
        .fetch_all(pool)
        .await?;
    rows.iter()
        .map(|row| Ok((row.try_get("media_file_id")?, row.try_get("content_hash")?)))
        .collect()
}

/// What turns one peer's stored rows into a new snapshot: rows to upsert (new
/// or different) and file ids to delete.
struct SnapshotDiff<'a> {
    /// Positions in the incoming snapshot of the rows to upsert.
    changed: Vec<usize>,
    removed: Vec<String>,
    snapshot: std::marker::PhantomData<&'a PreparedRow>,
}

impl<'a> SnapshotDiff<'a> {
    fn between(stored: &HashMap<String, Option<String>>, incoming: &'a [PreparedRow]) -> Self {
        let incoming_files: HashSet<String> = incoming
            .iter()
            .map(|prepared| prepared.row.media_file_id.to_string())
            .collect();
        let changed = incoming
            .iter()
            .enumerate()
            .filter(|(_, prepared)| {
                match stored.get(&prepared.row.media_file_id.to_string()) {
                    Some(Some(hash)) => *hash != prepared.content_hash,
                    // New, or stored before the hash existed.
                    _ => true,
                }
            })
            .map(|(index, _)| index)
            .collect();
        let removed = stored
            .keys()
            .filter(|id| !incoming_files.contains(*id))
            .cloned()
            .collect();
        Self {
            changed,
            removed,
            snapshot: std::marker::PhantomData,
        }
    }

    fn is_empty(&self) -> bool {
        self.changed.is_empty() && self.removed.is_empty()
    }
}

pub struct SqlxPeerLeafAvailabilityRepo {
    pool: DbPool,
    queue: Option<WriteQueue>,
    /// One lock per peer so two replacements of the same peer's snapshot (a
    /// pull and a push arriving together) apply one after the other, each
    /// diffing against what the previous one left.
    peer_locks: DashMap<Uuid, Arc<tokio::sync::Mutex<()>>>,
}

impl SqlxPeerLeafAvailabilityRepo {
    pub fn new(pool: DbPool) -> Self {
        Self {
            pool,
            queue: None,
            peer_locks: DashMap::new(),
        }
    }

    /// Sends `replace_for_peer` through the shared write queue.
    pub fn with_write_queue(mut self, queue: WriteQueue) -> Self {
        self.queue = Some(queue);
        self
    }
}

const UPSERT_SQL: &str = "INSERT INTO peer_leaf_availability \
                 (peer_node_id, media_file_id, source_instance_id, path, \
                 provider, external_id, leaf_selector, group_library_id, \
                 availability, container, codec, bitrate, size_bytes, duration_ms, \
                 local_work_id, title, kind, release_date, updated_at, content_hash) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (peer_node_id, media_file_id) DO UPDATE SET \
                 source_instance_id = excluded.source_instance_id, path = excluded.path, \
                 provider = excluded.provider, external_id = excluded.external_id, \
                 leaf_selector = excluded.leaf_selector, \
                 group_library_id = excluded.group_library_id, \
                 availability = excluded.availability, container = excluded.container, \
                 codec = excluded.codec, bitrate = excluded.bitrate, \
                 size_bytes = excluded.size_bytes, duration_ms = excluded.duration_ms, \
                 local_work_id = excluded.local_work_id, title = excluded.title, \
                 kind = excluded.kind, release_date = excluded.release_date, \
                 updated_at = excluded.updated_at, content_hash = excluded.content_hash";

/// Binds one row to [`UPSERT_SQL`].
fn bind_upsert<'q>(
    availability: &'q PeerLeafAvailability,
    leaf_selector: String,
    content_hash: String,
) -> sqlx::query::Query<'q, sqlx::Any, sqlx::any::AnyArguments<'q>> {
    sqlx::query(UPSERT_SQL)
        .bind(availability.peer_node_id.to_string())
        .bind(availability.media_file_id.to_string())
        .bind(availability.source_instance_id.to_string())
        .bind(availability.path.as_str())
        .bind(provider_to_str(&availability.provider))
        .bind(availability.external_id.as_str())
        .bind(leaf_selector)
        .bind(availability.group_library_id.map(|id| id.to_string()))
        .bind(availability_to_str(availability.availability))
        .bind(availability.container.as_deref())
        .bind(availability.codec.as_deref())
        .bind(availability.bitrate.map(|b| b as i64))
        .bind(availability.size_bytes.map(|b| b as i64))
        .bind(availability.duration_ms.map(|d| d as i64))
        .bind(availability.local_work_id.map(|id| id.to_string()))
        .bind(availability.title.as_str())
        .bind(work_kind_to_str(availability.kind))
        .bind(availability.release_date.map(format_datetime))
        .bind(format_datetime(availability.updated_at))
        .bind(content_hash)
}

#[async_trait]
impl PeerLeafAvailabilityRepo for SqlxPeerLeafAvailabilityRepo {
    async fn upsert(&self, availability: &PeerLeafAvailability) -> Result<(), DbError> {
        let leaf_selector = serde_json::to_string(&availability.leaf_selector)?;
        let hash = content_hash(availability, &leaf_selector);
        bind_upsert(availability, leaf_selector, hash)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn replace_for_peer(
        &self,
        peer_node_id: Uuid,
        rows: &[PeerLeafAvailability],
    ) -> Result<(), DbError> {
        // The peer's snapshot arrives complete every minute and mostly does
        // not change. Compare it with what is stored first, and write only the
        // rows that differ, so an unchanged snapshot takes no write lock and
        // no commit sync.
        //
        // The comparison reads `(media_file_id, content_hash)` from a covering
        // index on a pooled read connection, never inside the write
        // transaction: the write queue's single transaction is shared by every
        // writer, so nothing slow runs in it. The changes are then applied in
        // chunks of [`WRITE_CHUNK_ROWS`], one queue operation each, so other
        // queued writes commit between chunks. Each chunk is atomic; a reader
        // can see a snapshot part-way applied, which is harmless because the
        // table is a routing hint refreshed every minute. Upserts go first and
        // deletions last, so a file never disappears before its replacement
        // arrives.
        let lock = self
            .peer_locks
            .entry(peer_node_id)
            .or_default()
            .value()
            .clone();
        let _one_replacement_at_a_time = lock.lock().await;

        let prepared = Arc::new(prepare(rows)?);
        let stored = load_fingerprints(&self.pool, peer_node_id).await?;
        let diff = SnapshotDiff::between(&stored, &prepared);
        if diff.is_empty() {
            return Ok(());
        }
        for chunk in diff.changed.chunks(WRITE_CHUNK_ROWS) {
            let chunk: Arc<Vec<usize>> = Arc::new(chunk.to_vec());
            let prepared = prepared.clone();
            write(self.queue.as_ref(), &self.pool, move |conn| {
                let chunk = chunk.clone();
                let prepared = prepared.clone();
                Box::pin(async move {
                    for index in chunk.iter() {
                        let item = &prepared[*index];
                        bind_upsert(
                            &item.row,
                            item.leaf_selector.clone(),
                            item.content_hash.clone(),
                        )
                        .execute(&mut *conn)
                        .await?;
                    }
                    Ok(())
                })
            })
            .await?;
        }
        for chunk in diff.removed.chunks(WRITE_CHUNK_ROWS) {
            let chunk: Arc<Vec<String>> = Arc::new(chunk.to_vec());
            write(self.queue.as_ref(), &self.pool, move |conn| {
                let chunk = chunk.clone();
                Box::pin(async move {
                    for media_file_id in chunk.iter() {
                        sqlx::query(
                            "DELETE FROM peer_leaf_availability \
                             WHERE peer_node_id = ? AND media_file_id = ?",
                        )
                        .bind(peer_node_id.to_string())
                        .bind(media_file_id.as_str())
                        .execute(&mut *conn)
                        .await?;
                    }
                    Ok(())
                })
            })
            .await?;
        }
        Ok(())
    }

    async fn delete_for_peer(&self, peer_node_id: Uuid) -> Result<(), DbError> {
        let sql = "DELETE FROM peer_leaf_availability WHERE peer_node_id = ?";
        sqlx::query(sql)
            .bind(peer_node_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_for_peer(
        &self,
        peer_node_id: Uuid,
    ) -> Result<Vec<PeerLeafAvailability>, DbError> {
        let sql = format!(
            "SELECT {COLUMNS} FROM peer_leaf_availability WHERE peer_node_id = ? \
                 ORDER BY provider, external_id, leaf_selector"
        );
        let rows = sqlx::query(&sql)
            .bind(peer_node_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(from_row).collect()
    }

    async fn list_by_local_work_ids(
        &self,
        local_work_ids: &[Uuid],
    ) -> Result<Vec<PeerLeafAvailability>, DbError> {
        if local_work_ids.is_empty() {
            return Ok(Vec::new());
        }
        // No existing repo in this crate builds a caller-length `IN (...)`
        // list yet (see `work.rs`'s own note on why it still does an N+1
        // loop instead) -- this is the first one, so placeholders are built
        // per backend the same way every other query here already branches
        // on `self.backend` for `?` vs `$n` syntax, just repeated per bound
        // value instead of written out literally.
        let placeholders = vec!["?"; local_work_ids.len()].join(", ");
        let sql = format!(
            "SELECT {COLUMNS} FROM peer_leaf_availability \
             WHERE local_work_id IN ({placeholders}) \
             ORDER BY local_work_id, provider, external_id, peer_node_id"
        );
        let mut query = sqlx::query(&sql);
        for id in local_work_ids {
            query = query.bind(id.to_string());
        }
        let rows = query.fetch_all(&self.pool).await?;
        rows.iter().map(from_row).collect()
    }

    async fn list_unmatched_for_group(
        &self,
        group_library_id: Uuid,
    ) -> Result<Vec<PeerLeafAvailability>, DbError> {
        let sql = format!(
            "SELECT {COLUMNS} FROM peer_leaf_availability \
                 WHERE group_library_id = ? AND local_work_id IS NULL \
                 ORDER BY provider, external_id, peer_node_id"
        );
        let rows = sqlx::query(&sql)
            .bind(group_library_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(from_row).collect()
    }

    async fn list_for_leaf(
        &self,
        provider: &playarr_model::ExternalProvider,
        external_id: &str,
        leaf_selector: &playarr_model::LeafSelector,
    ) -> Result<Vec<PeerLeafAvailability>, DbError> {
        let leaf_selector = serde_json::to_string(leaf_selector)?;
        let sql = format!(
            "SELECT {COLUMNS} FROM peer_leaf_availability \
                 WHERE provider = ? AND external_id = ? AND leaf_selector = ? \
                 ORDER BY peer_node_id"
        );
        let rows = sqlx::query(&sql)
            .bind(provider_to_str(provider))
            .bind(external_id)
            .bind(leaf_selector)
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(from_row).collect()
    }
}

#[cfg(test)]
mod tests {
    use chrono::{SubsecRound, Utc};
    use playarr_model::{Availability, LeafSelector};

    use super::*;
    use crate::pool::test_sqlite_pool;

    /// `peer_leaf_availability` has no `REFERENCES` foreign key (see
    /// `0035_peer_leaf_availability.sql`'s own schema -- unlike
    /// `peer_nodes.group_id`, nothing here points at a parent row that
    /// needs seeding first), so every test can insert directly with
    /// whatever `Uuid`s it likes.
    fn sample(
        peer_node_id: Uuid,
        provider: playarr_model::ExternalProvider,
        external_id: &str,
        leaf_selector: LeafSelector,
    ) -> PeerLeafAvailability {
        let now = Utc::now().trunc_subsecs(3);
        PeerLeafAvailability {
            peer_node_id,
            media_file_id: Uuid::new_v4(),
            source_instance_id: Uuid::new_v4(),
            path: "/media/sample.mkv".to_string(),
            provider,
            external_id: external_id.to_string(),
            leaf_selector,
            group_library_id: Some(Uuid::new_v4()),
            availability: Availability::Available,
            container: Some("mkv".to_string()),
            codec: Some("h264".to_string()),
            bitrate: Some(8_000_000),
            // Deliberately bigger than `u32::MAX` to exercise the full
            // `u64` round trip through the `i64` storage column, same
            // reasoning as `media_file.rs`'s own sample fixture.
            size_bytes: Some(4_294_967_296),
            duration_ms: Some(7_200_000),
            local_work_id: Some(Uuid::new_v4()),
            title: "Sample Title".to_string(),
            kind: playarr_model::WorkKind::Movie,
            release_date: Some(now),
            updated_at: now,
        }
    }

    #[tokio::test]
    async fn upsert_then_list_for_peer_round_trips() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool);
        let peer_node_id = Uuid::new_v4();
        let row = sample(
            peer_node_id,
            playarr_model::ExternalProvider::Tmdb,
            "603",
            LeafSelector::Movie,
        );

        repo.upsert(&row).await.expect("upsert");
        let fetched = repo
            .list_for_peer(peer_node_id)
            .await
            .expect("list_for_peer");

        assert_eq!(fetched, vec![row]);
    }

    #[tokio::test]
    async fn upsert_updates_existing_row_by_primary_key() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool);
        let peer_node_id = Uuid::new_v4();
        let mut row = sample(
            peer_node_id,
            playarr_model::ExternalProvider::Tvdb,
            "12345",
            LeafSelector::Episode {
                season: 1,
                episode: 2,
            },
        );
        repo.upsert(&row).await.unwrap();

        row.availability = Availability::PartiallyAvailable;
        row.local_work_id = None;
        row.bitrate = Some(2_000_000);
        repo.upsert(&row).await.unwrap();

        let all = repo.list_for_peer(peer_node_id).await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0], row);
    }

    #[tokio::test]
    async fn upsert_same_title_different_leaf_selector_is_a_distinct_row() {
        // The same `(peer_node_id, provider, external_id)` with two
        // different `LeafSelector`s (e.g. two episodes of the same series)
        // must coexist as distinct physical-file rows.
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool);
        let peer_node_id = Uuid::new_v4();
        let episode_1 = sample(
            peer_node_id,
            playarr_model::ExternalProvider::Tvdb,
            "999",
            LeafSelector::Episode {
                season: 1,
                episode: 1,
            },
        );
        let episode_2 = sample(
            peer_node_id,
            playarr_model::ExternalProvider::Tvdb,
            "999",
            LeafSelector::Episode {
                season: 1,
                episode: 2,
            },
        );

        repo.upsert(&episode_1).await.unwrap();
        repo.upsert(&episode_2).await.unwrap();

        let all = repo.list_for_peer(peer_node_id).await.unwrap();
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn same_leaf_in_two_source_instances_keeps_both_physical_files() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool);
        let peer_node_id = Uuid::new_v4();
        let first = sample(
            peer_node_id,
            playarr_model::ExternalProvider::Tmdb,
            "603",
            LeafSelector::Movie,
        );
        let mut second = first.clone();
        second.media_file_id = Uuid::new_v4();
        second.source_instance_id = Uuid::new_v4();
        second.path = "/media/alternate/The Sample Movie.mkv".to_string();

        repo.upsert(&first).await.unwrap();
        repo.upsert(&second).await.unwrap();

        let all = repo.list_for_peer(peer_node_id).await.unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.contains(&first));
        assert!(all.contains(&second));
    }

    #[tokio::test]
    async fn list_for_peer_excludes_other_peers() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool);
        let peer_a = Uuid::new_v4();
        let peer_b = Uuid::new_v4();
        let row_a = sample(
            peer_a,
            playarr_model::ExternalProvider::Tmdb,
            "1",
            LeafSelector::Movie,
        );
        let row_b = sample(
            peer_b,
            playarr_model::ExternalProvider::Tmdb,
            "2",
            LeafSelector::Movie,
        );
        repo.upsert(&row_a).await.unwrap();
        repo.upsert(&row_b).await.unwrap();

        let fetched = repo.list_for_peer(peer_a).await.unwrap();
        assert_eq!(fetched, vec![row_a]);
    }

    #[tokio::test]
    async fn list_for_peer_empty_for_unknown_peer() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool);
        assert!(repo.list_for_peer(Uuid::new_v4()).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn list_by_local_work_ids_matches_requested_works_only() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool);
        let peer_node_id = Uuid::new_v4();

        let mut wanted = sample(
            peer_node_id,
            playarr_model::ExternalProvider::Tmdb,
            "1",
            LeafSelector::Movie,
        );
        let wanted_work_id = Uuid::new_v4();
        wanted.local_work_id = Some(wanted_work_id);

        let mut other = sample(
            peer_node_id,
            playarr_model::ExternalProvider::Tmdb,
            "2",
            LeafSelector::Movie,
        );
        other.local_work_id = Some(Uuid::new_v4());

        let mut unmatched = sample(
            peer_node_id,
            playarr_model::ExternalProvider::Tmdb,
            "3",
            LeafSelector::Movie,
        );
        unmatched.local_work_id = None;

        for row in [&wanted, &other, &unmatched] {
            repo.upsert(row).await.unwrap();
        }

        let fetched = repo
            .list_by_local_work_ids(&[wanted_work_id])
            .await
            .unwrap();
        assert_eq!(fetched, vec![wanted]);
    }

    #[tokio::test]
    async fn list_by_local_work_ids_matches_multiple_ids_across_multiple_peers() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool);
        let work_1 = Uuid::new_v4();
        let work_2 = Uuid::new_v4();

        let mut from_peer_a = sample(
            Uuid::new_v4(),
            playarr_model::ExternalProvider::Tmdb,
            "1",
            LeafSelector::Movie,
        );
        from_peer_a.local_work_id = Some(work_1);
        let mut from_peer_b = sample(
            Uuid::new_v4(),
            playarr_model::ExternalProvider::Tmdb,
            "2",
            LeafSelector::Movie,
        );
        from_peer_b.local_work_id = Some(work_2);

        repo.upsert(&from_peer_a).await.unwrap();
        repo.upsert(&from_peer_b).await.unwrap();

        let fetched = repo
            .list_by_local_work_ids(&[work_1, work_2])
            .await
            .unwrap();
        assert_eq!(fetched.len(), 2);
        let ids: Vec<Uuid> = fetched.iter().filter_map(|row| row.local_work_id).collect();
        assert!(ids.contains(&work_1));
        assert!(ids.contains(&work_2));
    }

    #[tokio::test]
    async fn list_by_local_work_ids_empty_input_returns_empty_without_querying() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool);
        let mut row = sample(
            Uuid::new_v4(),
            playarr_model::ExternalProvider::Tmdb,
            "1",
            LeafSelector::Movie,
        );
        row.local_work_id = Some(Uuid::new_v4());
        repo.upsert(&row).await.unwrap();

        assert!(repo.list_by_local_work_ids(&[]).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn list_unmatched_for_group_returns_only_null_local_work_id_rows_in_that_group() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool);
        let group_id = Uuid::new_v4();
        let other_group_id = Uuid::new_v4();

        let mut unmatched_in_group = sample(
            Uuid::new_v4(),
            playarr_model::ExternalProvider::Tmdb,
            "1",
            LeafSelector::Movie,
        );
        unmatched_in_group.group_library_id = Some(group_id);
        unmatched_in_group.local_work_id = None;

        let mut matched_in_group = sample(
            Uuid::new_v4(),
            playarr_model::ExternalProvider::Tmdb,
            "2",
            LeafSelector::Movie,
        );
        matched_in_group.group_library_id = Some(group_id);
        matched_in_group.local_work_id = Some(Uuid::new_v4());

        let mut unmatched_in_other_group = sample(
            Uuid::new_v4(),
            playarr_model::ExternalProvider::Tmdb,
            "3",
            LeafSelector::Movie,
        );
        unmatched_in_other_group.group_library_id = Some(other_group_id);
        unmatched_in_other_group.local_work_id = None;

        for row in [
            &unmatched_in_group,
            &matched_in_group,
            &unmatched_in_other_group,
        ] {
            repo.upsert(row).await.unwrap();
        }

        let fetched = repo.list_unmatched_for_group(group_id).await.unwrap();
        assert_eq!(fetched, vec![unmatched_in_group]);
    }

    #[tokio::test]
    async fn list_unmatched_for_group_empty_for_fully_matched_group() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool);
        let group_id = Uuid::new_v4();
        let mut row = sample(
            Uuid::new_v4(),
            playarr_model::ExternalProvider::Tmdb,
            "1",
            LeafSelector::Movie,
        );
        row.group_library_id = Some(group_id);
        row.local_work_id = Some(Uuid::new_v4());
        repo.upsert(&row).await.unwrap();

        assert!(repo
            .list_unmatched_for_group(group_id)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn list_for_leaf_returns_every_peers_row_for_the_exact_leaf_only() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool);
        let peer_a = Uuid::new_v4();
        let peer_b = Uuid::new_v4();

        let row_a = sample(
            peer_a,
            playarr_model::ExternalProvider::Tmdb,
            "603",
            LeafSelector::Movie,
        );
        let row_b = sample(
            peer_b,
            playarr_model::ExternalProvider::Tmdb,
            "603",
            LeafSelector::Movie,
        );
        // Same provider/external_id, different leaf -- must not match.
        let different_leaf = sample(
            peer_a,
            playarr_model::ExternalProvider::Tmdb,
            "603",
            LeafSelector::Episode {
                season: 1,
                episode: 1,
            },
        );
        // Same external_id, different provider -- must not match.
        let different_provider = sample(
            peer_a,
            playarr_model::ExternalProvider::Imdb,
            "603",
            LeafSelector::Movie,
        );
        // Different external_id entirely -- must not match.
        let different_external_id = sample(
            peer_a,
            playarr_model::ExternalProvider::Tmdb,
            "999",
            LeafSelector::Movie,
        );
        for row in [
            &row_a,
            &row_b,
            &different_leaf,
            &different_provider,
            &different_external_id,
        ] {
            repo.upsert(row).await.unwrap();
        }

        let mut fetched = repo
            .list_for_leaf(
                &playarr_model::ExternalProvider::Tmdb,
                "603",
                &LeafSelector::Movie,
            )
            .await
            .unwrap();
        fetched.sort_by_key(|row| row.peer_node_id);
        let mut expected = vec![row_a, row_b];
        expected.sort_by_key(|row| row.peer_node_id);
        assert_eq!(fetched, expected);
    }

    #[tokio::test]
    async fn list_for_leaf_empty_when_no_peer_reports_it() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool);

        let fetched = repo
            .list_for_leaf(
                &playarr_model::ExternalProvider::Tmdb,
                "603",
                &LeafSelector::Movie,
            )
            .await
            .unwrap();
        assert!(fetched.is_empty());
    }

    #[tokio::test]
    async fn all_track_and_book_leaf_selectors_round_trip() {
        // Exercises every `LeafSelector` variant, including the ones
        // `sample`'s other call sites don't touch (`Track`/`Book`, plus
        // `Track`'s optional `disc`), through the real JSON encode/decode
        // path in `upsert`/`from_row`.
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool);
        let peer_node_id = Uuid::new_v4();

        for (external_id, leaf_selector) in [
            ("a1", LeafSelector::Movie),
            (
                "a2",
                LeafSelector::Episode {
                    season: 3,
                    episode: 7,
                },
            ),
            (
                "a3",
                LeafSelector::Track {
                    disc: Some(2),
                    track: 5,
                },
            ),
            (
                "a4",
                LeafSelector::Track {
                    disc: None,
                    track: 1,
                },
            ),
            ("a5", LeafSelector::Book { index: 4 }),
        ] {
            let row = sample(
                peer_node_id,
                playarr_model::ExternalProvider::Tmdb,
                external_id,
                leaf_selector,
            );
            repo.upsert(&row).await.unwrap();
        }

        let all = repo.list_for_peer(peer_node_id).await.unwrap();
        assert_eq!(all.len(), 5);
    }

    /// The queued snapshot swap behaves like the direct one.
    #[tokio::test]
    async fn queued_replace_for_peer_swaps_one_peers_snapshot_only() {
        let pool = test_sqlite_pool().await;
        let queue = WriteQueue::spawn(pool.clone(), crate::WriteQueueConfig::default());
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool).with_write_queue(queue.clone());
        let (peer, other) = (Uuid::new_v4(), Uuid::new_v4());
        let tmdb = playarr_model::ExternalProvider::Tmdb;
        repo.upsert(&sample(peer, tmdb.clone(), "old", LeafSelector::Movie))
            .await
            .unwrap();
        repo.upsert(&sample(other, tmdb.clone(), "keep", LeafSelector::Movie))
            .await
            .unwrap();
        repo.replace_for_peer(
            peer,
            &[sample(peer, tmdb.clone(), "new", LeafSelector::Movie)],
        )
        .await
        .unwrap();
        let ids: Vec<_> = repo
            .list_for_peer(peer)
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.external_id)
            .collect();
        assert_eq!(ids, vec!["new"]);
        assert_eq!(repo.list_for_peer(other).await.unwrap().len(), 1);
        queue.shutdown().await;
    }

    #[tokio::test]
    async fn replace_for_peer_swaps_one_peers_snapshot_only() {
        let repo = SqlxPeerLeafAvailabilityRepo::new(test_sqlite_pool().await);
        let (peer, other) = (Uuid::new_v4(), Uuid::new_v4());
        let tmdb = playarr_model::ExternalProvider::Tmdb;
        repo.upsert(&sample(peer, tmdb.clone(), "old", LeafSelector::Movie))
            .await
            .unwrap();
        repo.upsert(&sample(other, tmdb.clone(), "keep", LeafSelector::Movie))
            .await
            .unwrap();
        let fresh = vec![
            sample(peer, tmdb.clone(), "new-a", LeafSelector::Movie),
            sample(peer, tmdb.clone(), "new-b", LeafSelector::Movie),
        ];
        repo.replace_for_peer(peer, &fresh).await.unwrap();
        let mut ids: Vec<_> = repo
            .list_for_peer(peer)
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.external_id)
            .collect();
        ids.sort();
        assert_eq!(ids, vec!["new-a", "new-b"]);
        assert_eq!(repo.list_for_peer(other).await.unwrap().len(), 1);
        repo.replace_for_peer(peer, &[]).await.unwrap();
        assert!(repo.list_for_peer(peer).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn replace_for_peer_writes_only_what_differs() {
        let repo = SqlxPeerLeafAvailabilityRepo::new(test_sqlite_pool().await);
        let (peer, other) = (Uuid::new_v4(), Uuid::new_v4());
        let tmdb = playarr_model::ExternalProvider::Tmdb;
        let mut kept = sample(peer, tmdb.clone(), "kept", LeafSelector::Movie);
        // Finer than the stored millisecond precision: must not count as a change.
        kept.release_date = Some(kept.updated_at + chrono::Duration::nanoseconds(123_456));
        let changed = sample(peer, tmdb.clone(), "changed", LeafSelector::Movie);
        let gone = sample(peer, tmdb.clone(), "gone", LeafSelector::Movie);
        let elsewhere = sample(other, tmdb.clone(), "elsewhere", LeafSelector::Movie);
        repo.replace_for_peer(peer, &[kept.clone(), changed.clone(), gone.clone()])
            .await
            .unwrap();
        repo.upsert(&elsewhere).await.unwrap();
        let first_updated_at = kept.updated_at;

        // The next snapshot was derived later: every `updated_at` moved on,
        // one row changed for real, one disappeared, one is new.
        let later = first_updated_at + chrono::Duration::seconds(60);
        let mut kept_again = kept.clone();
        kept_again.updated_at = later;
        let mut changed_again = changed.clone();
        changed_again.updated_at = later;
        changed_again.codec = Some("hevc".to_string());
        let mut added = sample(peer, tmdb.clone(), "added", LeafSelector::Movie);
        added.updated_at = later;
        repo.replace_for_peer(peer, &[kept_again, changed_again, added])
            .await
            .unwrap();

        let by_id: std::collections::HashMap<_, _> = repo
            .list_for_peer(peer)
            .await
            .unwrap()
            .into_iter()
            .map(|r| (r.external_id.clone(), r))
            .collect();
        assert_eq!(by_id.len(), 3);
        assert!(!by_id.contains_key("gone"));
        assert_eq!(
            by_id["kept"].updated_at, first_updated_at,
            "unchanged row not rewritten"
        );
        assert_eq!(by_id["changed"].codec.as_deref(), Some("hevc"));
        assert_eq!(by_id["changed"].updated_at, later);
        assert_eq!(by_id["added"].updated_at, later);
        assert_eq!(repo.list_for_peer(other).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn an_unchanged_snapshot_takes_no_write() {
        let path = std::env::temp_dir().join(format!("playarr-diff-{}.db", Uuid::new_v4()));
        let pool = crate::pool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        crate::pool::run_migrations(&pool).await.unwrap();
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool.clone());
        let peer = Uuid::new_v4();
        let rows: Vec<_> = (0..20)
            .map(|i| {
                sample(
                    peer,
                    playarr_model::ExternalProvider::Tmdb,
                    &format!("id{i}"),
                    LeafSelector::Movie,
                )
            })
            .collect();
        repo.replace_for_peer(peer, &rows).await.unwrap();
        // `data_version` only moves when ANOTHER connection commits, so hold a
        // reader connection and compare its view before and after.
        let mut watcher = pool.acquire().await.unwrap();
        let before: i64 = sqlx::query_scalar("PRAGMA data_version")
            .fetch_one(&mut *watcher)
            .await
            .unwrap();
        let mut again = rows.clone();
        for row in &mut again {
            row.updated_at += chrono::Duration::seconds(60);
        }
        repo.replace_for_peer(peer, &again).await.unwrap();
        let after: i64 = sqlx::query_scalar("PRAGMA data_version")
            .fetch_one(&mut *watcher)
            .await
            .unwrap();
        assert_eq!(before, after, "an unchanged snapshot must not commit");
        drop(watcher);
        let _ = std::fs::remove_file(&path);
    }

    async fn file_pool() -> (DbPool, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!("playarr-peerleaf-{}.db", Uuid::new_v4()));
        let pool = crate::pool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        crate::pool::run_migrations(&pool).await.unwrap();
        (pool, path)
    }

    fn remove_db(path: &std::path::Path) {
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    async fn plan(pool: &DbPool, sql: &str) -> Vec<String> {
        let rows = sqlx::query(&format!("EXPLAIN QUERY PLAN {sql}"))
            .bind(Uuid::new_v4().to_string())
            .fetch_all(pool)
            .await
            .unwrap();
        rows.iter()
            .map(|row| row.try_get::<String, _>("detail").unwrap())
            .collect()
    }

    /// Row 9935: the per-peer diff read must be answered from an index. The
    /// primary key already led with `peer_node_id`, so what was missing was a
    /// covering index: reading whole rows meant a table lookup per row and
    /// every wide column (long paths, titles) through the driver.
    #[tokio::test]
    async fn the_peer_diff_read_uses_a_covering_index_on_peer_node_id() {
        let (pool, path) = file_pool().await;
        let diff = plan(&pool, STORED_FINGERPRINTS_SQL).await;
        assert!(
            diff.iter().any(|step| step.contains("SEARCH")
                && step.contains("COVERING INDEX idx_peer_leaf_availability_diff")
                && step.contains("peer_node_id=?")),
            "diff read plan: {diff:?}"
        );
        assert!(
            !diff.iter().any(|step| step.contains("SCAN")),
            "diff read must not scan the table: {diff:?}"
        );
        // The whole-row listing is a keyed SEARCH too, never a table scan.
        let listing = plan(
            &pool,
            "SELECT * FROM peer_leaf_availability WHERE peer_node_id = ? \
             ORDER BY provider, external_id, leaf_selector",
        )
        .await;
        assert!(
            listing
                .iter()
                .any(|step| step.contains("SEARCH") && step.contains("peer_node_id=?")),
            "listing plan: {listing:?}"
        );
        assert!(
            !listing.iter().any(|step| step.starts_with("SCAN")),
            "listing must not scan the table: {listing:?}"
        );
        pool.close().await;
        remove_db(&path);
    }

    /// Rows stored before `content_hash` existed count as changed once, are
    /// rewritten with a hash, and then stop counting.
    #[tokio::test]
    async fn rows_without_a_hash_are_rewritten_once() {
        let (pool, path) = file_pool().await;
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool.clone());
        let peer = Uuid::new_v4();
        let rows: Vec<_> = (0..30)
            .map(|i| {
                sample(
                    peer,
                    playarr_model::ExternalProvider::Tmdb,
                    &format!("id{i}"),
                    LeafSelector::Movie,
                )
            })
            .collect();
        repo.replace_for_peer(peer, &rows).await.unwrap();
        sqlx::query("UPDATE peer_leaf_availability SET content_hash = NULL")
            .execute(&pool)
            .await
            .unwrap();
        let mut watcher = pool.acquire().await.unwrap();
        async fn version(conn: &mut sqlx::pool::PoolConnection<sqlx::Any>) -> sqlx::Result<i64> {
            sqlx::query_scalar("PRAGMA data_version")
                .fetch_one(&mut **conn)
                .await
        }
        let before = version(&mut watcher).await.unwrap();
        repo.replace_for_peer(peer, &rows).await.unwrap();
        let rewritten = version(&mut watcher).await.unwrap();
        assert_ne!(before, rewritten, "legacy rows are rewritten once");
        let hashed: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM peer_leaf_availability WHERE content_hash IS NOT NULL",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(hashed, 30);
        repo.replace_for_peer(peer, &rows).await.unwrap();
        assert_eq!(rewritten, version(&mut watcher).await.unwrap());
        drop(watcher);
        pool.close().await;
        remove_db(&path);
    }

    /// Every stored column except `updated_at` is part of the fingerprint.
    #[tokio::test]
    async fn a_change_to_any_content_column_is_written() {
        let repo = SqlxPeerLeafAvailabilityRepo::new(test_sqlite_pool().await);
        let peer = Uuid::new_v4();
        let base = sample(
            peer,
            playarr_model::ExternalProvider::Tmdb,
            "one",
            LeafSelector::Movie,
        );
        repo.replace_for_peer(peer, std::slice::from_ref(&base))
            .await
            .unwrap();
        let edits: [fn(&mut PeerLeafAvailability); 10] = [
            |r| r.path = "/media/other.mkv".into(),
            |r| r.container = None,
            |r| r.bitrate = Some(1),
            |r| r.size_bytes = Some(2),
            |r| r.duration_ms = None,
            |r| r.local_work_id = None,
            |r| r.title = "Renamed".into(),
            |r| r.group_library_id = None,
            |r| r.kind = playarr_model::WorkKind::Series,
            |r| {
                r.leaf_selector = LeafSelector::Episode {
                    season: 1,
                    episode: 2,
                }
            },
        ];
        for edit in edits {
            let mut next = base.clone();
            edit(&mut next);
            repo.replace_for_peer(peer, std::slice::from_ref(&next))
                .await
                .unwrap();
            let stored = repo.list_for_peer(peer).await.unwrap();
            assert_eq!(stored.len(), 1);
            assert_eq!(stored[0], next);
            repo.replace_for_peer(peer, std::slice::from_ref(&base))
                .await
                .unwrap();
            assert_eq!(repo.list_for_peer(peer).await.unwrap()[0], base);
        }
    }

    /// Concurrency (row 9935): reads of the inventory never wait for a write
    /// batch that is holding the database's write lock.
    #[tokio::test]
    async fn reads_are_not_blocked_by_a_long_write_batch() {
        let (pool, path) = file_pool().await;
        let queue = WriteQueue::spawn(
            pool.clone(),
            crate::write_queue::WriteQueueConfig::default(),
        );
        let repo = Arc::new(
            SqlxPeerLeafAvailabilityRepo::new(pool.clone()).with_write_queue(queue.clone()),
        );
        let peer = Uuid::new_v4();
        let rows = inventory(peer, 3_000);
        repo.replace_for_peer(peer, &rows).await.unwrap();

        // A write operation that takes the write lock, writes, and sits on it.
        let started = Arc::new(tokio::sync::Notify::new());
        let hold = {
            let (queue, started) = (queue.clone(), started.clone());
            tokio::spawn(async move {
                queue
                    .submit(move |conn| {
                        let started = started.clone();
                        Box::pin(async move {
                            sqlx::query(
                                "DELETE FROM peer_leaf_availability WHERE peer_node_id = ?",
                            )
                            .bind(Uuid::new_v4().to_string())
                            .execute(&mut *conn)
                            .await?;
                            started.notify_one();
                            tokio::time::sleep(std::time::Duration::from_millis(4_000)).await;
                            Ok(())
                        })
                    })
                    .await
            })
        };
        started.notified().await;

        // The diff read, an unchanged replacement (which only reads) and the
        // whole-row listing all answer while the write lock is held. Reads
        // that waited for the lock could not finish before the batch does, so
        // the batch still running afterwards is the assertion (it does not
        // depend on how fast this machine is).
        assert_eq!(load_fingerprints(&pool, peer).await.unwrap().len(), 3_000);
        repo.replace_for_peer(peer, &rows).await.unwrap();
        assert_eq!(repo.list_for_peer(peer).await.unwrap().len(), 3_000);
        assert!(
            !hold.is_finished(),
            "the reads only finished after the write batch released the lock"
        );
        hold.await.unwrap().unwrap();
        queue.shutdown().await;
        pool.close().await;
        remove_db(&path);
    }

    /// Concurrency (row 9935): replacing a big snapshot is applied in chunks,
    /// so other queued writes commit while it is still going instead of
    /// waiting for the whole replacement.
    #[tokio::test]
    async fn a_big_replacement_lets_other_writes_in_between_chunks() {
        let (pool, path) = file_pool().await;
        sqlx::query("CREATE TABLE beat (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        let queue = WriteQueue::spawn(
            pool.clone(),
            crate::write_queue::WriteQueueConfig::default(),
        );
        let repo = Arc::new(
            SqlxPeerLeafAvailabilityRepo::new(pool.clone()).with_write_queue(queue.clone()),
        );
        let peer = Uuid::new_v4();
        let rows = inventory(peer, WRITE_CHUNK_ROWS * 6);
        let before = queue.stats().ops;
        let replacing = {
            let (repo, rows) = (repo.clone(), rows.clone());
            tokio::spawn(async move { repo.replace_for_peer(peer, &rows).await })
        };
        let mut finished_during = 0;
        let mut beats = 0;
        while !replacing.is_finished() {
            beats += 1;
            queue
                .submit(move |conn| {
                    Box::pin(async move {
                        sqlx::query("INSERT INTO beat (n) VALUES (?)")
                            .bind(beats)
                            .execute(&mut *conn)
                            .await?;
                        Ok(())
                    })
                })
                .await
                .unwrap();
            if !replacing.is_finished() {
                finished_during += 1;
            }
        }
        replacing.await.unwrap().unwrap();
        assert!(
            finished_during >= 2,
            "other writes should commit between chunks ({finished_during} did)"
        );
        // Six chunks of rows, not one operation holding the lock throughout.
        let replace_ops = queue.stats().ops - before - beats as u64;
        assert_eq!(replace_ops, 6, "one queue operation per chunk");
        assert_eq!(repo.list_for_peer(peer).await.unwrap().len(), rows.len());
        queue.shutdown().await;
        pool.close().await;
        remove_db(&path);
    }

    /// A pull and a push for the same peer arriving together apply one after
    /// the other, so the older snapshot cannot land on top of the newer one.
    #[tokio::test]
    async fn concurrent_replacements_of_one_peer_apply_in_turn() {
        let (pool, path) = file_pool().await;
        let repo = Arc::new(SqlxPeerLeafAvailabilityRepo::new(pool.clone()));
        let peer = Uuid::new_v4();
        let first = inventory(peer, 600);
        let second: Vec<_> = first.iter().take(300).cloned().collect();
        let (a, b) = tokio::join!(
            repo.replace_for_peer(peer, &first),
            repo.replace_for_peer(peer, &second)
        );
        a.unwrap();
        b.unwrap();
        let stored = repo.list_for_peer(peer).await.unwrap().len();
        assert!(stored == 600 || stored == 300, "got {stored}");
        // Whichever ran last, the table matches exactly one of the snapshots.
        pool.close().await;
        remove_db(&path);
    }

    /// Timing evidence (run with `--ignored --nocapture`): an unchanged
    /// 2,000-row snapshot on a file database with the production pragmas,
    /// delete-and-reinsert versus the diff.
    #[tokio::test]
    #[ignore]
    async fn bench_unchanged_snapshot_replace() {
        let path = std::env::temp_dir().join(format!("playarr-bench-{}.db", Uuid::new_v4()));
        let pool = crate::pool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        crate::pool::run_migrations(&pool).await.unwrap();
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool.clone());
        let peer = Uuid::new_v4();
        let rows: Vec<_> = (0..2_000)
            .map(|i| {
                sample(
                    peer,
                    playarr_model::ExternalProvider::Tmdb,
                    &format!("id{i}"),
                    LeafSelector::Movie,
                )
            })
            .collect();
        repo.replace_for_peer(peer, &rows).await.unwrap();
        let t = std::time::Instant::now();
        let mut tx = pool.begin().await.unwrap();
        sqlx::query("DELETE FROM peer_leaf_availability WHERE peer_node_id = ?")
            .bind(peer.to_string())
            .execute(&mut *tx)
            .await
            .unwrap();
        for row in &rows {
            let leaf_selector = serde_json::to_string(&row.leaf_selector).unwrap();
            let hash = content_hash(row, &leaf_selector);
            bind_upsert(row, leaf_selector, hash)
                .execute(&mut *tx)
                .await
                .unwrap();
        }
        tx.commit().await.unwrap();
        let old = t.elapsed();
        let t = std::time::Instant::now();
        repo.replace_for_peer(peer, &rows).await.unwrap();
        println!(
            "2000 unchanged rows: delete and reinsert {old:?}, diff {:?}",
            t.elapsed()
        );
        let _ = std::fs::remove_file(&path);
    }

    /// Timing evidence for the batching (run with `--ignored --nocapture`):
    /// rows written one commit each versus in one transaction, on a file
    /// database with the production pragmas.
    #[tokio::test]
    #[ignore]
    async fn bench_replace_for_peer_commit_cost() {
        let path = std::env::temp_dir().join(format!("playarr-bench-{}.db", Uuid::new_v4()));
        let pool = crate::pool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        crate::pool::run_migrations(&pool).await.unwrap();
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool);
        let peer = Uuid::new_v4();
        let rows: Vec<_> = (0..500)
            .map(|i| {
                sample(
                    peer,
                    playarr_model::ExternalProvider::Tmdb,
                    &format!("id{i}"),
                    LeafSelector::Movie,
                )
            })
            .collect();
        let t = std::time::Instant::now();
        repo.delete_for_peer(peer).await.unwrap();
        for r in &rows {
            repo.upsert(r).await.unwrap();
        }
        let per_row = t.elapsed();
        let t = std::time::Instant::now();
        repo.replace_for_peer(peer, &rows).await.unwrap();
        println!(
            "500 rows: per-row commits {per_row:?}, one transaction {:?}",
            t.elapsed()
        );
        let _ = std::fs::remove_file(&path);
    }

    /// Rows shaped like a real peer inventory: distinct file ids, long paths,
    /// episode selectors, and a title per work.
    fn inventory(peer: Uuid, count: usize) -> Vec<PeerLeafAvailability> {
        (0..count)
            .map(|i| {
                let mut row = sample(
                    peer,
                    playarr_model::ExternalProvider::Tmdb,
                    &format!("{}", 1000 + i / 20),
                    LeafSelector::Episode {
                        season: (i / 10 % 5) as u32 + 1,
                        episode: (i % 10) as u32 + 1,
                    },
                );
                row.path = format!(
                    "/srv/media/series/Sample Series {}/Season {:02}/Sample Series {} - S{:02}E{:02} - Episode Title.mkv",
                    i / 20, i / 10 % 5 + 1, i / 20, i / 10 % 5 + 1, i % 10 + 1
                );
                row.title = format!("Sample Series {}", i / 20);
                row
            })
            .collect()
    }

    /// Timing evidence (run with `--ignored --nocapture --release`): the
    /// diff read of one peer's inventory next to another peer's, on a file
    /// database with the production pragmas.
    #[tokio::test]
    #[ignore]
    async fn bench_peer_inventory_read_and_replace() {
        let path = std::env::temp_dir().join(format!("playarr-bench-{}.db", Uuid::new_v4()));
        let pool = crate::pool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        crate::pool::run_migrations(&pool).await.unwrap();
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool.clone());
        let (peer, other) = (Uuid::new_v4(), Uuid::new_v4());
        println!(
            "plan, whole rows: {:?}",
            plan(
                &pool,
                &format!("SELECT {COLUMNS} FROM peer_leaf_availability WHERE peer_node_id = ?")
            )
            .await
        );
        println!(
            "plan, fingerprints: {:?}",
            plan(&pool, STORED_FINGERPRINTS_SQL).await
        );
        let rows = inventory(peer, 50_000);
        let t = std::time::Instant::now();
        repo.replace_for_peer(peer, &rows).await.unwrap();
        repo.replace_for_peer(other, &inventory(other, 50_000))
            .await
            .unwrap();
        println!("seed 2 x 50k rows: {:?}", t.elapsed());
        let t = std::time::Instant::now();
        let stored = load_fingerprints(&pool, peer).await.unwrap();
        println!("load_fingerprints {} rows: {:?}", stored.len(), t.elapsed());
        let t = std::time::Instant::now();
        let full = repo.list_for_peer(peer).await.unwrap();
        println!(
            "list_for_peer (all columns) {} rows: {:?}",
            full.len(),
            t.elapsed()
        );
        let t = std::time::Instant::now();
        repo.replace_for_peer(peer, &rows).await.unwrap();
        println!("replace unchanged: {:?}", t.elapsed());
        let mut moved = rows.clone();
        for row in moved.iter_mut().step_by(100) {
            row.size_bytes = Some(1);
        }
        let t = std::time::Instant::now();
        repo.replace_for_peer(peer, &moved).await.unwrap();
        println!("replace 500 changed: {:?}", t.elapsed());
        let _ = std::fs::remove_file(&path);
    }
}
