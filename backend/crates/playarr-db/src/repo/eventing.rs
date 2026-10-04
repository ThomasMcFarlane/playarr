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
    DownloadStatus, DownloadTicket, ExternalProvider, MediaFile, Playlist, PlaylistItem,
    WatchProgress, WatchState, Work, WorkKind,
};
use uuid::Uuid;

use super::live_event::{kind, LiveEventPublisher, NewLiveEvent};
use super::{
    DownloadTicketRepo, MediaFileRepo, PlaylistRepo, WatchProgressRepo, WatchlistRepo, WorkRepo,
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
    async fn list_by_work_id(&self, work_id: Uuid) -> Result<Vec<MediaFile>, DbError> {
        self.inner.list_by_work_id(work_id).await
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
    async fn upsert_by_source(&self, media_file: &MediaFile) -> Result<MediaFile, DbError> {
        let persisted = self.inner.upsert_by_source(media_file).await?;
        // The pre-existing row keeps its original id on an update, so an
        // unchanged id means the sync just inserted a brand new file. Updates
        // run on every poll and are deliberately silent.
        if persisted.id == media_file.id {
            self.emit_files(&persisted).await;
        }
        Ok(persisted)
    }
}
