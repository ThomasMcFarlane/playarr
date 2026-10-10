//! Repository decorators that publish a [`NewLiveEvent`] after every
//! successful write, so *every* writer (HTTP handlers, the arr sync worker,
//! peer sync, portability import, other devices) feeds the live event stream
//! without each call site remembering to. Reads delegate untouched; a failed
//! write publishes nothing.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use playarr_model::discovery::WatchlistItem;
use playarr_model::media::LeafRef;
use playarr_model::{
    DownloadStatus, DownloadTicket, ExternalProvider, MediaFile, PeerNode, PeerNodeStatus,
    Playlist, PlaylistItem, WatchProgress, WatchState, Work, WorkKind,
};
use uuid::Uuid;

use super::live_event::{kind, LiveEventPublisher, NewLiveEvent};
use super::{
    DownloadTicketRepo, MediaFileRepo, PeerNodeRepo, PlaylistRepo, WatchProgressRepo,
    WatchlistRepo, WorkRepo,
};
use crate::error::DbError;

/// Minimum gap between two progress events for the same file and watched
/// state, so a playing device (a progress report every few seconds) does not
/// flood the others.
const PROGRESS_MIN_GAP: Duration = Duration::from_secs(8);

pub struct EventingWatchProgressRepo {
    inner: Arc<dyn WatchProgressRepo>,
    events: LiveEventPublisher,
}

impl EventingWatchProgressRepo {
    pub fn new(inner: Arc<dyn WatchProgressRepo>, events: LiveEventPublisher) -> Self {
        Self { inner, events }
    }
}

#[async_trait]
impl WatchProgressRepo for EventingWatchProgressRepo {
    async fn get(
        &self,
        user_id: Uuid,
        media_file_id: Uuid,
    ) -> Result<Option<WatchProgress>, DbError> {
        self.inner.get(user_id, media_file_id).await
    }

    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<WatchProgress>, DbError> {
        self.inner.list_for_user(user_id).await
    }

    async fn upsert(&self, user_id: Uuid, progress: &WatchProgress) -> Result<(), DbError> {
        self.inner.upsert(user_id, progress).await?;
        let watched = progress.state == WatchState::Watched;
        if self.events.should_publish_progress(
            user_id,
            progress.media_file_id,
            watched,
            PROGRESS_MIN_GAP,
        ) {
            // `id` is the work so clients can refresh a title, its seasons
            // and Home rails.
            let ev = NewLiveEvent::for_user(
                user_id,
                kind::WATCH,
                "work",
                progress.work_id,
                &[match progress.state {
                    WatchState::Watched => "watched",
                    WatchState::PartWatched => "progress",
                    WatchState::Unseen => "unwatched",
                }],
            );
            self.events.publish(ev).await;
        }
        Ok(())
    }
}

pub struct EventingPlaylistRepo {
    inner: Arc<dyn PlaylistRepo>,
    events: LiveEventPublisher,
}

impl EventingPlaylistRepo {
    pub fn new(inner: Arc<dyn PlaylistRepo>, events: LiveEventPublisher) -> Self {
        Self { inner, events }
    }

    async fn emit(&self, owner: Option<Uuid>, id: Uuid, changed: &'static str) {
        let ev = NewLiveEvent {
            user_id: owner,
            kind: kind::PLAYLIST,
            entity: "playlist",
            entity_id: Some(id.to_string()),
            changed: vec![changed],
            source_instance_id: None,
        };
        self.events.publish(ev).await;
    }

    async fn owner_of(&self, id: Uuid) -> Option<Option<Uuid>> {
        self.inner.get(id).await.ok().map(|p| p.owner_user_id)
    }
}

