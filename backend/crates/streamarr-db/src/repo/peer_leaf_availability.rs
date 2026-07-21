//! Cross-node leaf availability cache -- Phase 2 of
//! `docs/architecture/peer-groups.md` (see that document's §2.3/§4 for the
//! full design and rationale).
//!
//! One row per leaf (movie / episode / track / book) an OTHER peer reports
//! having, keyed by the table's own primary key --
//! `(peer_node_id, provider, external_id, leaf_selector)`. Never written for
//! `peer_node_id` = self: this node's own availability is a live read of its
//! own [`crate::repo::MediaFileRepo`], not cached here. Never a second
//! writer of `works`/`media_files` -- see §4.1 for why `Work`/`MediaFile`
//! stay strictly node-local and single-writer, with `availability_sync.rs`
//! (`streamarr-peer-sync`) as this table's only writer.
//!
//! `local_work_id` is a cache of the local `Work` this row matches,
//! recomputed at ingest by the external-ref-match algorithm §4.2 describes;
//! `NULL` means this peer has zero local record of the title at all -- the
//! partial-cache-node case, read back here via
//! [`PeerLeafAvailabilityRepo::list_unmatched_for_group`] (§4.3).

use async_trait::async_trait;
use sqlx::any::AnyRow;
use sqlx::Row;
use streamarr_model::PeerLeafAvailability;
use uuid::Uuid;

use crate::codec::{
    availability_from_str, availability_to_str, format_datetime, parse_datetime, parse_uuid,
    provider_from_str, provider_to_str, work_kind_from_str, work_kind_to_str,
};
use crate::error::DbError;
use crate::pool::{Backend, DbPool};

// `leaf_selector` round-trips through its own serde-derived JSON form
// (`LeafSelector`'s `#[serde(rename_all = "snake_case")]`) directly via
// `serde_json::to_string`/`from_str` at the call sites below -- the same
// "JSON-encode the type's own wire form into a TEXT column" convention
// `peer_node.rs` uses for `PeerNode::addresses`, rather than inventing a
// bespoke compact encoding the way `crate::codec::leaf_ref_to_str` does for
// the (much smaller) `LeafRef`.

