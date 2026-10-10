//! Syncs `peer_leaf_availability` via `GET /api/v1/peer/availability` --
//! `docs/architecture/peer-groups.md` §3.6/§4.2.
//!
//! For each row a peer reports, [`resolve_local_work`] resolves
//! `(provider, external_id)` against this node's own [`WorkRepo`], writing
//! the match (or `None`) into `PeerLeafAvailability::local_work_id` --
//! never a second writer of `works`/`media_files` themselves (§4.1).
//!
//! **Porting `clients/tv-web/web/src/lib/joinedServers.ts`'s
//! `workIdentityKeys`/`fallbackIdentity`, and where this port deliberately
//! broadens it:** the client-side algorithm builds one identity key per
//! `ExternalRef` a `Work` carries, and falls back to a normalized-title +
//! release-year key *only* when a `Work` has zero external refs at all --
//! two works with different single external refs (e.g. a `Tmdb` ref on one
//! peer, `Imdb` on another) are never merged there either. That narrower
//! trigger doesn't fit this call site: every row on `GET /api/v1/peer/
//! availability` carries a definite `(provider, external_id)` by
//! construction (`peer_leaf_availability`'s own schema makes both columns
//! `NOT NULL`), so a literal port would never exercise the fallback path at
//! all. This module instead always tries the exact external-ref match
//! first and, only when that finds nothing locally, tries the
//! normalized-title + release-year fallback -- the same matching
//! *primitive* the client uses, applied unconditionally as a second pass
//! rather than gated on "zero refs." This is what lets a node cataloguing
//! the same title through a different metadata provider than its peer
//! still resolve a badge/match instead of silently reporting "not found."
//!
//! Title normalization here is plain `trim` + `to_lowercase`, not the
//! client's `String.prototype.normalize("NFKC")` -- full Unicode
//! normalization needs a dependency (`unicode-normalization`) this
//! workspace doesn't otherwise pull in, and this fallback path is already a
//! secondary, best-effort match behind the exact external-ref check, not
//! the primary identity signal.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use playarr_db::{PeerLeafAvailabilityRepo, WorkRepo};
use playarr_model::{
    Availability, ExternalProvider, ExternalRef, LeafSelector, PeerLeafAvailability, WorkKind,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::peer_client::{PeerClient, PeerClientError};

#[derive(Debug, thiserror::Error)]
pub enum AvailabilitySyncError {
    #[error(transparent)]
    PeerClient(#[from] PeerClientError),
    #[error(transparent)]
    Db(#[from] playarr_db::DbError),
}

/// One `peer_leaf_availability` row on the wire. `title`/`kind`/
/// `release_date` are the reporting peer's own values: [`resolve_local_work`]
/// reads them for its title/year fallback when the exact external ref isn't
/// already known locally, and `sync_availability` below persists them onto
/// `PeerLeafAvailability` verbatim (regardless of whether a local match was
/// found) so the partial-cache-node `RemoteOnlyWork` case
/// (`playarr-catalog`'s browse/search hydration, §4.3) has something to
/// display when `local_work_id` ends up `None` -- there is no local `Work`
/// row to read a title/kind from in that case.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailabilityRow {
    pub media_file_id: Uuid,
    pub source_instance_id: Uuid,
    pub path: String,
    pub provider: ExternalProvider,
    pub external_id: String,
    pub leaf_selector: LeafSelector,
    pub group_library_id: Option<Uuid>,
    pub availability: Availability,
    pub container: Option<String>,
    pub codec: Option<String>,
    pub bitrate: Option<u64>,
    pub size_bytes: Option<u64>,
    pub duration_ms: Option<u64>,
    pub updated_at: DateTime<Utc>,
    pub title: String,
    pub kind: WorkKind,
    pub release_date: Option<DateTime<Utc>>,
}

/// Wire shape of `GET /api/v1/peer/availability?since=`'s response body.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailabilityResponse {
    pub rows: Vec<AvailabilityRow>,
    pub server_time: String,
}

/// Sync-state entity under which a receiver remembers the [`wire_digest`] of
/// the snapshot it currently holds for a peer.
pub const WIRE_DIGEST_ENTITY: &str = "availability_digest";

/// A short fingerprint of a whole availability snapshot as it travels: the row
/// count and an order-independent combination of one hash per row. Every field
/// counts except `updated_at`, which records when the sender derived the
/// snapshot and moves on every derivation without the inventory changing.
///
/// A sender uses it to learn that the receiver already holds exactly this
/// snapshot (the receiver echoes the digest it holds) and leaves the rows out
/// of the next push; a receiver that is told "unchanged" with a digest it does
/// not hold ignores it and answers with what it does hold, so the sender
/// sends the rows again. It only has to tell two snapshots of one signed peer
/// apart.
pub fn wire_digest(rows: &[AvailabilityRow]) -> String {
    use sha2::{Digest, Sha256};
    let sum = rows.iter().fold(0u128, |acc, row| {
        let encoded = serde_json::to_vec(&(
            &row.media_file_id,
            &row.source_instance_id,
            &row.path,
            &row.provider,
            &row.external_id,
            &row.leaf_selector,
            &row.group_library_id,
            &row.availability,
            &row.container,
            &row.codec,
            &row.bitrate,
            &row.size_bytes,
            &row.duration_ms,
            &row.title,
            &row.kind,
            &row.release_date,
        ))
        .unwrap_or_default();
        let digest = Sha256::digest(&encoded);
        let mut head = [0u8; 16];
        head.copy_from_slice(&digest[..16]);
        acc.wrapping_add(u128::from_be_bytes(head))
    });
    format!("{}-{sum:032x}", rows.len())
}

/// Lowercased, trimmed title -- see this module's own doc comment for why
/// this isn't full NFKC normalization.
fn normalized_title(title: &str) -> String {
    title.trim().to_lowercase()
}

/// The portable fallback identity for one title: `kind`, normalized title,
/// and release year (empty string when unknown) -- ported from
/// `joinedServers.ts`'s `fallbackIdentity` function.
fn fallback_identity(kind: WorkKind, title: &str, release_date: Option<DateTime<Utc>>) -> String {
    let year = release_date
        .map(|date| date.format("%Y").to_string())
        .unwrap_or_default();
    format!("fallback:{kind:?}:{}:{year}", normalized_title(title))
}

/// Resolves one wire [`AvailabilityRow`] against this node's own
/// [`WorkRepo`]: exact `(provider, external_id)` match first, normalized-
/// title + release-year fallback second (see this module's own doc
/// comment). `None` means this node has zero local record of the title at
/// all -- the partial-cache-node case, §4.3.
pub async fn resolve_local_work(
    work_repo: &Arc<dyn WorkRepo>,
    row: &AvailabilityRow,
) -> Result<Option<Uuid>, playarr_db::DbError> {
    if let Some(work) = work_repo
        .find_by_external_ref(&row.provider, &row.external_id)
        .await?
    {
        return Ok(Some(work.id));
    }

    let target = fallback_identity(row.kind, &row.title, row.release_date);
    const PAGE_SIZE: i64 = 200;
    let mut offset: i64 = 0;
    loop {
        let page = work_repo.list_by_kind(row.kind, PAGE_SIZE, offset).await?;
        let got = page.len() as i64;
        if let Some(matched) = page
            .iter()
            .find(|work| fallback_identity(work.kind, &work.title, work.release_date) == target)
        {
            return Ok(Some(matched.id));
        }
        if got < PAGE_SIZE {
            return Ok(None);
        }
        offset += PAGE_SIZE;
    }
}

/// Fallback identity to work id for every local work of `kind`, the first in
/// `list_identities` order winning a shared identity.
async fn fallback_index(
    work_repo: &Arc<dyn WorkRepo>,
    kind: WorkKind,
) -> Result<HashMap<String, Uuid>, playarr_db::DbError> {
    let mut index: HashMap<String, Uuid> = HashMap::new();
    for work in work_repo.list_identities(kind).await? {
        index
            .entry(fallback_identity(kind, &work.title, work.release_date))
            .or_insert(work.id);
    }
    Ok(index)
}

/// [`resolve_local_work`] for a whole snapshot, with the same answers.
///
/// Resolving row by row costs one lookup per row plus, for every row whose
/// external ref is unknown here, a walk over the node's whole catalogue of
/// that kind: rows times works. Here the external refs are looked up in a few
/// batched queries, and the title/year fallback index of each kind is built
/// from one pass over the catalogue, only when a row of that kind needs it.
/// When several local works share a fallback identity, the first in
/// `list_by_kind` order wins (`list_identities` returns that order), as in the row-by-row walk.
pub async fn resolve_local_works(
    work_repo: &Arc<dyn WorkRepo>,
    rows: &[AvailabilityRow],
) -> Result<Vec<Option<Uuid>>, playarr_db::DbError> {
    let mut refs: Vec<ExternalRef> = Vec::new();
    let mut seen = HashSet::new();
    for row in rows {
        let key = ExternalRef {
            provider: row.provider.clone(),
            external_id: row.external_id.clone(),
        };
        if seen.insert(key.clone()) {
            refs.push(key);
        }
    }
    let exact = work_repo.find_by_external_refs(&refs).await?;

    let mut fallback: HashMap<WorkKind, HashMap<String, Uuid>> = HashMap::new();
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let key = ExternalRef {
            provider: row.provider.clone(),
            external_id: row.external_id.clone(),
        };
        if let Some(work) = exact.get(&key) {
            out.push(Some(work.id));
            continue;
        }
        let index = match fallback.entry(row.kind) {
            std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(fallback_index(work_repo, row.kind).await?)
            }
        };
        let target = fallback_identity(row.kind, &row.title, row.release_date);
        out.push(index.get(&target).copied());
    }
    Ok(out)
}