#[async_trait]
impl PlaylistRepo for EventingPlaylistRepo {
    async fn get(&self, id: Uuid) -> Result<Playlist, DbError> {
        self.inner.get(id).await
    }
    async fn list_visible_to_user(&self, user_id: Uuid) -> Result<Vec<Playlist>, DbError> {
        self.inner.list_visible_to_user(user_id).await
    }
    async fn list_system(&self) -> Result<Vec<Playlist>, DbError> {
        self.inner.list_system().await
    }
    async fn list_all(&self) -> Result<Vec<Playlist>, DbError> {
        self.inner.list_all().await
    }
    async fn upsert(&self, playlist: &Playlist) -> Result<(), DbError> {
        self.inner.upsert(playlist).await?;
        self.emit(playlist.owner_user_id, playlist.id, "meta").await;
        Ok(())
    }
    async fn delete(&self, id: Uuid) -> Result<(), DbError> {
        let owner = self.owner_of(id).await;
        self.inner.delete(id).await?;
        if let Some(owner) = owner {
            self.emit(owner, id, "deleted").await;
        }
        Ok(())
    }
    async fn list_items(&self, playlist_id: Uuid) -> Result<Vec<PlaylistItem>, DbError> {
        self.inner.list_items(playlist_id).await
    }
    async fn add_item(
        &self,
        playlist_id: Uuid,
        work_id: Uuid,
        track_id: Option<Uuid>,
    ) -> Result<PlaylistItem, DbError> {
        let item = self.inner.add_item(playlist_id, work_id, track_id).await?;
        if let Some(owner) = self.owner_of(playlist_id).await {
            self.emit(owner, playlist_id, "items").await;
        }
        Ok(item)
    }
    async fn remove_item(&self, playlist_id: Uuid, item_id: Uuid) -> Result<(), DbError> {
        self.inner.remove_item(playlist_id, item_id).await?;
        if let Some(owner) = self.owner_of(playlist_id).await {
            self.emit(owner, playlist_id, "items").await;
        }
        Ok(())
    }
    async fn reorder_items(
        &self,
        playlist_id: Uuid,
        item_ids_in_order: &[Uuid],
    ) -> Result<(), DbError> {
        self.inner
            .reorder_items(playlist_id, item_ids_in_order)
            .await?;
        if let Some(owner) = self.owner_of(playlist_id).await {
            self.emit(owner, playlist_id, "items").await;
        }
        Ok(())
    }
}

pub struct EventingWatchlistRepo {
    inner: Arc<dyn WatchlistRepo>,
    events: LiveEventPublisher,
}

impl EventingWatchlistRepo {
    pub fn new(inner: Arc<dyn WatchlistRepo>, events: LiveEventPublisher) -> Self {
        Self { inner, events }
    }
}

#[async_trait]
impl WatchlistRepo for EventingWatchlistRepo {
    async fn list(&self, user_id: Uuid) -> Result<Vec<WatchlistItem>, DbError> {
        self.inner.list(user_id).await
    }
    async fn get(&self, user_id: Uuid, title_key: &str) -> Result<Option<WatchlistItem>, DbError> {
        self.inner.get(user_id, title_key).await
    }
    async fn add(&self, user_id: Uuid, item: &WatchlistItem) -> Result<(), DbError> {
        self.inner.add(user_id, item).await?;
        let ev = NewLiveEvent::for_user(
            user_id,
            kind::WATCHLIST,
            "watchlist",
            &item.title_key,
            &["added"],
        );
        self.events.publish(ev).await;
        Ok(())
    }
    async fn remove(&self, user_id: Uuid, title_key: &str) -> Result<bool, DbError> {
        let removed = self.inner.remove(user_id, title_key).await?;
        if removed {
            let ev = NewLiveEvent::for_user(
                user_id,
                kind::WATCHLIST,
                "watchlist",
                title_key,
                &["removed"],
            );
            self.events.publish(ev).await;
        }
        Ok(removed)
    }
}

pub struct EventingDownloadTicketRepo {
    inner: Arc<dyn DownloadTicketRepo>,
    events: LiveEventPublisher,
}

impl EventingDownloadTicketRepo {
    pub fn new(inner: Arc<dyn DownloadTicketRepo>, events: LiveEventPublisher) -> Self {
        Self { inner, events }
    }

    async fn emit_for(&self, id: Uuid, changed: &'static str) {
        if let Ok(Some(t)) = self.inner.get(id).await {
            self.events
                .publish(NewLiveEvent::for_user(
                    t.user_id,
                    kind::DOWNLOAD,
                    "download",
                    id,
                    &[changed],
                ))
                .await;
        }
    }
}