fn from_row(row: &AnyRow) -> Result<PeerLeafAvailability, DbError> {
    let peer_node_id: String = row.try_get("peer_node_id")?;
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

const COLUMNS: &str = "peer_node_id, provider, external_id, leaf_selector, group_library_id, \
                        availability, container, codec, bitrate, size_bytes, duration_ms, \
                        local_work_id, title, kind, release_date, updated_at";

/// Read-only, per-peer annotation of what leaves (movie / episode / track /
/// book) each OTHER peer reports having. See
/// `docs/architecture/peer-groups.md` §2.3/§4.
#[async_trait]
pub trait PeerLeafAvailabilityRepo: Send + Sync {
    /// Insert-or-update keyed by the table's own primary key --
    /// `(peer_node_id, provider, external_id, leaf_selector)` -- exactly
    /// what `availability_sync.rs`'s ingest loop calls for every row a peer
    /// reports via `GET /api/v1/peer/availability` (§3.1/§4.2).
    async fn upsert(&self, availability: &PeerLeafAvailability) -> Result<(), DbError>;

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

    /// Every peer's reported row for one exact leaf -- keyed on the same
    /// `(provider, external_id, leaf_selector)` triple that, together with
    /// `peer_node_id`, forms this table's own primary key. Phase 3's
    /// routing-context gathering (`streamarr-api::playback::
    /// resolve_route_for_local_media_file`/
    /// `by_external_ref_playback_info_handler`, `docs/architecture/
    /// peer-groups.md` §5.2) is this method's caller: it needs "does any
    /// peer report *this specific* leaf available" for one already-known
    /// leaf identity, not a whole peer's or a whole group-library's rows.
    async fn list_for_leaf(
        &self,
        provider: &streamarr_model::ExternalProvider,
        external_id: &str,
        leaf_selector: &streamarr_model::LeafSelector,
    ) -> Result<Vec<PeerLeafAvailability>, DbError>;
}

pub struct SqlxPeerLeafAvailabilityRepo {
    pool: DbPool,
    backend: Backend,
}

impl SqlxPeerLeafAvailabilityRepo {
    pub fn new(pool: DbPool) -> Self {
        let backend = Backend::detect(&pool);
        Self { pool, backend }
    }
}

#[async_trait]
impl PeerLeafAvailabilityRepo for SqlxPeerLeafAvailabilityRepo {
    async fn upsert(&self, availability: &PeerLeafAvailability) -> Result<(), DbError> {
        let leaf_selector = serde_json::to_string(&availability.leaf_selector)?;
        let sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO peer_leaf_availability \
                 (peer_node_id, provider, external_id, leaf_selector, group_library_id, \
                 availability, container, codec, bitrate, size_bytes, duration_ms, \
                 local_work_id, title, kind, release_date, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT (peer_node_id, provider, external_id, leaf_selector) DO UPDATE SET \
                 group_library_id = excluded.group_library_id, \
                 availability = excluded.availability, container = excluded.container, \
                 codec = excluded.codec, bitrate = excluded.bitrate, \
                 size_bytes = excluded.size_bytes, duration_ms = excluded.duration_ms, \
                 local_work_id = excluded.local_work_id, title = excluded.title, \
                 kind = excluded.kind, release_date = excluded.release_date, \
                 updated_at = excluded.updated_at"
            }
            Backend::Postgres => {
                "INSERT INTO peer_leaf_availability \
                 (peer_node_id, provider, external_id, leaf_selector, group_library_id, \
                 availability, container, codec, bitrate, size_bytes, duration_ms, \
                 local_work_id, title, kind, release_date, updated_at) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) \
                 ON CONFLICT (peer_node_id, provider, external_id, leaf_selector) DO UPDATE SET \
                 group_library_id = excluded.group_library_id, \
                 availability = excluded.availability, container = excluded.container, \
                 codec = excluded.codec, bitrate = excluded.bitrate, \
                 size_bytes = excluded.size_bytes, duration_ms = excluded.duration_ms, \
                 local_work_id = excluded.local_work_id, title = excluded.title, \
                 kind = excluded.kind, release_date = excluded.release_date, \
                 updated_at = excluded.updated_at"
            }
        };
        sqlx::query(sql)
            .bind(availability.peer_node_id.to_string())
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
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_for_peer(
        &self,
        peer_node_id: Uuid,
    ) -> Result<Vec<PeerLeafAvailability>, DbError> {
        let sql = match self.backend {
            Backend::Sqlite => format!(
                "SELECT {COLUMNS} FROM peer_leaf_availability WHERE peer_node_id = ? \
                 ORDER BY provider, external_id, leaf_selector"
            ),
            Backend::Postgres => format!(
                "SELECT {COLUMNS} FROM peer_leaf_availability WHERE peer_node_id = $1 \
                 ORDER BY provider, external_id, leaf_selector"
            ),
        };
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
        let placeholders = match self.backend {
            Backend::Sqlite => vec!["?"; local_work_ids.len()].join(", "),
            Backend::Postgres => (1..=local_work_ids.len())
                .map(|i| format!("${i}"))
                .collect::<Vec<_>>()
                .join(", "),
        };
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
        let sql = match self.backend {
            Backend::Sqlite => format!(
                "SELECT {COLUMNS} FROM peer_leaf_availability \
                 WHERE group_library_id = ? AND local_work_id IS NULL \
                 ORDER BY provider, external_id, peer_node_id"
            ),
            Backend::Postgres => format!(
                "SELECT {COLUMNS} FROM peer_leaf_availability \
                 WHERE group_library_id = $1 AND local_work_id IS NULL \
                 ORDER BY provider, external_id, peer_node_id"
            ),
        };
        let rows = sqlx::query(&sql)
            .bind(group_library_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(from_row).collect()
    }

    async fn list_for_leaf(
        &self,
        provider: &streamarr_model::ExternalProvider,
        external_id: &str,
        leaf_selector: &streamarr_model::LeafSelector,
    ) -> Result<Vec<PeerLeafAvailability>, DbError> {
        let leaf_selector = serde_json::to_string(leaf_selector)?;
        let sql = match self.backend {
            Backend::Sqlite => format!(
                "SELECT {COLUMNS} FROM peer_leaf_availability \
                 WHERE provider = ? AND external_id = ? AND leaf_selector = ? \
                 ORDER BY peer_node_id"
            ),
            Backend::Postgres => format!(
                "SELECT {COLUMNS} FROM peer_leaf_availability \
                 WHERE provider = $1 AND external_id = $2 AND leaf_selector = $3 \
                 ORDER BY peer_node_id"
            ),
        };
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
    use streamarr_model::{Availability, LeafSelector};

    use super::*;
    use crate::pool::test_sqlite_pool;

    /// `peer_leaf_availability` has no `REFERENCES` foreign key (see
    /// `0035_peer_leaf_availability.sql`'s own schema -- unlike
    /// `peer_nodes.group_id`, nothing here points at a parent row that
    /// needs seeding first), so every test can insert directly with
    /// whatever `Uuid`s it likes.
    fn sample(
        peer_node_id: Uuid,
        provider: streamarr_model::ExternalProvider,
        external_id: &str,
        leaf_selector: LeafSelector,
    ) -> PeerLeafAvailability {
        let now = Utc::now().trunc_subsecs(3);
        PeerLeafAvailability {
            peer_node_id,
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
            kind: streamarr_model::WorkKind::Movie,
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
            streamarr_model::ExternalProvider::Tmdb,
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
            streamarr_model::ExternalProvider::Tvdb,
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
        // must coexist -- confirms `leaf_selector` is really part of the
        // conflict target, not silently collapsed away.
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool);
        let peer_node_id = Uuid::new_v4();
        let episode_1 = sample(
            peer_node_id,
            streamarr_model::ExternalProvider::Tvdb,
            "999",
            LeafSelector::Episode {
                season: 1,
                episode: 1,
            },
        );
        let episode_2 = sample(
            peer_node_id,
            streamarr_model::ExternalProvider::Tvdb,
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
    async fn list_for_peer_excludes_other_peers() {
        let pool = test_sqlite_pool().await;
        let repo = SqlxPeerLeafAvailabilityRepo::new(pool);
        let peer_a = Uuid::new_v4();
        let peer_b = Uuid::new_v4();
        let row_a = sample(
            peer_a,
            streamarr_model::ExternalProvider::Tmdb,
            "1",
            LeafSelector::Movie,
        );
        let row_b = sample(
            peer_b,
            streamarr_model::ExternalProvider::Tmdb,
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
            streamarr_model::ExternalProvider::Tmdb,
            "1",
            LeafSelector::Movie,
        );
        let wanted_work_id = Uuid::new_v4();
        wanted.local_work_id = Some(wanted_work_id);

        let mut other = sample(
            peer_node_id,
            streamarr_model::ExternalProvider::Tmdb,
            "2",
            LeafSelector::Movie,
        );
        other.local_work_id = Some(Uuid::new_v4());

        let mut unmatched = sample(
            peer_node_id,
            streamarr_model::ExternalProvider::Tmdb,
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
            streamarr_model::ExternalProvider::Tmdb,
            "1",
            LeafSelector::Movie,
        );
        from_peer_a.local_work_id = Some(work_1);
        let mut from_peer_b = sample(
            Uuid::new_v4(),
            streamarr_model::ExternalProvider::Tmdb,
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
            streamarr_model::ExternalProvider::Tmdb,
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
            streamarr_model::ExternalProvider::Tmdb,
            "1",
            LeafSelector::Movie,
        );
        unmatched_in_group.group_library_id = Some(group_id);
        unmatched_in_group.local_work_id = None;

        let mut matched_in_group = sample(
            Uuid::new_v4(),
            streamarr_model::ExternalProvider::Tmdb,
            "2",
            LeafSelector::Movie,
        );
        matched_in_group.group_library_id = Some(group_id);
        matched_in_group.local_work_id = Some(Uuid::new_v4());

        let mut unmatched_in_other_group = sample(
            Uuid::new_v4(),
            streamarr_model::ExternalProvider::Tmdb,
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
            streamarr_model::ExternalProvider::Tmdb,
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
            streamarr_model::ExternalProvider::Tmdb,
            "603",
            LeafSelector::Movie,
        );
        let row_b = sample(
            peer_b,
            streamarr_model::ExternalProvider::Tmdb,
            "603",
            LeafSelector::Movie,
        );
        // Same provider/external_id, different leaf -- must not match.
        let different_leaf = sample(
            peer_a,
            streamarr_model::ExternalProvider::Tmdb,
            "603",
            LeafSelector::Episode {
                season: 1,
                episode: 1,
            },
        );
        // Same external_id, different provider -- must not match.
        let different_provider = sample(
            peer_a,
            streamarr_model::ExternalProvider::Imdb,
            "603",
            LeafSelector::Movie,
        );
        // Different external_id entirely -- must not match.
        let different_external_id = sample(
            peer_a,
            streamarr_model::ExternalProvider::Tmdb,
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
            .list_for_leaf(&streamarr_model::ExternalProvider::Tmdb, "603", &LeafSelector::Movie)
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
            .list_for_leaf(&streamarr_model::ExternalProvider::Tmdb, "603", &LeafSelector::Movie)
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
                streamarr_model::ExternalProvider::Tmdb,
                external_id,
                leaf_selector,
            );
            repo.upsert(&row).await.unwrap();
        }

        let all = repo.list_for_peer(peer_node_id).await.unwrap();
        assert_eq!(all.len(), 5);
    }
}