/// Syncs `peer_leaf_availability` from `base_url`'s `GET /api/v1/peer/
/// availability`, resuming from this `peer_node_id`'s persisted cursor
/// (`entity = "availability"`). Returns the number of rows applied.
pub async fn sync_availability(
    peer_client: &PeerClient,
    base_url: &str,
    peer_node_id: Uuid,
    work_repo: &Arc<dyn WorkRepo>,
    availability_repo: &Arc<dyn PeerLeafAvailabilityRepo>,
    sync_state_repo: &Arc<dyn playarr_db::PeerSyncStateRepo>,
) -> Result<usize, AvailabilitySyncError> {
    const ENTITY: &str = "availability";
    let cursor = sync_state_repo
        .get(peer_node_id, ENTITY)
        .await?
        .and_then(|state| state.cursor);
    let path = match &cursor {
        Some(cursor) => format!("/api/v1/peer/availability?since={cursor}"),
        None => "/api/v1/peer/availability".to_string(),
    };
    let response: AvailabilityResponse = peer_client.signed_get(base_url, &path).await?;

    apply_availability_response(
        response,
        peer_node_id,
        work_repo,
        availability_repo,
        sync_state_repo,
    )
    .await
}

/// Applies an availability snapshot delivered by either pull or push transport.
pub async fn apply_availability_response(
    response: AvailabilityResponse,
    peer_node_id: Uuid,
    work_repo: &Arc<dyn WorkRepo>,
    availability_repo: &Arc<dyn PeerLeafAvailabilityRepo>,
    sync_state_repo: &Arc<dyn playarr_db::PeerSyncStateRepo>,
) -> Result<usize, AvailabilitySyncError> {
    apply_availability_snapshot(
        response,
        None,
        peer_node_id,
        work_repo,
        availability_repo,
        sync_state_repo,
    )
    .await
}