#[async_trait]
impl DownloadTicketRepo for EventingDownloadTicketRepo {
    async fn get(&self, id: Uuid) -> Result<Option<DownloadTicket>, DbError> {
        self.inner.get(id).await
    }
    async fn list_for_user(&self, user_id: Uuid) -> Result<Vec<DownloadTicket>, DbError> {
        self.inner.list_for_user(user_id).await
    }
    async fn find_active(
        &self,
        user_id: Uuid,
        media_file_id: Uuid,
        quality_id: &str,
    ) -> Result<Option<DownloadTicket>, DbError> {
        self.inner
            .find_active(user_id, media_file_id, quality_id)
            .await
    }
    async fn insert(&self, ticket: &DownloadTicket) -> Result<(), DbError> {
        self.inner.insert(ticket).await?;
        self.events
            .publish(NewLiveEvent::for_user(
                ticket.user_id,
                kind::DOWNLOAD,
                "download",
                ticket.id,
                &["created"],
            ))
            .await;
        Ok(())
    }
    async fn mark_status(
        &self,
        id: Uuid,
        status: DownloadStatus,
        error_message: Option<&str>,
    ) -> Result<(), DbError> {
        self.inner.mark_status(id, status, error_message).await?;
        self.emit_for(id, "status").await;
        Ok(())
    }
    async fn mark_ready(
        &self,
        id: Uuid,
        output_path: Option<&std::path::Path>,
        size_bytes: Option<u64>,
        ready_at: DateTime<Utc>,
        expires_at: Option<DateTime<Utc>>,
    ) -> Result<(), DbError> {
        self.inner
            .mark_ready(id, output_path, size_bytes, ready_at, expires_at)
            .await?;
        self.emit_for(id, "status").await;
        Ok(())
    }
    async fn delete(&self, id: Uuid) -> Result<(), DbError> {
        let owner = self.inner.get(id).await.ok().flatten().map(|t| t.user_id);
        self.inner.delete(id).await?;
        if let Some(owner) = owner {
            self.events
                .publish(NewLiveEvent::for_user(
                    owner,
                    kind::DOWNLOAD,
                    "download",
                    id,
                    &["deleted"],
                ))
                .await;
        }
        Ok(())
    }
    async fn list_expired(&self, now: DateTime<Utc>) -> Result<Vec<DownloadTicket>, DbError> {
        self.inner.list_expired(now).await
    }
}

/// Publishes library and calendar events for catalogue writes. A new
/// `media_files` row (an import) is the moment a title or episode becomes
/// playable, so that is what clients refresh on; works are published on
/// upsert and delete so metadata edits and removals show up too.
pub struct EventingWorkRepo {
    inner: Arc<dyn WorkRepo>,
    events: LiveEventPublisher,
}

impl EventingWorkRepo {
    pub fn new(inner: Arc<dyn WorkRepo>, events: LiveEventPublisher) -> Self {
        Self { inner, events }
    }
}

