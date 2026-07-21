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

use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use streamarr_db::{PeerLeafAvailabilityRepo, WorkRepo};
use streamarr_model::{
    Availability, ExternalProvider, LeafSelector, PeerLeafAvailability, WorkKind,
};
use uuid::Uuid;

use crate::peer_client::{PeerClient, PeerClientError};

#[derive(Debug, thiserror::Error)]
pub enum AvailabilitySyncError {
    #[error(transparent)]
    PeerClient(#[from] PeerClientError),
    #[error(transparent)]
    Db(#[from] streamarr_db::DbError),
}

/// One `peer_leaf_availability` row on the wire. `title`/`kind`/
/// `release_date` are the reporting peer's own values: [`resolve_local_work`]
/// reads them for its title/year fallback when the exact external ref isn't
/// already known locally, and `sync_availability` below persists them onto
/// `PeerLeafAvailability` verbatim (regardless of whether a local match was
/// found) so the partial-cache-node `RemoteOnlyWork` case
/// (`streamarr-catalog`'s browse/search hydration, §4.3) has something to
/// display when `local_work_id` ends up `None` -- there is no local `Work`
/// row to read a title/kind from in that case.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailabilityRow {
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
) -> Result<Option<Uuid>, streamarr_db::DbError> {
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

/// Syncs `peer_leaf_availability` from `base_url`'s `GET /api/v1/peer/
/// availability`, resuming from this `peer_node_id`'s persisted cursor
/// (`entity = "availability"`). Returns the number of rows applied.
pub async fn sync_availability(
    peer_client: &PeerClient,
    base_url: &str,
    peer_node_id: Uuid,
    work_repo: &Arc<dyn WorkRepo>,
    availability_repo: &Arc<dyn PeerLeafAvailabilityRepo>,
    sync_state_repo: &Arc<dyn streamarr_db::PeerSyncStateRepo>,
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
    sync_state_repo: &Arc<dyn streamarr_db::PeerSyncStateRepo>,
) -> Result<usize, AvailabilitySyncError> {
    const ENTITY: &str = "availability";
    let mut applied = 0usize;
    for row in &response.rows {
        let local_work_id = resolve_local_work(work_repo, row).await?;
        availability_repo
            .upsert(&PeerLeafAvailability {
                peer_node_id,
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
            })
            .await?;
        applied += 1;
    }

    sync_state_repo
        .upsert(&streamarr_db::PeerSyncState {
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
    use serde_json::json;
    use streamarr_model::{ExternalRef, Work};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::signing::PeerIdentity;

    // ---- fallback_identity ----

    #[test]
    fn fallback_identity_normalizes_case_and_whitespace() {
        let a = fallback_identity(WorkKind::Movie, "  Sample Movie Kilo  ", None);
        let b = fallback_identity(WorkKind::Movie, "sample movie kilo", None);
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
        async fn get(&self, id: Uuid) -> Result<Work, streamarr_db::DbError> {
            self.works
                .lock()
                .unwrap()
                .get(&id)
                .cloned()
                .ok_or(streamarr_db::DbError::NotFound)
        }

        async fn list_by_kind(
            &self,
            kind: WorkKind,
            limit: i64,
            offset: i64,
        ) -> Result<Vec<Work>, streamarr_db::DbError> {
            let mut matching: Vec<Work> = self
                .works
                .lock()
                .unwrap()
                .values()
                .filter(|w| w.kind == kind)
                .cloned()
                .collect();
            matching.sort_by(|a, b| a.id.cmp(&b.id));
            let start = offset.max(0) as usize;
            let end = (start + limit.max(0) as usize).min(matching.len());
            Ok(matching
                .get(start..end)
                .map(|s| s.to_vec())
                .unwrap_or_default())
        }

        async fn upsert(&self, work: &Work) -> Result<(), streamarr_db::DbError> {
            self.works.lock().unwrap().insert(work.id, work.clone());
            Ok(())
        }

        async fn delete(&self, id: Uuid) -> Result<(), streamarr_db::DbError> {
            self.works.lock().unwrap().remove(&id);
            Ok(())
        }

        async fn find_by_external_ref(
            &self,
            provider: &ExternalProvider,
            external_id: &str,
        ) -> Result<Option<Work>, streamarr_db::DbError> {
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
            "Sample Movie Kilo",
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
            "Sample Movie Kilo",
        );
        local.release_date = Some("1999-03-31T00:00:00Z".parse().unwrap());
        let repo: Arc<dyn WorkRepo> = Arc::new(InMemoryWorkRepo::seeded(vec![local]));

        // The peer reports a `Tmdb` ref this node has never seen for this
        // title (it only knows the same movie via `Imdb`) -- the exact-ref
        // match must miss, and the title/year fallback must still resolve
        // it.
        let mut row =
            availability_row(ExternalProvider::Tmdb, "603", WorkKind::Movie, "sample movie kilo");
        row.release_date = Some("1999-01-01T00:00:00Z".parse().unwrap());
        let resolved = resolve_local_work(&repo, &row).await.unwrap();
        assert_eq!(resolved, Some(work_id));
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
        streamarr_db::run_migrations(&pool, false).await.unwrap();
        Arc::new(streamarr_db::repo::SqlxPeerLeafAvailabilityRepo::new(pool))
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
            "Sample Movie Kilo",
        )]));
        let availability_repo = availability_repo().await;
        let sync_state_repo: Arc<dyn streamarr_db::PeerSyncStateRepo> = {
            sqlx::any::install_default_drivers();
            let pool = sqlx::any::AnyPoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            streamarr_db::run_migrations(&pool, false).await.unwrap();
            Arc::new(streamarr_db::repo::SqlxPeerSyncStateRepo::new(pool))
        };

        Mock::given(method("GET"))
            .and(path("/api/v1/peer/availability"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "rows": [{
                    "provider": "tmdb", "external_id": "603", "leaf_selector": "movie",
                    "group_library_id": null, "availability": "available",
                    "container": "mkv", "codec": "h264", "bitrate": 8000000,
                    "size_bytes": 1000000000_u64, "duration_ms": 7200000,
                    "updated_at": Utc::now(), "title": "Sample Movie Kilo", "kind": "movie",
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
        let sync_state_repo: Arc<dyn streamarr_db::PeerSyncStateRepo> = {
            sqlx::any::install_default_drivers();
            let pool = sqlx::any::AnyPoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            streamarr_db::run_migrations(&pool, false).await.unwrap();
            Arc::new(streamarr_db::repo::SqlxPeerSyncStateRepo::new(pool))
        };

        Mock::given(method("GET"))
            .and(path("/api/v1/peer/availability"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "rows": [{
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