/// The [`wire_digest`] of the snapshot this node holds for `peer_node_id`, if
/// the peer declared one with the snapshot it last sent.
pub async fn held_wire_digest(
    sync_state_repo: &Arc<dyn playarr_db::PeerSyncStateRepo>,
    peer_node_id: Uuid,
) -> Result<Option<String>, playarr_db::DbError> {
    Ok(sync_state_repo
        .get(peer_node_id, WIRE_DIGEST_ENTITY)
        .await?
        .and_then(|state| state.cursor))
}

/// [`apply_availability_response`] that also remembers the [`wire_digest`] the
/// sender declared for the snapshot (`None`: it declared none, as a pull does,
/// so nothing is held and the sender must send rows next time).
pub async fn apply_availability_snapshot(
    response: AvailabilityResponse,
    declared_digest: Option<String>,
    peer_node_id: Uuid,
    work_repo: &Arc<dyn WorkRepo>,
    availability_repo: &Arc<dyn PeerLeafAvailabilityRepo>,
    sync_state_repo: &Arc<dyn playarr_db::PeerSyncStateRepo>,
) -> Result<usize, AvailabilitySyncError> {
    const ENTITY: &str = "availability";
    let started = std::time::Instant::now();
    let matches = resolve_local_works(work_repo, &response.rows).await?;
    let resolved: Vec<_> = response.rows.iter().zip(matches).collect();
    // The endpoint deliberately returns a complete live inventory even when
    // a cursor is supplied, so replace the cache to remove deleted/moved files.
    let mut applied = 0usize;
    let mut snapshot = Vec::with_capacity(resolved.len());
    for (row, local_work_id) in resolved {
        snapshot.push(PeerLeafAvailability {
            peer_node_id,
            media_file_id: row.media_file_id,
            source_instance_id: row.source_instance_id,
            path: row.path.clone(),
            provider: row.provider.clone(),
            external_id: row.external_id.clone(),
            leaf_selector: row.leaf_selector.clone(),
            group_library_id: row.group_library_id,
            availability: row.availability,
            container: row.container.clone(),
            codec: row.codec.clone(),
            bitrate: row.bitrate,
            size_bytes: row.size_bytes,
            duration_ms: row.duration_ms,
            local_work_id,
            title: row.title.clone(),
            kind: row.kind,
            release_date: row.release_date,
            updated_at: row.updated_at,
        });
        applied += 1;
    }
    let resolved_in = started.elapsed();
    availability_repo
        .replace_for_peer(peer_node_id, &snapshot)
        .await?;
    tracing::debug!(
        %peer_node_id,
        rows = applied,
        resolve_ms = resolved_in.as_millis() as u64,
        replace_ms = (started.elapsed() - resolved_in).as_millis() as u64,
        "availability snapshot applied"
    );

    if held_wire_digest(sync_state_repo, peer_node_id).await? != declared_digest {
        sync_state_repo
            .upsert(&playarr_db::PeerSyncState {
                peer_node_id,
                entity: WIRE_DIGEST_ENTITY.to_string(),
                cursor: declared_digest,
                last_synced_at: Some(Utc::now()),
            })
            .await?;
    }
    sync_state_repo
        .upsert(&playarr_db::PeerSyncState {
            peer_node_id,
            entity: ENTITY.to_string(),
            cursor: Some(response.server_time),
            last_synced_at: Some(Utc::now()),
        })
        .await?;

    Ok(applied)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use async_trait::async_trait;
    use base64::Engine;
    use playarr_model::{ExternalRef, Work};
    use serde_json::json;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::signing::PeerIdentity;

    // ---- fallback_identity ----

    #[test]
    fn fallback_identity_normalizes_case_and_whitespace() {
        let a = fallback_identity(WorkKind::Movie, "  The Sample Movie  ", None);
        let b = fallback_identity(WorkKind::Movie, "the sample movie", None);
        assert_eq!(a, b);
    }

    #[test]
    fn fallback_identity_uses_only_the_release_year() {
        let with_full_date = fallback_identity(
            WorkKind::Movie,
            "Voyage",
            Some("2016-11-11T00:00:00Z".parse().unwrap()),
        );
        let with_year_only_semantics = fallback_identity(
            WorkKind::Movie,
            "Voyage",
            Some("2016-01-01T00:00:00Z".parse().unwrap()),
        );
        assert_eq!(with_full_date, with_year_only_semantics);
    }

    #[test]
    fn fallback_identity_distinguishes_kind_title_and_year() {
        let base = fallback_identity(WorkKind::Movie, "Same Title", None);
        assert_ne!(
            base,
            fallback_identity(WorkKind::Series, "Same Title", None)
        );
        assert_ne!(
            base,
            fallback_identity(WorkKind::Movie, "Different Title", None)
        );
        assert_ne!(
            base,
            fallback_identity(
                WorkKind::Movie,
                "Same Title",
                Some("2020-01-01T00:00:00Z".parse().unwrap())
            )
        );
    }

    // ---- resolve_local_work ----

    #[derive(Default)]
    struct InMemoryWorkRepo {
        works: Mutex<HashMap<Uuid, Work>>,
    }

    impl InMemoryWorkRepo {
        fn seeded(works: Vec<Work>) -> Self {
            Self {
                works: Mutex::new(works.into_iter().map(|w| (w.id, w)).collect()),
            }
        }
    }

    #[async_trait]
    impl WorkRepo for InMemoryWorkRepo {
        async fn get(&self, id: Uuid) -> Result<Work, playarr_db::DbError> {
            self.works
                .lock()
                .unwrap()
                .get(&id)
                .cloned()
                .ok_or(playarr_db::DbError::NotFound)
        }

        async fn list_by_kind(
            &self,
            kind: WorkKind,
            limit: i64,
            offset: i64,
        ) -> Result<Vec<Work>, playarr_db::DbError> {
            let mut matching: Vec<Work> = self
                .works
                .lock()
                .unwrap()
                .values()
                .filter(|w| w.kind == kind)
                .cloned()
                .collect();
            matching.sort_by_key(|a| a.id);
            let start = offset.max(0) as usize;
            let end = (start + limit.max(0) as usize).min(matching.len());
            Ok(matching
                .get(start..end)
                .map(|s| s.to_vec())
                .unwrap_or_default())
        }

        async fn upsert(&self, work: &Work) -> Result<(), playarr_db::DbError> {
            self.works.lock().unwrap().insert(work.id, work.clone());
            Ok(())
        }

        async fn delete(&self, id: Uuid) -> Result<(), playarr_db::DbError> {
            self.works.lock().unwrap().remove(&id);
            Ok(())
        }

        async fn find_by_external_ref(
            &self,
            provider: &ExternalProvider,
            external_id: &str,
        ) -> Result<Option<Work>, playarr_db::DbError> {
            Ok(self
                .works
                .lock()
                .unwrap()
                .values()
                .find(|w| {
                    w.external_refs
                        .iter()
                        .any(|r| &r.provider == provider && r.external_id == external_id)
                })
                .cloned())
        }
    }

    fn work(id: Uuid, kind: WorkKind, refs: Vec<ExternalRef>, title: &str) -> Work {
        Work {
            id,
            kind,
            external_refs: refs,
            title: title.to_string(),
            sort_title: title.to_lowercase(),
            overview: None,
            images: vec![],
            genres: vec![],
            tags: vec![],
            added_at: Utc::now(),
            release_date: None,
            end_date: None,
            monitored: true,
            availability: Availability::Available,
        }
    }

    fn availability_row(
        provider: ExternalProvider,
        external_id: &str,
        kind: WorkKind,
        title: &str,
    ) -> AvailabilityRow {
        AvailabilityRow {
            media_file_id: Uuid::new_v4(),
            source_instance_id: Uuid::new_v4(),
            path: "/media/sample.mkv".to_string(),
            provider,
            external_id: external_id.to_string(),
            leaf_selector: LeafSelector::Movie,
            group_library_id: None,
            availability: Availability::Available,
            container: Some("mkv".to_string()),
            codec: Some("h264".to_string()),
            bitrate: Some(8_000_000),
            size_bytes: Some(1_000_000_000),
            duration_ms: Some(7_200_000),
            updated_at: Utc::now(),
            title: title.to_string(),
            kind,
            release_date: None,
        }
    }

    #[tokio::test]
    async fn resolve_local_work_matches_the_exact_external_ref_first() {
        let work_id = Uuid::new_v4();
        let repo: Arc<dyn WorkRepo> = Arc::new(InMemoryWorkRepo::seeded(vec![work(
            work_id,
            WorkKind::Movie,
            vec![ExternalRef {
                provider: ExternalProvider::Tmdb,
                external_id: "603".to_string(),
            }],
            "The Sample Movie",
        )]));

        let row = availability_row(
            ExternalProvider::Tmdb,
            "603",
            WorkKind::Movie,
            "Some Other Title",
        );
        let resolved = resolve_local_work(&repo, &row).await.unwrap();
        assert_eq!(resolved, Some(work_id));
    }

    #[tokio::test]
    async fn resolve_local_work_falls_back_to_title_and_year_when_the_external_ref_is_unknown() {
        let work_id = Uuid::new_v4();
        let mut local = work(
            work_id,
            WorkKind::Movie,
            vec![ExternalRef {
                provider: ExternalProvider::Imdb,
                external_id: "tt0133093".to_string(),
            }],
            "The Sample Movie",
        );
        local.release_date = Some("1999-03-31T00:00:00Z".parse().unwrap());
        let repo: Arc<dyn WorkRepo> = Arc::new(InMemoryWorkRepo::seeded(vec![local]));

        // The peer reports a `Tmdb` ref this node has never seen for this
        // title (it only knows the same movie via `Imdb`) -- the exact-ref
        // match must miss, and the title/year fallback must still resolve
        // it.
        let mut row = availability_row(
            ExternalProvider::Tmdb,
            "603",
            WorkKind::Movie,
            "the sample movie",
        );
        row.release_date = Some("1999-01-01T00:00:00Z".parse().unwrap());
        let resolved = resolve_local_work(&repo, &row).await.unwrap();
        assert_eq!(resolved, Some(work_id));
    }

    /// Counts the catalogue pages a resolution reads.
    struct CountingWorkRepo {
        inner: InMemoryWorkRepo,
        list_calls: std::sync::atomic::AtomicUsize,
    }

    #[async_trait]
    impl WorkRepo for CountingWorkRepo {
        async fn get(&self, id: Uuid) -> Result<Work, playarr_db::DbError> {
            self.inner.get(id).await
        }

        async fn list_by_kind(
            &self,
            kind: WorkKind,
            limit: i64,
            offset: i64,
        ) -> Result<Vec<Work>, playarr_db::DbError> {
            self.list_calls
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            self.inner.list_by_kind(kind, limit, offset).await
        }

        async fn upsert(&self, work: &Work) -> Result<(), playarr_db::DbError> {
            self.inner.upsert(work).await
        }

        async fn delete(&self, id: Uuid) -> Result<(), playarr_db::DbError> {
            self.inner.delete(id).await
        }

        async fn find_by_external_ref(
            &self,
            provider: &ExternalProvider,
            external_id: &str,
        ) -> Result<Option<Work>, playarr_db::DbError> {
            self.inner.find_by_external_ref(provider, external_id).await
        }
    }

    #[tokio::test]
    async fn resolve_local_works_matches_row_by_row_resolution_with_one_catalogue_pass() {
        // 450 local movies (three pages), half of them known to the peer by an
        // external ref, the rest only by title; plus rows with no local record.
        let mut locals = Vec::new();
        let mut rows = Vec::new();
        for i in 0..450 {
            let id = Uuid::new_v4();
            locals.push(work(
                id,
                WorkKind::Movie,
                vec![ExternalRef {
                    provider: ExternalProvider::Imdb,
                    external_id: format!("tt{i}"),
                }],
                &format!("Sample Movie {i}"),
            ));
            if i % 2 == 0 {
                rows.push(availability_row(
                    ExternalProvider::Imdb,
                    &format!("tt{i}"),
                    WorkKind::Movie,
                    "Unrelated",
                ));
            } else {
                rows.push(availability_row(
                    ExternalProvider::Tmdb,
                    &format!("{i}"),
                    WorkKind::Movie,
                    &format!("  sample MOVIE {i} "),
                ));
            }
        }
        for i in 0..30 {
            rows.push(availability_row(
                ExternalProvider::Tmdb,
                &format!("none{i}"),
                WorkKind::Movie,
                &format!("Not Held {i}"),
            ));
        }
        let repo = Arc::new(CountingWorkRepo {
            inner: InMemoryWorkRepo::seeded(locals),
            list_calls: Default::default(),
        });
        let dyn_repo: Arc<dyn WorkRepo> = repo.clone();

        let batched = resolve_local_works(&dyn_repo, &rows).await.unwrap();
        let pages_for_batch = repo
            .list_calls
            .swap(0, std::sync::atomic::Ordering::Relaxed);
        let mut one_by_one = Vec::new();
        for row in &rows {
            one_by_one.push(resolve_local_work(&dyn_repo, row).await.unwrap());
        }

        assert_eq!(batched, one_by_one);
        assert_eq!(batched.iter().filter(|m| m.is_some()).count(), 450);
        // One walk of the catalogue (450 works = 3 pages), not one per unmatched row.
        assert_eq!(pages_for_batch, 3);
    }

    #[tokio::test]
    async fn resolve_local_works_skips_the_catalogue_walk_when_every_ref_is_known() {
        let id = Uuid::new_v4();
        let repo = Arc::new(CountingWorkRepo {
            inner: InMemoryWorkRepo::seeded(vec![work(
                id,
                WorkKind::Movie,
                vec![ExternalRef {
                    provider: ExternalProvider::Tmdb,
                    external_id: "603".to_string(),
                }],
                "The Sample Movie",
            )]),
            list_calls: Default::default(),
        });
        let dyn_repo: Arc<dyn WorkRepo> = repo.clone();
        let rows = vec![availability_row(
            ExternalProvider::Tmdb,
            "603",
            WorkKind::Movie,
            "Whatever",
        )];
        assert_eq!(
            resolve_local_works(&dyn_repo, &rows).await.unwrap(),
            vec![Some(id)]
        );
        assert_eq!(
            repo.list_calls.load(std::sync::atomic::Ordering::Relaxed),
            0
        );
    }

    /// Timing evidence (run with `--ignored --nocapture`): a snapshot of
    /// `BENCH_ROWS` rows, none known by external ref, resolved against a
    /// SQL catalogue of `BENCH_WORKS` movies, row by row versus batched.
    #[tokio::test]
    #[ignore]
    async fn bench_resolve_local_works() {
        let env = |name: &str, default: usize| {
            std::env::var(name)
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(default)
        };
        let (works, rows_n) = (env("BENCH_WORKS", 2_000), env("BENCH_ROWS", 300));
        sqlx::any::install_default_drivers();
        let pool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        playarr_db::run_migrations(&pool).await.unwrap();
        let repo: Arc<dyn WorkRepo> = Arc::new(playarr_db::repo::SqlxWorkRepo::new(pool));
        for i in 0..works {
            repo.upsert(&work(
                Uuid::new_v4(),
                WorkKind::Movie,
                vec![ExternalRef {
                    provider: ExternalProvider::Imdb,
                    external_id: format!("tt{i}"),
                }],
                &format!("Sample Movie {i}"),
            ))
            .await
            .unwrap();
        }
        let rows: Vec<_> = (0..rows_n)
            .map(|i| {
                availability_row(
                    ExternalProvider::Tmdb,
                    &format!("{i}"),
                    WorkKind::Movie,
                    &format!("Peer Only {i}"),
                )
            })
            .collect();
        let t = std::time::Instant::now();
        let mut one_by_one = Vec::new();
        for row in &rows {
            one_by_one.push(resolve_local_work(&repo, row).await.unwrap());
        }
        let per_row = t.elapsed();
        let t = std::time::Instant::now();
        let batched = resolve_local_works(&repo, &rows).await.unwrap();
        println!(
            "{rows_n} unmatched rows over {works} works: row by row {per_row:?}, batched {:?}",
            t.elapsed()
        );
        assert_eq!(one_by_one, batched);
    }

    // ---- wire_digest / apply_availability_snapshot (row 9952) ----

    #[test]
    fn wire_digest_ignores_order_and_updated_at_but_not_content() {
        let rows: Vec<_> = (0..5)
            .map(|i| {
                availability_row(
                    ExternalProvider::Tmdb,
                    &format!("{i}"),
                    WorkKind::Movie,
                    "T",
                )
            })
            .collect();
        let digest = wire_digest(&rows);
        assert!(digest.starts_with("5-"), "{digest}");

        let mut reordered = rows.clone();
        reordered.reverse();
        assert_eq!(wire_digest(&reordered), digest);

        let mut later = rows.clone();
        for row in &mut later {
            row.updated_at += chrono::Duration::seconds(60);
        }
        assert_eq!(
            wire_digest(&later),
            digest,
            "updated_at moves every derivation"
        );

        let mut moved = rows.clone();
        moved[2].size_bytes = Some(1);
        assert_ne!(wire_digest(&moved), digest);
        let mut renamed = rows.clone();
        renamed[4].title = "Other".to_string();
        assert_ne!(wire_digest(&renamed), digest);
        assert_ne!(wire_digest(&rows[..4]), digest);
        assert_ne!(
            wire_digest(&[rows[0].clone(), rows[0].clone()]),
            wire_digest(&[rows[0].clone()]),
            "a repeated row does not cancel out"
        );
    }

    #[tokio::test]
    async fn applying_a_snapshot_remembers_the_declared_digest_and_a_pull_forgets_it() {
        sqlx::any::install_default_drivers();
        let pool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        playarr_db::run_migrations(&pool).await.unwrap();
        let work_repo: Arc<dyn WorkRepo> =
            Arc::new(playarr_db::repo::SqlxWorkRepo::new(pool.clone()));
        let availability: Arc<dyn PeerLeafAvailabilityRepo> = Arc::new(
            playarr_db::repo::SqlxPeerLeafAvailabilityRepo::new(pool.clone()),
        );
        let state: Arc<dyn playarr_db::PeerSyncStateRepo> =
            Arc::new(playarr_db::repo::SqlxPeerSyncStateRepo::new(pool));
        let peer = Uuid::new_v4();
        let rows = vec![availability_row(
            ExternalProvider::Tmdb,
            "1",
            WorkKind::Movie,
            "Sample",
        )];
        let response = || AvailabilityResponse {
            rows: rows.clone(),
            server_time: "cursor".to_string(),
        };
        assert_eq!(held_wire_digest(&state, peer).await.unwrap(), None);
        apply_availability_snapshot(
            response(),
            Some(wire_digest(&rows)),
            peer,
            &work_repo,
            &availability,
            &state,
        )
        .await
        .unwrap();
        assert_eq!(
            held_wire_digest(&state, peer).await.unwrap(),
            Some(wire_digest(&rows))
        );
        // A pull declares none, so nothing is held afterwards.
        apply_availability_response(response(), peer, &work_repo, &availability, &state)
            .await
            .unwrap();
        assert_eq!(held_wire_digest(&state, peer).await.unwrap(), None);
    }

    /// Timing evidence (run with `--release --ignored --nocapture`): what one
    /// received availability snapshot of `BENCH_ROWS` rows costs on a file
    /// database with the production pragmas, phase by phase: parsing the
    /// request body, then applying it for the first time, unchanged, and with
    /// a few rows changed.
    #[tokio::test]
    #[ignore]
    async fn bench_apply_availability_response() {
        let env = |name: &str, default: usize| {
            std::env::var(name)
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(default)
        };
        let rows_n = env("BENCH_ROWS", 50_000);
        let path = std::env::temp_dir().join(format!("playarr-bench-{}.db", Uuid::new_v4()));
        let pool = playarr_db::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        playarr_db::run_migrations(&pool).await.unwrap();
        let work_repo: Arc<dyn WorkRepo> =
            Arc::new(playarr_db::repo::SqlxWorkRepo::new(pool.clone()));
        for i in 0..2_000 {
            work_repo
                .upsert(&work(
                    Uuid::new_v4(),
                    WorkKind::Movie,
                    vec![ExternalRef {
                        provider: ExternalProvider::Tmdb,
                        external_id: format!("{i}"),
                    }],
                    &format!("Sample Movie {i}"),
                ))
                .await
                .unwrap();
        }
        let availability: Arc<dyn PeerLeafAvailabilityRepo> = Arc::new(
            playarr_db::repo::SqlxPeerLeafAvailabilityRepo::new(pool.clone()),
        );
        let state: Arc<dyn playarr_db::PeerSyncStateRepo> =
            Arc::new(playarr_db::repo::SqlxPeerSyncStateRepo::new(pool.clone()));
        let mut rows: Vec<AvailabilityRow> = (0..rows_n)
            .map(|i| {
                let mut row = availability_row(
                    ExternalProvider::Tmdb,
                    &format!("{}", i / 10),
                    WorkKind::Movie,
                    &format!("Sample Movie {}", i / 10),
                );
                row.path = format!("/srv/media/series/Sample Series {}/Season 01/Sample Series {} - S01E{:02} - Episode Title.mkv", i / 10, i / 10, i % 10);
                row
            })
            .collect();
        let response = AvailabilityResponse {
            rows: rows.clone(),
            server_time: "cursor".to_string(),
        };
        let body = serde_json::to_vec(&response).unwrap();
        let t = std::time::Instant::now();
        let parsed: AvailabilityResponse = serde_json::from_slice(&body).unwrap();
        println!(
            "{rows_n} rows: body {} KiB, parse {:?}",
            body.len() / 1024,
            t.elapsed()
        );
        let t = std::time::Instant::now();
        let digest = wire_digest(&parsed.rows);
        println!(
            "wire_digest of {rows_n} rows (sender, once per derivation): {:?}",
            t.elapsed()
        );
        let peer = Uuid::new_v4();
        let t = std::time::Instant::now();
        apply_availability_response(parsed.clone(), peer, &work_repo, &availability, &state)
            .await
            .unwrap();
        println!("first apply: {:?}", t.elapsed());
        for round in 0..3 {
            let t = std::time::Instant::now();
            apply_availability_response(parsed.clone(), peer, &work_repo, &availability, &state)
                .await
                .unwrap();
            println!("unchanged apply {round}: {:?}", t.elapsed());
        }
        for row in rows.iter_mut().step_by(1_000) {
            row.size_bytes = Some(7);
        }
        let t = std::time::Instant::now();
        apply_availability_response(
            AvailabilityResponse {
                rows,
                server_time: "cursor".to_string(),
            },
            peer,
            &work_repo,
            &availability,
            &state,
        )
        .await
        .unwrap();
        println!(
            "apply with {} changed rows: {:?}",
            rows_n / 1_000,
            t.elapsed()
        );
        // A push that leaves the rows out only reads the held digest.
        let t = std::time::Instant::now();
        let held = held_wire_digest(&state, peer).await.unwrap();
        println!(
            "unchanged push, rows left out: {:?} (a pull declares no digest: held {held:?}; sent {digest})",
            t.elapsed()
        );
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn resolve_local_work_returns_none_for_a_title_with_zero_local_record() {
        let repo: Arc<dyn WorkRepo> = Arc::new(InMemoryWorkRepo::default());
        let row = availability_row(
            ExternalProvider::Tmdb,
            "999999",
            WorkKind::Movie,
            "Unknown Title",
        );
        assert_eq!(resolve_local_work(&repo, &row).await.unwrap(), None);
    }

    #[tokio::test]
    async fn resolve_local_work_fallback_never_crosses_work_kinds() {
        let series_id = Uuid::new_v4();
        let repo: Arc<dyn WorkRepo> = Arc::new(InMemoryWorkRepo::seeded(vec![work(
            series_id,
            WorkKind::Series,
            vec![],
            "Ambiguous Title",
        )]));

        let row = availability_row(
            ExternalProvider::Tmdb,
            "1",
            WorkKind::Movie,
            "Ambiguous Title",
        );
        assert_eq!(resolve_local_work(&repo, &row).await.unwrap(), None);
    }

    // ---- sync_availability (end to end against a real DB + mock peer) ----

    fn client() -> PeerClient {
        let seed_b64 = base64::engine::general_purpose::STANDARD.encode([13u8; 32]);
        let identity = PeerIdentity::from_seed_b64(Uuid::new_v4(), &seed_b64).unwrap();
        PeerClient::new(reqwest::Client::new(), identity)
    }

    async fn availability_repo() -> Arc<dyn PeerLeafAvailabilityRepo> {
        sqlx::any::install_default_drivers();
        let pool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        playarr_db::run_migrations(&pool).await.unwrap();
        Arc::new(playarr_db::repo::SqlxPeerLeafAvailabilityRepo::new(pool))
    }

    #[tokio::test]
    async fn sync_availability_resolves_and_persists_local_work_id() {
        let mock = MockServer::start().await;
        let peer_node_id = Uuid::new_v4();
        let work_id = Uuid::new_v4();
        let work_repo: Arc<dyn WorkRepo> = Arc::new(InMemoryWorkRepo::seeded(vec![work(
            work_id,
            WorkKind::Movie,
            vec![ExternalRef {
                provider: ExternalProvider::Tmdb,
                external_id: "603".to_string(),
            }],
            "The Sample Movie",
        )]));
        let availability_repo = availability_repo().await;
        let sync_state_repo: Arc<dyn playarr_db::PeerSyncStateRepo> = {
            sqlx::any::install_default_drivers();
            let pool = sqlx::any::AnyPoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            playarr_db::run_migrations(&pool).await.unwrap();
            Arc::new(playarr_db::repo::SqlxPeerSyncStateRepo::new(pool))
        };

        Mock::given(method("GET"))
            .and(path("/api/v1/peer/availability"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "rows": [{
                    "media_file_id": Uuid::new_v4(), "source_instance_id": Uuid::new_v4(),
                    "path": "/media/movies/The Sample Movie.mkv",
                    "provider": "tmdb", "external_id": "603", "leaf_selector": "movie",
                    "group_library_id": null, "availability": "available",
                    "container": "mkv", "codec": "h264", "bitrate": 8000000,
                    "size_bytes": 1000000000_u64, "duration_ms": 7200000,
                    "updated_at": Utc::now(), "title": "The Sample Movie", "kind": "movie",
                    "release_date": null,
                }],
                "server_time": "cursor-1",
            })))
            .mount(&mock)
            .await;

        let applied = sync_availability(
            &client(),
            &mock.uri(),
            peer_node_id,
            &work_repo,
            &availability_repo,
            &sync_state_repo,
        )
        .await
        .expect("sync succeeds");
        assert_eq!(applied, 1);

        let rows = availability_repo.list_for_peer(peer_node_id).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].local_work_id, Some(work_id));

        let cursor = sync_state_repo
            .get(peer_node_id, "availability")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(cursor.cursor.as_deref(), Some("cursor-1"));
    }

    #[tokio::test]
    async fn sync_availability_stores_none_for_an_unmatched_title() {
        let mock = MockServer::start().await;
        let peer_node_id = Uuid::new_v4();
        let work_repo: Arc<dyn WorkRepo> = Arc::new(InMemoryWorkRepo::default());
        let availability_repo = availability_repo().await;
        let sync_state_repo: Arc<dyn playarr_db::PeerSyncStateRepo> = {
            sqlx::any::install_default_drivers();
            let pool = sqlx::any::AnyPoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            playarr_db::run_migrations(&pool).await.unwrap();
            Arc::new(playarr_db::repo::SqlxPeerSyncStateRepo::new(pool))
        };

        Mock::given(method("GET"))
            .and(path("/api/v1/peer/availability"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "rows": [{
                    "media_file_id": Uuid::new_v4(), "source_instance_id": Uuid::new_v4(),
                    "path": "/media/movies/Nobody Has This.mkv",
                    "provider": "tmdb", "external_id": "999", "leaf_selector": "movie",
                    "group_library_id": null, "availability": "available",
                    "container": null, "codec": null, "bitrate": null,
                    "size_bytes": null, "duration_ms": null,
                    "updated_at": Utc::now(), "title": "Nobody Has This", "kind": "movie",
                    "release_date": null,
                }],
                "server_time": "cursor-1",
            })))
            .mount(&mock)
            .await;

        sync_availability(
            &client(),
            &mock.uri(),
            peer_node_id,
            &work_repo,
            &availability_repo,
            &sync_state_repo,
        )
        .await
        .unwrap();

        let rows = availability_repo.list_for_peer(peer_node_id).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].local_work_id, None);
    }
}