#[async_trait]
impl WorkRepo for EventingWorkRepo {
    async fn get(&self, id: Uuid) -> Result<Work, DbError> {
        self.inner.get(id).await
    }
    async fn list_by_kind(
        &self,
        kind: WorkKind,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Work>, DbError> {
        self.inner.list_by_kind(kind, limit, offset).await
    }
    async fn upsert(&self, work: &Work) -> Result<(), DbError> {
        self.inner.upsert(work).await?;
        self.events
            .publish(NewLiveEvent::for_library(
                kind::LIBRARY,
                "work",
                work.id,
                &["upserted"],
                None,
            ))
            .await;
        Ok(())
    }
    async fn delete(&self, id: Uuid) -> Result<(), DbError> {
        self.inner.delete(id).await?;
        self.events
            .publish(NewLiveEvent::for_library(
                kind::LIBRARY,
                "work",
                id,
                &["removed"],
                None,
            ))
            .await;
        Ok(())
    }
    async fn find_by_external_ref(
        &self,
        provider: &ExternalProvider,
        external_id: &str,
    ) -> Result<Option<Work>, DbError> {
        self.inner.find_by_external_ref(provider, external_id).await
    }
    // Reads the inner repo answers better than the trait defaults do; without
    // these the production wrapper would fall back to one query per ref and a
    // paged walk of full works.
    async fn find_by_external_refs(
        &self,
        refs: &[playarr_model::ExternalRef],
    ) -> Result<std::collections::HashMap<playarr_model::ExternalRef, Work>, DbError> {
        self.inner.find_by_external_refs(refs).await
    }
    async fn list_identities(&self, kind: WorkKind) -> Result<Vec<super::WorkIdentity>, DbError> {
        self.inner.list_identities(kind).await
    }
    async fn get_many(
        &self,
        ids: &[Uuid],
    ) -> Result<std::collections::HashMap<Uuid, Work>, DbError> {
        self.inner.get_many(ids).await
    }
}

/// Publishes a "calendar may have changed" event for the whole library
/// whenever a request or the request integration setup changes, so caches of
/// per-title request actions (the calendar's) drop their copies. Clients
/// refetch the area, as they do for any `calendar` change.
async fn emit_request_change(events: &LiveEventPublisher, id: impl ToString) {
    events
        .publish(NewLiveEvent::for_library(
            kind::CALENDAR,
            "*",
            id,
            &["request"],
            None,
        ))
        .await;
}

pub struct EventingMediaRequestRepo {
    inner: Arc<dyn super::MediaRequestRepo>,
    events: LiveEventPublisher,
}

impl EventingMediaRequestRepo {
    pub fn new(inner: Arc<dyn super::MediaRequestRepo>, events: LiveEventPublisher) -> Self {
        Self { inner, events }
    }
}

#[async_trait]
impl super::MediaRequestRepo for EventingMediaRequestRepo {
    async fn list(&self) -> Result<Vec<playarr_model::requests::MediaRequest>, DbError> {
        self.inner.list().await
    }
    async fn list_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<playarr_model::requests::MediaRequest>, DbError> {
        self.inner.list_for_user(user_id).await
    }
    async fn get(
        &self,
        id: Uuid,
    ) -> Result<Option<playarr_model::requests::MediaRequest>, DbError> {
        self.inner.get(id).await
    }
    async fn find_by_title_key(
        &self,
        title_key: &str,
    ) -> Result<Option<playarr_model::requests::MediaRequest>, DbError> {
        self.inner.find_by_title_key(title_key).await
    }
    async fn list_for_kind(
        &self,
        kind: playarr_model::discovery::DiscoveryKind,
    ) -> Result<Vec<playarr_model::requests::MediaRequest>, DbError> {
        self.inner.list_for_kind(kind).await
    }
    async fn find_match(
        &self,
        kind: playarr_model::discovery::DiscoveryKind,
        tmdb_id: Option<i64>,
        tvdb_id: Option<i64>,
        imdb_id: Option<&str>,
    ) -> Result<Option<playarr_model::requests::MediaRequest>, DbError> {
        self.inner.find_match(kind, tmdb_id, tvdb_id, imdb_id).await
    }
    async fn find_by_external(
        &self,
        kind: playarr_model::requests::IntegrationKind,
        external_id: &str,
    ) -> Result<Option<playarr_model::requests::MediaRequest>, DbError> {
        self.inner.find_by_external(kind, external_id).await
    }
    async fn upsert(&self, request: &playarr_model::requests::MediaRequest) -> Result<(), DbError> {
        self.inner.upsert(request).await?;
        emit_request_change(&self.events, request.id).await;
        Ok(())
    }
    async fn delete(&self, id: Uuid) -> Result<bool, DbError> {
        let removed = self.inner.delete(id).await?;
        if removed {
            emit_request_change(&self.events, id).await;
        }
        Ok(removed)
    }
}

pub struct EventingRequestIntegrationRepo {
    inner: Arc<dyn super::RequestIntegrationRepo>,
    events: LiveEventPublisher,
}

impl EventingRequestIntegrationRepo {
    pub fn new(inner: Arc<dyn super::RequestIntegrationRepo>, events: LiveEventPublisher) -> Self {
        Self { inner, events }
    }
}

#[async_trait]
impl super::RequestIntegrationRepo for EventingRequestIntegrationRepo {
    async fn list(&self) -> Result<Vec<playarr_model::requests::RequestIntegration>, DbError> {
        self.inner.list().await
    }
    async fn get(
        &self,
        id: Uuid,
    ) -> Result<Option<playarr_model::requests::RequestIntegration>, DbError> {
        self.inner.get(id).await
    }
    async fn upsert(
        &self,
        integration: &playarr_model::requests::RequestIntegration,
    ) -> Result<(), DbError> {
        self.inner.upsert(integration).await?;
        emit_request_change(&self.events, integration.id).await;
        Ok(())
    }
    async fn delete(&self, id: Uuid) -> Result<bool, DbError> {
        let removed = self.inner.delete(id).await?;
        if removed {
            emit_request_change(&self.events, id).await;
        }
        Ok(removed)
    }
    async fn record_sync(
        &self,
        id: Uuid,
        at: DateTime<Utc>,
        error: Option<&str>,
    ) -> Result<(), DbError> {
        self.inner.record_sync(id, at, error).await
    }
    async fn get_setting(&self, key: &str) -> Result<Option<String>, DbError> {
        self.inner.get_setting(key).await
    }
    async fn set_setting(&self, key: &str, value: &str) -> Result<(), DbError> {
        self.inner.set_setting(key, value).await?;
        emit_request_change(&self.events, key).await;
        Ok(())
    }
}

pub struct EventingMediaFileRepo {
    inner: Arc<dyn MediaFileRepo>,
    events: LiveEventPublisher,
}

impl EventingMediaFileRepo {
    pub fn new(inner: Arc<dyn MediaFileRepo>, events: LiveEventPublisher) -> Self {
        Self { inner, events }
    }

    async fn emit_files(&self, f: &MediaFile) {
        let src = Some(f.source_instance_id);
        self.events
            .publish_all([
                NewLiveEvent::for_library(kind::LIBRARY, "work", f.work_id, &["files"], src),
                NewLiveEvent::for_library(kind::CALENDAR, "work", f.work_id, &["imported"], src),
            ])
            .await;
    }
}

#[async_trait]
impl MediaFileRepo for EventingMediaFileRepo {
    async fn create(&self, media_file: &MediaFile) -> Result<(), DbError> {
        self.inner.create(media_file).await?;
        self.emit_files(media_file).await;
        Ok(())
    }
    async fn get_by_id(&self, id: Uuid) -> Result<MediaFile, DbError> {
        self.inner.get_by_id(id).await
    }
    async fn get_playable(&self, id: Uuid) -> Result<MediaFile, DbError> {
        self.inner.get_playable(id).await
    }
    async fn list_by_work_id(&self, work_id: Uuid) -> Result<Vec<MediaFile>, DbError> {
        self.inner.list_by_work_id(work_id).await
    }
    async fn list_by_work_ids(&self, work_ids: &[Uuid]) -> Result<Vec<MediaFile>, DbError> {
        self.inner.list_by_work_ids(work_ids).await
    }
    async fn list_all(&self) -> Result<Vec<MediaFile>, DbError> {
        self.inner.list_all().await
    }
    async fn list_work_ids(&self) -> Result<HashSet<Uuid>, DbError> {
        self.inner.list_work_ids().await
    }
    async fn list_work_source_instances(&self) -> Result<Vec<(Uuid, Uuid)>, DbError> {
        self.inner.list_work_source_instances().await
    }
    async fn count_by_work(&self) -> Result<std::collections::HashMap<Uuid, u32>, DbError> {
        self.inner.count_by_work().await
    }
    async fn find_by_leaf(
        &self,
        work_id: Uuid,
        leaf_ref: LeafRef,
    ) -> Result<Option<MediaFile>, DbError> {
        self.inner.find_by_leaf(work_id, leaf_ref).await
    }
    async fn set_duration_ms(&self, id: Uuid, duration_ms: u64) -> Result<(), DbError> {
        self.inner.set_duration_ms(id, duration_ms).await
    }
    async fn mark_missing_durations_scanned(&self, work_id: Uuid) -> Result<(), DbError> {
        self.inner.mark_missing_durations_scanned(work_id).await
    }
    async fn prune_superseded_files(
        &self,
        work_id: Uuid,
        source_instance_id: Uuid,
        keep_source_file_ids: &[String],
    ) -> Result<crate::repo::PruneOutcome, DbError> {
        let outcome = self
            .inner
            .prune_superseded_files(work_id, source_instance_id, keep_source_file_ids)
            .await?;
        if outcome.deleted + outcome.marked_missing + outcome.restored > 0 {
            // A library event also makes the cached home rails stale, which are
            // keyed to the catalogue snapshot that library events advance.
            let mut events = vec![NewLiveEvent::for_library(
                kind::LIBRARY,
                "work",
                work_id,
                &["files"],
                Some(source_instance_id),
            )];
            for user in &outcome.moved_users {
                events.push(NewLiveEvent::for_user(
                    *user,
                    kind::WATCH,
                    "work",
                    work_id,
                    &["progress"],
                ));
            }
            self.events.publish_all(events).await;
        }
        Ok(outcome)
    }
    async fn find_by_source(
        &self,
        source_instance_id: Uuid,
        source_file_id: &str,
    ) -> Result<Option<MediaFile>, DbError> {
        self.inner
            .find_by_source(source_instance_id, source_file_id)
            .await
    }
    async fn upsert_by_source(&self, media_file: &MediaFile) -> Result<MediaFile, DbError> {
        // What the source's file id pointed at before: an update that moves the
        // file to another work or leaf changes what is playable, so it is not
        // silent.
        let before = match media_file.source_file_id.as_deref() {
            Some(source_file_id) => {
                self.inner
                    .find_by_source(media_file.source_instance_id, source_file_id)
                    .await?
            }
            None => None,
        };
        let persisted = self.inner.upsert_by_source(media_file).await?;
        // The pre-existing row keeps its original id on an update, so an
        // unchanged id means the sync just inserted a brand new file. Other
        // updates run on every poll and are silent unless the file moved.
        if persisted.id == media_file.id {
            self.emit_files(&persisted).await;
        } else if before
            .as_ref()
            .is_some_and(|b| b.work_id != persisted.work_id || b.leaf_ref != persisted.leaf_ref)
        {
            if let Some(old) = &before {
                self.emit_files(old).await;
            }
            self.emit_files(&persisted).await;
        }
        Ok(persisted)
    }
}

/// Publishes one account-wide `account` / `server_group` event when a peer
/// write changes what signed-in users see in their server group list
/// (`GET /api/v1/peer-groups/self/members`): a member joined or left, became
/// active or inactive, or changed its name or client-reachable addresses.
/// Heartbeat writes (`last_seen_at`, sync errors) stay silent.
pub struct EventingPeerNodeRepo {
    inner: Arc<dyn PeerNodeRepo>,
    events: LiveEventPublisher,
}

impl EventingPeerNodeRepo {
    pub fn new(inner: Arc<dyn PeerNodeRepo>, events: LiveEventPublisher) -> Self {
        Self { inner, events }
    }
}

/// What the end-user group list is built from.
fn visible_membership(node: &PeerNode) -> (bool, &str, Vec<(i32, &str)>) {
    let mut urls: Vec<(i32, &str)> = node
        .addresses
        .iter()
        .filter(|address| address.client_reachable)
        .map(|address| (address.priority, address.url.as_str()))
        .collect();
    urls.sort();
    (
        node.status == PeerNodeStatus::Active,
        node.name.as_str(),
        urls,
    )
}

#[async_trait]
impl PeerNodeRepo for EventingPeerNodeRepo {
    async fn upsert(&self, node: &PeerNode) -> Result<(), DbError> {
        let before = self.inner.get(node.id).await?;
        self.inner.upsert(node).await?;
        let changed = before.as_ref().map(visible_membership) != Some(visible_membership(node));
        if changed {
            self.events
                .publish(NewLiveEvent {
                    user_id: None,
                    kind: kind::ACCOUNT,
                    entity: "server_group",
                    entity_id: Some("self".to_string()),
                    changed: vec!["members"],
                    source_instance_id: None,
                })
                .await;
        }
        Ok(())
    }
    async fn get(&self, id: Uuid) -> Result<Option<PeerNode>, DbError> {
        self.inner.get(id).await
    }
    async fn list_all(&self) -> Result<Vec<PeerNode>, DbError> {
        self.inner.list_all().await
    }
    async fn list_others(&self) -> Result<Vec<PeerNode>, DbError> {
        self.inner.list_others().await
    }
}

#[cfg(test)]
mod peer_node_event_tests {
    use playarr_model::PeerAddress;

    use super::*;
    use crate::codec::format_datetime;
    use crate::pool::test_sqlite_pool;
    use crate::repo::SqlxPeerNodeRepo;

    #[tokio::test]
    async fn publishes_only_when_the_visible_membership_changes() {
        let pool = test_sqlite_pool().await;
        let group_id = Uuid::new_v4();
        sqlx::query("INSERT INTO peer_groups (id, name, created_at) VALUES (?, ?, ?)")
            .bind(group_id.to_string())
            .bind("test group")
            .bind(format_datetime(Utc::now()))
            .execute(&pool)
            .await
            .unwrap();
        let events = LiveEventPublisher::from_pool(pool.clone());
        let repo = EventingPeerNodeRepo::new(
            Arc::new(SqlxPeerNodeRepo::new(pool.clone())),
            events.clone(),
        );
        let group_events = || async {
            events
                .repo()
                .list_after(0, 100)
                .await
                .unwrap()
                .into_iter()
                .filter(|e| e.kind == kind::ACCOUNT && e.entity == "server_group")
                .count()
        };
        let now = Utc::now();
        let mut node = PeerNode {
            id: Uuid::new_v4(),
            group_id,
            name: "east".to_string(),
            addresses: vec![PeerAddress {
                url: "https://east.example.com".to_string(),
                priority: 0,
                label: "wan".to_string(),
                client_reachable: true,
            }],
            public_key: "key".to_string(),
            is_self: false,
            status: PeerNodeStatus::Active,
            last_seen_at: None,
            last_sync_error: None,
            joined_at: now,
            updated_at: now,
        };

        repo.upsert(&node).await.unwrap();
        assert_eq!(group_events().await, 1, "a new member is announced");

        node.last_seen_at = Some(Utc::now());
        node.last_sync_error = Some("timeout".to_string());
        node.addresses.push(PeerAddress {
            url: "https://east-lan.example.com".to_string(),
            priority: 1,
            label: "lan".to_string(),
            client_reachable: false,
        });
        repo.upsert(&node).await.unwrap();
        assert_eq!(
            group_events().await,
            1,
            "heartbeats and internal addresses stay silent"
        );

        node.addresses[0].url = "https://east2.example.com".to_string();
        repo.upsert(&node).await.unwrap();
        assert_eq!(
            group_events().await,
            2,
            "a client address change is announced"
        );

        node.status = PeerNodeStatus::Left;
        repo.upsert(&node).await.unwrap();
        assert_eq!(group_events().await, 3, "a member leaving is announced");
    }
}

#[cfg(test)]
mod work_repo_forwarding_tests {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use playarr_model::{ExternalRef, WorkKind};

    use super::*;
    use crate::pool::test_sqlite_pool;
    use crate::repo::WorkIdentity;

    /// Answers only the batched reads and fails the per-item defaults, to show
    /// the eventing wrapper hands them on instead of falling back.
    #[derive(Default)]
    struct BatchedOnly {
        batched_ref_calls: AtomicUsize,
        identity_calls: AtomicUsize,
    }

    #[async_trait]
    impl WorkRepo for BatchedOnly {
        async fn get(&self, _id: Uuid) -> Result<Work, DbError> {
            Err(DbError::NotFound)
        }
        async fn list_by_kind(&self, _: WorkKind, _: i64, _: i64) -> Result<Vec<Work>, DbError> {
            panic!("the wrapper must use list_identities")
        }
        async fn upsert(&self, _work: &Work) -> Result<(), DbError> {
            Ok(())
        }
        async fn delete(&self, _id: Uuid) -> Result<(), DbError> {
            Ok(())
        }
        async fn find_by_external_ref(
            &self,
            _: &ExternalProvider,
            _: &str,
        ) -> Result<Option<Work>, DbError> {
            panic!("the wrapper must use find_by_external_refs")
        }
        async fn find_by_external_refs(
            &self,
            _refs: &[ExternalRef],
        ) -> Result<HashMap<ExternalRef, Work>, DbError> {
            self.batched_ref_calls.fetch_add(1, Ordering::SeqCst);
            Ok(HashMap::new())
        }
        async fn list_identities(&self, _kind: WorkKind) -> Result<Vec<WorkIdentity>, DbError> {
            self.identity_calls.fetch_add(1, Ordering::SeqCst);
            Ok(Vec::new())
        }
    }

    #[tokio::test]
    async fn eventing_work_repo_forwards_the_batched_reads() {
        let inner = Arc::new(BatchedOnly::default());
        let repo = EventingWorkRepo::new(
            inner.clone(),
            LiveEventPublisher::from_pool(test_sqlite_pool().await),
        );
        let refs = [ExternalRef {
            provider: ExternalProvider::Tmdb,
            external_id: "1".to_string(),
        }];
        assert!(repo.find_by_external_refs(&refs).await.unwrap().is_empty());
        assert!(repo
            .list_identities(WorkKind::Movie)
            .await
            .unwrap()
            .is_empty());
        assert_eq!(inner.batched_ref_calls.load(Ordering::SeqCst), 1);
        assert_eq!(inner.identity_calls.load(Ordering::SeqCst), 1);
    }
}

#[cfg(test)]
mod media_file_move_tests {
    use super::*;
    use crate::pool::test_sqlite_pool;
    use crate::repo::SqlxMediaFileRepo;
    use crate::{live_change_tick, live_changes_since};
    use playarr_model::media::LeafRef;

    async fn insert_work(pool: &crate::DbPool, id: Uuid) {
        sqlx::query(
            "INSERT INTO works (id, kind, title, sort_title, added_at, monitored, availability) \
             VALUES (?, 'movie', 'Moved', 'moved', '2026-01-01T00:00:00Z', 1, 'available')",
        )
        .bind(id.to_string())
        .execute(pool)
        .await
        .unwrap();
    }

    fn file(work_id: Uuid, source: Uuid, path: &str) -> MediaFile {
        MediaFile {
            id: Uuid::new_v4(),
            work_id,
            leaf_ref: LeafRef::Work,
            path: std::path::PathBuf::from(path),
            container: "mkv".into(),
            codec: "h264".into(),
            bitrate: None,
            duration_ms: None,
            size_bytes: 1,
            source_instance_id: source,
            source_file_id: Some("src-1".into()),
        }
    }

    fn library_events_for(since: u64, work: Uuid) -> usize {
        live_changes_since(since)
            .unwrap_or_default()
            .iter()
            .filter(|c| {
                c.kind == kind::LIBRARY && c.entity_id.as_deref() == Some(work.to_string().as_str())
            })
            .count()
    }

    /// A sync update that points an existing source file at another work changes
    /// what is playable, so it publishes a library event; one that changes only
    /// the path stays silent, as every poll does.
    #[tokio::test]
    async fn upsert_by_source_publishes_when_the_file_moves_to_another_work() {
        let pool = test_sqlite_pool().await;
        let (a, b, source) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        insert_work(&pool, a).await;
        insert_work(&pool, b).await;
        let repo = EventingMediaFileRepo::new(
            Arc::new(SqlxMediaFileRepo::new(pool.clone())),
            LiveEventPublisher::from_pool(pool.clone()),
        );
        repo.upsert_by_source(&file(a, source, "/m/a.mkv"))
            .await
            .unwrap();

        let tick = live_change_tick();
        repo.upsert_by_source(&file(a, source, "/m/a2.mkv"))
            .await
            .unwrap();
        assert_eq!(
            library_events_for(tick, a),
            0,
            "an unchanged placement is silent"
        );

        let tick = live_change_tick();
        repo.upsert_by_source(&file(b, source, "/m/a2.mkv"))
            .await
            .unwrap();
        assert!(
            library_events_for(tick, b) >= 1,
            "the new work is announced"
        );
        assert!(
            library_events_for(tick, a) >= 1,
            "the old work is announced"
        );
    }
}
