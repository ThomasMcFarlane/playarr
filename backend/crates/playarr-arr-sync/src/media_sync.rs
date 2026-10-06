//! File-level sync: once a [`playarr_model::Work`]'s catalog identity is
//! reconciled (see [`crate::poller`]), [`MediaSync::sync_work`] fetches that
//! work's *file* data from the same source instance (Sonarr episode files,
//! Radarr's embedded movie file, Lidarr track files, Readarr book files,
//! Whisparr scene/episode files) and upserts real
//! [`playarr_model::MediaFile`] rows via
//! [`playarr_db::MediaFileRepo::upsert_by_source`].
//!
//! ## Resolving a leaf id
//!
//! A `MediaFile` for a series/artist/author doesn't point at the `Work`
//! itself (see [`playarr_model::media::LeafRef`]) — it points at a specific
//! episode/track/book. The *arr apps hand us their own numeric id for that
//! child (Sonarr's `episode.id`, Lidarr's `trackfile.albumId`, Readarr's
//! `bookfile.bookId`), not our internal `Uuid`, so it has to be resolved the
//! same way [`crate::poller`] resolves a *work's* numeric/external id to a
//! `Work::id`: find an existing row keyed by identity, or create one and
//! remember the fresh `Uuid` if none exists yet (compare
//! [`playarr_db::WorkRepo::find_by_external_ref`] +
//! [`crate::poller::new_work`]'s insert-if-missing shape).
//!
//! The wrinkle: unlike `Work` (which has a real `work_external_refs` table
//! keyed by metadata-provider id), the `seasons`/`episodes`/`albums`/
//! `tracks`/`books` tables have no source-app id column at all — like
//! `playarr-catalog`'s read path, they have no `playarr-db` repository
//! yet (see this crate's `Cargo.toml` comment), so there's nowhere to store
//! one. This module resolves against each table's real natural key instead:
//!
//! - Season: `(series_work_id, season_number)` — a real `UNIQUE` index.
//! - Episode: `(season_id, episode_number)` — a real `UNIQUE` index; Sonarr's
//!   trimmed episode DTO conveniently carries both numbers directly.
//! - Album: `(artist_work_id, title)` — no `UNIQUE` index exists, so this is
//!   a best-effort natural key, not a guaranteed-unique one.
//! - Track: `(album_id, disc_number, track_number)` — Lidarr's `/track`
//!   resource supplies the real ordering, title, duration, and `trackFileId`;
//!   the last field joins each catalogue track to its imported file.
//! - Book: `(author_work_id, title)` — same best-effort shape as Album;
//!   Readarr's `bookId` on the file *does* let us resolve the correct
//!   `ReadarrBook` (so `title` itself is trustworthy), just not via a real
//!   unique index on our own `books` table.
//!
//! Every `find_or_create_*` here therefore does a plain `SELECT` first and
//! only `INSERT`s on a miss, rather than an `ON CONFLICT` upsert (no unique
//! index to target for album/track/book). This is safe without extra
//! locking because [`crate::poller::ReconciliationPoller`] already holds
//! `ClusterCoordinator::try_lock` for this source instance for the whole
//! reconciliation pass — there is never a concurrent writer racing this
//! code for the same source instance.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use playarr_arr_client::{
    ArrClientError, LidarrAlbum, LidarrClient, LidarrTrack, RadarrClient, RadarrCredit,
    ReadarrBook, ReadarrClient, SonarrClient, SonarrEpisodeFile, WhisparrClient,
    WhisparrEpisodeFile,
};
use playarr_db::{CreditRepo, DbPool, MediaFileRepo, MediaLanguageRepo};
use playarr_model::media::LeafRef;
use playarr_model::{Credit, CreditRole, ImageAsset, MediaFile, Person};
use uuid::Uuid;

use crate::arr_client::{lidarr_album_images, sonarr_images, whisparr_images, ArrClient};

#[derive(Debug, thiserror::Error)]
pub enum MediaSyncError {
    #[error("arr client error: {0}")]
    Client(#[from] ArrClientError),
    #[error(transparent)]
    Db(#[from] playarr_db::DbError),
    #[error(transparent)]
    Sql(#[from] sqlx::Error),
}

/// Extracts a lowercased file extension as the `MediaFile::container` value
/// (e.g. `"/tv/Show/S01E01.mkv"` -> `"mkv"`). Falls back to `"unknown"` for a
/// path with no extension rather than failing the whole sync over one
/// oddly-named file.
fn container_from_path(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_else(|| "unknown".to_string())
}

fn lidarr_track_number(track: &LidarrTrack) -> i64 {
    (track.absolute_track_number > 0)
        .then_some(track.absolute_track_number)
        .or_else(|| {
            track
                .track_number
                .as_deref()
                .unwrap_or_default()
                .split(|character: char| !character.is_ascii_digit())
                .find(|part| !part.is_empty())
                .and_then(|part| part.parse::<i64>().ok())
        })
        .unwrap_or(track.id)
}

fn lidarr_album_type(album: &LidarrAlbum) -> &'static str {
    let labels = album
        .secondary_types
        .iter()
        .map(String::as_str)
        .chain(album.album_type.as_deref())
        .map(|label| label.trim().to_ascii_lowercase())
        .collect::<Vec<_>>();
    if labels.iter().any(|label| label.contains("live")) {
        "live"
    } else if labels.iter().any(|label| label.contains("compilation")) {
        "compilation"
    } else if labels
        .iter()
        .any(|label| label == "ep" || label.contains("extended play"))
    {
        "ep"
    } else if labels.iter().any(|label| label.contains("single")) {
        "single"
    } else if labels.iter().any(|label| label.contains("soundtrack")) {
        "soundtrack"
    } else {
        "studio"
    }
}

fn lidarr_release_date(raw: Option<&str>) -> Option<String> {
    let raw = raw?.trim();
    if raw.len() < 10 {
        return None;
    }
    chrono::NaiveDate::parse_from_str(&raw[..10], "%Y-%m-%d")
        .ok()
        .map(|date| date.format("%Y-%m-%d").to_string())
}

/// Parses the `HH:MM:SS[.fraction]` value Sonarr/Radarr expose from their
/// own media analysis. Invalid or non-positive values stay unknown so a
/// later one-file ffprobe can fill them without poisoning the cache.
fn runtime_string_to_ms(raw: &str) -> Option<u64> {
    let parts: Vec<&str> = raw.trim().split(':').collect();
    let (hours, minutes, seconds) = match parts.as_slice() {
        [minutes, seconds] => (
            0,
            minutes.parse::<u64>().ok()?,
            seconds.parse::<f64>().ok()?,
        ),
        [hours, minutes, seconds] => (
            hours.parse::<u64>().ok()?,
            minutes.parse::<u64>().ok()?,
            seconds.parse::<f64>().ok()?,
        ),
        _ => return None,
    };
    if minutes >= 60 || !seconds.is_finite() || !(0.0..60.0).contains(&seconds) {
        return None;
    }
    let total_ms =
        ((hours * 3_600 + minutes * 60) as f64 * 1_000.0 + seconds * 1_000.0).round() as u64;
    (total_ms > 0).then_some(total_ms)
}

fn minutes_to_ms(minutes: Option<u32>) -> Option<u64> {
    minutes
        .filter(|minutes| *minutes > 0)
        .map(|minutes| u64::from(minutes) * 60_000)
}

pub struct MediaSync {
    pool: DbPool,
    media_file_repo: std::sync::Arc<dyn MediaFileRepo>,
    /// `None` by default (same builder-opt-in shape as `ReconciliationPoller`'s
    /// `status_reporter` -- existing callers/tests that don't care about
    /// credits don't need to thread an extra constructor argument through).
    /// Only ever consulted from `sync_radarr` -- see that method's doc
    /// comment for why credits are Radarr-only.
    credit_repo: Option<std::sync::Arc<dyn CreditRepo>>,
    /// Audio/subtitle language index (task 180). `None` by default, same
    /// opt-in builder shape as `credit_repo`.
    language_repo: Option<std::sync::Arc<dyn MediaLanguageRepo>>,
    /// Live-event publisher (task 278). `None` by default, same opt-in builder
    /// shape as `credit_repo`. Season and episode rows are written with raw SQL
    /// (no event-decorated repository wraps them), so this announces the
    /// metadata edits those writes make.
    live_events: Option<playarr_db::LiveEventPublisher>,
}

impl MediaSync {
    pub fn new(pool: DbPool, media_file_repo: std::sync::Arc<dyn MediaFileRepo>) -> Self {
        Self {
            pool,
            media_file_repo,
            credit_repo: None,
            language_repo: None,
            live_events: None,
        }
    }

    /// Opts this `MediaSync` into publishing a `library`/`upserted` live event
    /// for a series whose season or episode rows were created or edited by a
    /// sync pass (`docs/architecture/live-events.md`). Unchanged rows publish
    /// nothing, so a quiet five-minute poll stays silent.
    pub fn with_live_events(mut self, events: playarr_db::LiveEventPublisher) -> Self {
        self.live_events = Some(events);
        self
    }

    async fn announce_series_changed(&self, series_work_id: Uuid, source_instance_id: Uuid) {
        if let Some(events) = &self.live_events {
            events
                .publish(playarr_db::NewLiveEvent::for_library(
                    playarr_db::live_event_kind::LIBRARY,
                    "work",
                    series_work_id,
                    &["upserted"],
                    Some(source_instance_id),
                ))
                .await;
        }
    }

    /// Opts this `MediaSync` into recording the audio and embedded subtitle
    /// languages Sonarr/Radarr/Whisparr report in `mediaInfo`.
    pub fn with_language_repo(
        mut self,
        language_repo: std::sync::Arc<dyn MediaLanguageRepo>,
    ) -> Self {
        self.language_repo = Some(language_repo);
        self
    }

    /// Persists the languages from an *arr `mediaInfo` for `media_file_id`.
    /// Always records that the `arr` source ran (even with no `mediaInfo`) so
    /// the reconciliation backfill does not refetch the same file forever;
    /// ffprobe fills the gap for files the *arr app could not describe.
    /// Best-effort: an index failure never fails the file sync.
    async fn record_arr_languages(
        &self,
        media_file_id: Uuid,
        audio: Option<&str>,
        subtitles: Option<&str>,
    ) {
        let Some(repo) = &self.language_repo else {
            return;
        };
        let audio = playarr_model::language::parse_arr_languages(audio);
        let subtitles = playarr_model::language::parse_arr_languages(subtitles);
        let now_ms = chrono::Utc::now().timestamp_millis();
        if let Err(error) = repo
            .replace(
                media_file_id,
                playarr_db::repo::SOURCE_ARR,
                Some(&audio),
                Some(&subtitles),
                now_ms,
            )
            .await
        {
            tracing::warn!(%media_file_id, %error, "could not index media file languages");
        }
    }

    /// Opts this `MediaSync` into also syncing cast/crew credits for
    /// Radarr-sourced movies -- see `sync_radarr`'s doc comment.
    pub fn with_credit_repo(mut self, credit_repo: std::sync::Arc<dyn CreditRepo>) -> Self {
        self.credit_repo = Some(credit_repo);
        self
    }

    /// Whether `work_id` already has at least one synced `MediaFile` row --
    /// lets a caller distinguish "genuinely nothing to sync yet" from "a
    /// file sync was attempted and never completed" without needing its
    /// own tracking. Backs `ReconciliationPoller`'s missing-file backfill:
    /// see that type's doc comment on why a work's *catalog* identity being
    /// unchanged across passes doesn't guarantee its file-level sync ever
    /// actually succeeded.
    pub async fn has_any_media_file(&self, work_id: Uuid) -> Result<bool, MediaSyncError> {
        let files = self.media_file_repo.list_by_work_id(work_id).await?;
        Ok(!files.is_empty())
    }

    /// How many synced `MediaFile` rows `work_id` has.
    pub async fn media_file_count(&self, work_id: Uuid) -> Result<usize, MediaSyncError> {
        Ok(self.media_file_repo.list_by_work_id(work_id).await?.len())
    }

    /// Returns whether a work needs a file-level refresh because at least
    /// one existing file predates persisted runtimes. This makes the
    /// scheduled reconciliation pass a bounded backfill for established
    /// libraries instead of requiring tens of thousands of eager probes.
    pub async fn has_missing_duration(&self, work_id: Uuid) -> Result<bool, MediaSyncError> {
        let files = self.media_file_repo.list_by_work_id(work_id).await?;
        if files.iter().any(|file| file.duration_ms.is_none()) {
            return Ok(true);
        }
        // Language index backfill (task 180): a file synced before the index
        // existed has no `arr` state yet; one refresh records it.
        if let Some(repo) = &self.language_repo {
            for file in &files {
                if !repo
                    .has_state(file.id, playarr_db::repo::SOURCE_ARR)
                    .await?
                {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    /// Entry point [`crate::poller::ReconciliationPoller`] calls after
    /// upserting `work_id`'s catalog identity. `arr_source_id` is the *arr
    /// app's own numeric id for that same entity (see
    /// [`crate::arr_client::RemoteWork::source_id`]) — distinct from
    /// `work_id`, needed to call the per-app file-listing endpoints below.
    /// A no-op (not an error) for source kinds with no file-owning surface
    /// (Bazarr/Prowlarr) — [`crate::poller`] never calls this for those.
    pub async fn sync_work(
        &self,
        arr_client: &ArrClient,
        work_id: Uuid,
        arr_source_id: i64,
        source_instance_id: Uuid,
    ) -> Result<(), MediaSyncError> {
        let result = match arr_client {
            ArrClient::Sonarr(client) => {
                self.sync_sonarr(client, work_id, arr_source_id, source_instance_id)
                    .await
            }
            ArrClient::Radarr(client) => {
                self.sync_radarr(client, work_id, arr_source_id, source_instance_id)
                    .await
            }
            ArrClient::Lidarr(client) => {
                self.sync_lidarr(client, work_id, arr_source_id, source_instance_id)
                    .await
            }
            ArrClient::Readarr(client) => {
                self.sync_readarr(client, work_id, arr_source_id, source_instance_id)
                    .await
            }
            ArrClient::Whisparr(client) => {
                self.sync_whisparr(client, work_id, arr_source_id, source_instance_id)
                    .await
            }
            ArrClient::Bazarr(_) | ArrClient::Prowlarr(_) | ArrClient::Dubarr(_) => Ok(()),
        };
        if result.is_ok() {
            self.media_file_repo
                .mark_missing_durations_scanned(work_id)
                .await?;
        }
        result
    }

    // ---- Radarr: movie file embedded directly on the movie resource ----

    async fn sync_radarr(
        &self,
        client: &RadarrClient,
        work_id: Uuid,
        movie_id: i64,
        source_instance_id: Uuid,
    ) -> Result<(), MediaSyncError> {
        let movie = client.get_movie(movie_id).await?;
        let Some(file) = movie.movie_file else {
            // Monitored but not yet grabbed/imported -- nothing to record
            // yet, not an error.
            return Ok(());
        };

        let media_info = file.media_info.as_ref();
        let duration_ms = media_info
            .and_then(|info| info.run_time.as_deref())
            .and_then(runtime_string_to_ms)
            .or_else(|| minutes_to_ms(movie.runtime));
        let media_file = MediaFile {
            id: Uuid::new_v4(),
            work_id,
            leaf_ref: LeafRef::Work,
            path: PathBuf::from(&file.path),
            container: container_from_path(&file.path),
            codec: media_info
                .and_then(|m| m.video_codec.clone())
                .unwrap_or_else(|| file.quality.quality.name.clone()),
            bitrate: media_info.and_then(|m| m.video_bitrate).map(|b| b as u64),
            // `0` is a persisted "source metadata checked but did not
            // report a runtime" sentinel. Playarr still lazily ffprobes
            // that one file when opened, but scheduled reconciliation does
            // not repeatedly re-fetch the same unresolved title forever.
            duration_ms: Some(duration_ms.unwrap_or(0)),
            size_bytes: file.size as u64,
            source_instance_id,
            source_file_id: Some(file.id.to_string()),
        };
        let persisted = self.media_file_repo.upsert_by_source(&media_file).await?;
        self.record_arr_languages(
            persisted.id,
            media_info.and_then(|m| m.audio_languages.as_deref()),
            media_info.and_then(|m| m.subtitles.as_deref()),
        )
        .await;

        if let Some(credit_repo) = &self.credit_repo {
            self.sync_radarr_credits(credit_repo.as_ref(), client, work_id, movie_id)
                .await?;
        }
        Ok(())
    }

    /// `GET /api/v3/credit?movieId={id}` -- verified live against a real
    /// Radarr instance to be the only *arr credit source in this stack
    /// (see `RadarrCredit`'s doc comment). Dedupes each credited person by
    /// `person_tmdb_id` (one `Person` row per real individual, shared
    /// across every movie they appear in) via
    /// `CreditRepo::find_person_by_tmdb_id`, then fully replaces
    /// `work_id`'s credit list -- a full reconciliation each pass, same as
    /// every other Radarr-sourced field here, not an incremental diff.
    async fn sync_radarr_credits(
        &self,
        credit_repo: &dyn CreditRepo,
        client: &RadarrClient,
        work_id: Uuid,
        movie_id: i64,
    ) -> Result<(), MediaSyncError> {
        let remote_credits = client.list_credits(movie_id).await?;
        let mut credits = Vec::with_capacity(remote_credits.len());

        for remote in remote_credits {
            let person_id = self.find_or_upsert_person(credit_repo, &remote).await?;
            let role = match remote.credit_type.as_str() {
                "crew" => CreditRole::Crew {
                    department: remote.department.unwrap_or_default(),
                    job: remote.job.unwrap_or_default(),
                },
                // "cast", and anything unrecognized -- see
                // `SqlxCreditRepo::credit_from_row`'s matching fallback for
                // the same "never fail a sync pass over one unexpected
                // discriminant" rationale.
                _ => CreditRole::Cast {
                    character: remote.character.unwrap_or_default(),
                },
            };
            credits.push(Credit {
                id: Uuid::new_v4(),
                work_id,
                person_id,
                role,
                order: remote.order as i32,
            });
        }

        credit_repo
            .replace_credits_for_work(work_id, &credits)
            .await?;
        Ok(())
    }

    async fn find_or_upsert_person(
        &self,
        credit_repo: &dyn CreditRepo,
        remote: &RadarrCredit,
    ) -> Result<Uuid, MediaSyncError> {
        if let Some(existing) = credit_repo
            .find_person_by_tmdb_id(remote.person_tmdb_id)
            .await?
        {
            return Ok(existing.id);
        }

        let headshot_url = remote
            .images
            .iter()
            .find(|image| image.cover_type == "headshot")
            .and_then(|image| image.remote_url.clone());
        let person = Person {
            id: Uuid::new_v4(),
            name: remote.person_name.clone(),
            tmdb_id: Some(remote.person_tmdb_id),
            headshot_url,
        };
        credit_repo.upsert_person(&person).await?;
        Ok(person.id)
    }

    // ---- Sonarr: episodes + episode files, joined by episode_file_id ----

    async fn sync_sonarr(
        &self,
        client: &SonarrClient,
        series_work_id: Uuid,
        series_id: i64,
        source_instance_id: Uuid,
    ) -> Result<(), MediaSyncError> {
        let episodes = client.list_episodes(series_id).await?;
        let files = client.list_episode_files(series_id).await?;
        let files_by_id: HashMap<i64, SonarrEpisodeFile> =
            files.into_iter().map(|f| (f.id, f)).collect();

        let mut metadata_changed = false;
        for episode in episodes {
            // Sonarr's `0` sentinel means "no file imported yet" (see
            // `SonarrEpisode::episode_file_id`'s doc comment).
            if episode.episode_file_id == 0 {
                continue;
            }
            let Some(file) = files_by_id.get(&episode.episode_file_id) else {
                // Episode claims a file id `list_episode_files` didn't
                // return -- a transient inconsistency between the two
                // Sonarr calls; the next scheduled pass will pick it up.
                continue;
            };

            let (season_id, season_changed) = self
                .find_or_create_season(series_work_id, episode.season_number as i32)
                .await?;
            metadata_changed |= season_changed;
            let images = sonarr_images(&episode.images);
            let (episode_id, episode_changed) = self
                .find_or_upsert_episode(
                    season_id,
                    episode.episode_number as i32,
                    &episode.title,
                    episode.overview.as_deref(),
                    &images,
                    episode.air_date,
                    episode.runtime,
                    episode.monitored,
                )
                .await?;
            metadata_changed |= episode_changed;

            let media_info = file.media_info.as_ref();
            let duration_ms = media_info
                .and_then(|info| info.run_time.as_deref())
                .and_then(runtime_string_to_ms)
                .or_else(|| minutes_to_ms(episode.runtime));
            let media_file = MediaFile {
                id: Uuid::new_v4(),
                work_id: series_work_id,
                leaf_ref: LeafRef::Episode(episode_id),
                path: PathBuf::from(&file.path),
                container: container_from_path(&file.path),
                codec: media_info
                    .and_then(|m| m.video_codec.clone())
                    .unwrap_or_else(|| file.quality.quality.name.clone()),
                bitrate: media_info.and_then(|m| m.video_bitrate).map(|b| b as u64),
                duration_ms: Some(duration_ms.unwrap_or(0)),
                size_bytes: file.size as u64,
                source_instance_id,
                source_file_id: Some(file.id.to_string()),
            };
            let persisted = self.media_file_repo.upsert_by_source(&media_file).await?;
            self.record_arr_languages(
                persisted.id,
                media_info.and_then(|m| m.audio_languages.as_deref()),
                media_info.and_then(|m| m.subtitles.as_deref()),
            )
            .await;
        }
        if metadata_changed {
            self.announce_series_changed(series_work_id, source_instance_id)
                .await;
        }
        Ok(())
    }

    // ---- Whisparr: episodes (scenes) + episode files, joined by
    // episode_file_id -- structurally identical to `sync_sonarr` above
    // since Whisparr V3 is a direct Sonarr fork with the same per-episode
    // file-ownership shape (each scene can have its own file), unlike
    // Radarr's single-file-embedded-on-the-parent shape. ----

    async fn sync_whisparr(
        &self,
        client: &WhisparrClient,
        series_work_id: Uuid,
        series_id: i64,
        source_instance_id: Uuid,
    ) -> Result<(), MediaSyncError> {
        let episodes = client.list_episodes(series_id).await?;
        let files = client.list_episode_files(series_id).await?;
        let files_by_id: HashMap<i64, WhisparrEpisodeFile> =
            files.into_iter().map(|f| (f.id, f)).collect();

        let mut metadata_changed = false;
        for episode in episodes {
            // Whisparr uses the same `0` sentinel Sonarr does for "no file
            // imported yet" (see `WhisparrEpisode::episode_file_id`'s doc
            // comment).
            if episode.episode_file_id == 0 {
                continue;
            }
            let Some(file) = files_by_id.get(&episode.episode_file_id) else {
                // Episode claims a file id `list_episode_files` didn't
                // return -- a transient inconsistency between the two
                // Whisparr calls; the next scheduled pass will pick it up.
                continue;
            };

            let (season_id, season_changed) = self
                .find_or_create_season(series_work_id, episode.season_number as i32)
                .await?;
            metadata_changed |= season_changed;
            let images = whisparr_images(&episode.images);
            // Real Whisparr V3 instances omit `episodeNumber` entirely (see
            // `WhisparrEpisode::episode_number`'s doc comment) -- fall back
            // to Whisparr's own stable per-scene `id` so
            // `find_or_upsert_episode`'s `(season_id, episode_number)`
            // lookup key still resolves to the same row on every resync
            // (the same scene always carries the same Whisparr `id`),
            // rather than duplicating a row per pass.
            let episode_number = episode.episode_number.unwrap_or(episode.id) as i32;
            let (episode_id, episode_changed) = self
                .find_or_upsert_episode(
                    season_id,
                    episode_number,
                    &episode.title,
                    episode.overview.as_deref(),
                    &images,
                    episode.air_date,
                    episode.runtime,
                    episode.monitored,
                )
                .await?;
            metadata_changed |= episode_changed;

            let media_info = file.media_info.as_ref();
            let duration_ms = media_info
                .and_then(|info| info.run_time.as_deref())
                .and_then(runtime_string_to_ms)
                .or_else(|| minutes_to_ms(episode.runtime));
            let media_file = MediaFile {
                id: Uuid::new_v4(),
                work_id: series_work_id,
                leaf_ref: LeafRef::Episode(episode_id),
                path: PathBuf::from(&file.path),
                container: container_from_path(&file.path),
                codec: media_info
                    .and_then(|m| m.video_codec.clone())
                    .unwrap_or_else(|| file.quality.quality.name.clone()),
                bitrate: media_info.and_then(|m| m.video_bitrate).map(|b| b as u64),
                duration_ms: Some(duration_ms.unwrap_or(0)),
                size_bytes: file.size as u64,
                source_instance_id,
                source_file_id: Some(file.id.to_string()),
            };
            let persisted = self.media_file_repo.upsert_by_source(&media_file).await?;
            self.record_arr_languages(
                persisted.id,
                media_info.and_then(|m| m.audio_languages.as_deref()),
                media_info.and_then(|m| m.subtitles.as_deref()),
            )
            .await;
        }
        if metadata_changed {
            self.announce_series_changed(series_work_id, source_instance_id)
                .await;
        }
        Ok(())
    }

    // ---- Lidarr: albums + tracks + track files ----

    async fn sync_lidarr(
        &self,
        client: &LidarrClient,
        artist_work_id: Uuid,
        artist_id: i64,
        source_instance_id: Uuid,
    ) -> Result<(), MediaSyncError> {
        let albums = client.list_albums_for_artist(artist_id).await?;
        let tracks = client.list_tracks_for_artist(artist_id).await?;
        let files = client.list_track_files(artist_id).await?;
        let albums_by_id: HashMap<i64, LidarrAlbum> =
            albums.into_iter().map(|a| (a.id, a)).collect();
        let files_by_id = files
            .into_iter()
            .map(|file| (file.id, file))
            .collect::<HashMap<_, _>>();

        for track in tracks {
            if !track.has_file || track.track_file_id <= 0 {
                continue;
            }
            let Some(file) = files_by_id.get(&track.track_file_id) else {
                continue;
            };
            let Some(album) = albums_by_id.get(&track.album_id) else {
                continue;
            };
            let Some(album_title) = album
                .title
                .as_deref()
                .filter(|title| !title.trim().is_empty())
            else {
                continue;
            };
            let Some(track_title) = track
                .title
                .as_deref()
                .filter(|title| !title.trim().is_empty())
            else {
                continue;
            };
            let Some(path) = file.path.as_deref().filter(|path| !path.trim().is_empty()) else {
                continue;
            };
            let album_id = self
                .find_or_create_album(artist_work_id, album, album_title, source_instance_id)
                .await?;
            let disc_number = track.medium_number.max(1);
            let track_number = lidarr_track_number(&track).max(1);
            let duration_seconds = (track.duration > 0).then_some((track.duration + 999) / 1_000);
            let track_id = self
                .find_or_create_track(
                    album_id,
                    disc_number,
                    track_number,
                    track_title,
                    duration_seconds,
                )
                .await?;

            let media_info = file.media_info.as_ref();
            let media_file = MediaFile {
                id: Uuid::new_v4(),
                work_id: artist_work_id,
                leaf_ref: LeafRef::Track(track_id),
                path: PathBuf::from(path),
                container: container_from_path(path),
                codec: media_info
                    .and_then(|m| m.audio_codec.as_deref())
                    .filter(|codec| !codec.trim().is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| file.quality.quality.name.clone()),
                bitrate: media_info
                    .and_then(|m| m.audio_bitrate)
                    .and_then(|kbps| u64::try_from(kbps).ok())
                    .and_then(|kbps| kbps.checked_mul(1_000)),
                duration_ms: (track.duration > 0).then_some(track.duration as u64),
                size_bytes: file.size as u64,
                source_instance_id,
                source_file_id: Some(file.id.to_string()),
            };
            self.media_file_repo.upsert_by_source(&media_file).await?;
        }
        Ok(())
    }

    // ---- Readarr: books + book files, joined by book_id ----

    async fn sync_readarr(
        &self,
        client: &ReadarrClient,
        author_work_id: Uuid,
        author_id: i64,
        source_instance_id: Uuid,
    ) -> Result<(), MediaSyncError> {
        let books = client.list_books_for_author(author_id).await?;
        let files = client.list_book_files(author_id).await?;
        let books_by_id: HashMap<i64, ReadarrBook> = books.into_iter().map(|b| (b.id, b)).collect();

        for file in files {
            let Some(book) = books_by_id.get(&file.book_id) else {
                continue;
            };
            let book_id = self
                .find_or_create_book(author_work_id, &book.title)
                .await?;

            let media_file = MediaFile {
                id: Uuid::new_v4(),
                work_id: author_work_id,
                leaf_ref: LeafRef::Book(book_id),
                path: PathBuf::from(&file.path),
                container: container_from_path(&file.path),
                // Readarr's trimmed book-file DTO carries no `mediaInfo`
                // (see `ReadarrBookFile`'s doc comment) -- the quality
                // name (e.g. "EPUB") is the closest available stand-in for
                // a format/codec label.
                codec: file.quality.quality.name.clone(),
                bitrate: None,
                duration_ms: Some(0),
                size_bytes: file.size as u64,
                source_instance_id,
                source_file_id: Some(file.id.to_string()),
            };
            self.media_file_repo.upsert_by_source(&media_file).await?;
        }
        Ok(())
    }

    // ---- child-entity id resolution ----

    async fn find_or_create_season(
        &self,
        series_work_id: Uuid,
        season_number: i32,
    ) -> Result<(Uuid, bool), MediaSyncError> {
        let select_sql = "SELECT id FROM seasons WHERE series_work_id = ? AND season_number = ?";
        if let Some(id) = self
            .select_uuid(select_sql, series_work_id.to_string(), season_number as i64)
            .await?
        {
            return Ok((id, false));
        }

        let id = Uuid::new_v4();
        let insert_sql = "INSERT INTO seasons (id, series_work_id, season_number, title, overview, monitored, availability) \
                 VALUES (?, ?, ?, NULL, NULL, 1, 'unknown')";
        sqlx::query(insert_sql)
            .bind(id.to_string())
            .bind(series_work_id.to_string())
            .bind(season_number as i64)
            .execute(&self.pool)
            .await?;
        Ok((id, true))
    }

    /// Finds the episode row for `(season_id, episode_number)`, updating its
    /// title/monitored/availability to the latest Sonarr state if it already
    /// exists, or inserting a fresh one (marked `available`, since this is
    /// only ever called for an episode a file was just matched against) if
    /// not. The flag in the result is `true` when a row was inserted or an
    /// existing row's metadata actually changed (the update is guarded so an
    /// identical re-sync touches no row), which drives the live event.
    #[allow(clippy::too_many_arguments)]
    async fn find_or_upsert_episode(
        &self,
        season_id: Uuid,
        episode_number: i32,
        title: &str,
        overview: Option<&str>,
        images: &[ImageAsset],
        air_date: Option<chrono::NaiveDate>,
        runtime_minutes: Option<u32>,
        monitored: bool,
    ) -> Result<(Uuid, bool), MediaSyncError> {
        let images_json = serde_json::to_string(images).map_err(playarr_db::DbError::from)?;
        let select_sql = "SELECT id FROM episodes WHERE season_id = ? AND episode_number = ?";
        if let Some(id) = self
            .select_uuid(select_sql, season_id.to_string(), episode_number as i64)
            .await?
        {
            let update_sql = "UPDATE episodes SET title = ?, overview = ?, images = ?, air_date = ?, runtime_minutes = ?, monitored = ?, availability = 'available' WHERE id = ? \
                     AND (title IS NOT ? OR overview IS NOT ? OR images IS NOT ? OR air_date IS NOT ? \
                          OR runtime_minutes IS NOT ? OR monitored IS NOT ? OR availability IS NOT 'available')";
            let air_date = air_date.map(|date| date.format("%Y-%m-%d").to_string());
            let runtime = runtime_minutes.map(i64::from);
            let mut query = sqlx::query(update_sql)
                .bind(title)
                .bind(overview)
                .bind(&images_json)
                .bind(air_date.clone())
                .bind(runtime)
                .bind(monitored as i64)
                .bind(id.to_string());
            {
                // SQLite's `?` placeholders are positional: repeat the values
                // for the "did anything change" guard.
                query = query
                    .bind(title)
                    .bind(overview)
                    .bind(&images_json)
                    .bind(air_date)
                    .bind(runtime)
                    .bind(monitored as i64);
            }
            let changed = query.execute(&self.pool).await?.rows_affected() > 0;
            return Ok((id, changed));
        }

        let id = Uuid::new_v4();
        let insert_sql = "INSERT INTO episodes (id, season_id, episode_number, title, overview, images, air_date, runtime_minutes, monitored, availability) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'available')";
        sqlx::query(insert_sql)
            .bind(id.to_string())
            .bind(season_id.to_string())
            .bind(episode_number as i64)
            .bind(title)
            .bind(overview)
            .bind(images_json)
            .bind(air_date.map(|date| date.format("%Y-%m-%d").to_string()))
            .bind(runtime_minutes.map(i64::from))
            .bind(monitored as i64)
            .execute(&self.pool)
            .await?;
        Ok((id, true))
    }

    async fn find_or_create_album(
        &self,
        artist_work_id: Uuid,
        album: &LidarrAlbum,
        title: &str,
        source_instance_id: Uuid,
    ) -> Result<Uuid, MediaSyncError> {
        let select_sql = "SELECT id FROM albums WHERE artist_work_id = ? AND title = ?";
        if let Some(id) = self
            .select_uuid_str(select_sql, artist_work_id.to_string(), title)
            .await?
        {
            self.update_album(id, album, source_instance_id).await?;
            return Ok(id);
        }

        let id = Uuid::new_v4();
        let album_type = lidarr_album_type(album);
        let release_date = lidarr_release_date(album.release_date.as_deref());
        let images_json = serde_json::to_string(&lidarr_album_images(album, source_instance_id))
            .map_err(playarr_db::DbError::from)?;
        let insert_sql = "INSERT INTO albums (id, artist_work_id, title, images, album_type, release_date, monitored, availability) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'available')";
        sqlx::query(insert_sql)
            .bind(id.to_string())
            .bind(artist_work_id.to_string())
            .bind(title)
            .bind(images_json)
            .bind(album_type)
            .bind(release_date)
            .bind(album.monitored as i64)
            .execute(&self.pool)
            .await?;
        Ok(id)
    }

    async fn update_album(
        &self,
        album_id: Uuid,
        album: &LidarrAlbum,
        source_instance_id: Uuid,
    ) -> Result<(), MediaSyncError> {
        let images_json = serde_json::to_string(&lidarr_album_images(album, source_instance_id))
            .map_err(playarr_db::DbError::from)?;
        let update_sql = "UPDATE albums SET images = ?, album_type = ?, release_date = ?, monitored = ?, availability = 'available' \
                 WHERE id = ?";
        sqlx::query(update_sql)
            .bind(images_json)
            .bind(lidarr_album_type(album))
            .bind(lidarr_release_date(album.release_date.as_deref()))
            .bind(album.monitored as i64)
            .bind(album_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn find_or_create_track(
        &self,
        album_id: Uuid,
        disc_number: i64,
        track_number: i64,
        title: &str,
        duration_seconds: Option<i64>,
    ) -> Result<Uuid, MediaSyncError> {
        let select_sql =
            "SELECT id FROM tracks WHERE album_id = ? AND disc_number = ? AND track_number = ?";
        let row = sqlx::query(select_sql)
            .bind(album_id.to_string())
            .bind(disc_number)
            .bind(track_number)
            .fetch_optional(&self.pool)
            .await?;
        if let Some(row) = row {
            let id = uuid_from_row(&row)?;
            let update_sql = "UPDATE tracks SET title = ?, duration_seconds = ?, availability = 'available' WHERE id = ?";
            sqlx::query(update_sql)
                .bind(title)
                .bind(duration_seconds)
                .bind(id.to_string())
                .execute(&self.pool)
                .await?;
            return Ok(id);
        }

        let id = Uuid::new_v4();
        let insert_sql = "INSERT INTO tracks (id, album_id, disc_number, track_number, title, duration_seconds, availability) \
                 VALUES (?, ?, ?, ?, ?, ?, 'available')";
        sqlx::query(insert_sql)
            .bind(id.to_string())
            .bind(album_id.to_string())
            .bind(disc_number)
            .bind(track_number)
            .bind(title)
            .bind(duration_seconds)
            .execute(&self.pool)
            .await?;
        Ok(id)
    }

    async fn find_or_create_book(
        &self,
        author_work_id: Uuid,
        title: &str,
    ) -> Result<Uuid, MediaSyncError> {
        let select_sql = "SELECT id FROM books WHERE author_work_id = ? AND title = ?";
        if let Some(id) = self
            .select_uuid_str(select_sql, author_work_id.to_string(), title)
            .await?
        {
            return Ok(id);
        }

        let id = Uuid::new_v4();
        let insert_sql = "INSERT INTO books (id, author_work_id, title, isbn, release_date, series_name, series_position, monitored, availability) \
                 VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 1, 'available')";
        sqlx::query(insert_sql)
            .bind(id.to_string())
            .bind(author_work_id.to_string())
            .bind(title)
            .execute(&self.pool)
            .await?;
        Ok(id)
    }

    /// Runs a `SELECT id FROM ... WHERE <uuid col> = ? AND <int col> = ?`
    /// shaped query and decodes the single `id` column, if any row matched.
    async fn select_uuid(
        &self,
        sql: &str,
        uuid_param: String,
        int_param: i64,
    ) -> Result<Option<Uuid>, MediaSyncError> {
        let row = sqlx::query(sql)
            .bind(uuid_param)
            .bind(int_param)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(uuid_from_row).transpose()
    }

    /// Same shape as [`Self::select_uuid`], for `WHERE <uuid col> = ? AND
    /// <text col> = ?` queries.
    async fn select_uuid_str(
        &self,
        sql: &str,
        uuid_param: String,
        str_param: &str,
    ) -> Result<Option<Uuid>, MediaSyncError> {
        let row = sqlx::query(sql)
            .bind(uuid_param)
            .bind(str_param)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(uuid_from_row).transpose()
    }
}

fn uuid_from_row(row: &sqlx::any::AnyRow) -> Result<Uuid, MediaSyncError> {
    use sqlx::Row;
    let raw: String = row.try_get("id")?;
    Uuid::parse_str(&raw)
        .map_err(|e| MediaSyncError::Sql(sqlx::Error::Decode(e.to_string().into())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use playarr_db::repo::SqlxMediaFileRepo;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    /// Opens a fresh, migrated, in-memory SQLite `DbPool` and inserts a
    /// parent `works` row -- same pattern `playarr-catalog`'s and
    /// `playarr-api`'s test harnesses use, and the same reason
    /// (`media_files.work_id`/`seasons.series_work_id`/etc all carry a real
    /// `REFERENCES works (id)` foreign key).
    async fn test_pool_with_work(work_id: Uuid, kind: &str) -> DbPool {
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let url = format!("sqlite://playarr_arr_sync_media_test_{n}?mode=memory&cache=shared");

        sqlx::any::install_default_drivers();
        let pool: DbPool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .expect("open in-memory sqlite pool");
        playarr_db::run_migrations(&pool)
            .await
            .expect("run real embedded sqlite migrations");

        sqlx::query(
            "INSERT INTO works (id, kind, title, sort_title, added_at, availability) \
             VALUES (?, ?, 'Test Work', 'Test Work', '2024-01-01T00:00:00.000Z', 'available')",
        )
        .bind(work_id.to_string())
        .bind(kind)
        .execute(&pool)
        .await
        .expect("insert parent work row");

        pool
    }

    fn media_sync(pool: DbPool) -> MediaSync {
        let repo: Arc<dyn MediaFileRepo> = Arc::new(SqlxMediaFileRepo::new(pool.clone()));
        MediaSync::new(pool, repo)
    }

    #[test]
    fn parses_arr_runtime_strings() {
        assert_eq!(runtime_string_to_ms("2:50:00"), Some(10_200_000));
        assert_eq!(runtime_string_to_ms("42:00"), Some(2_520_000));
        assert_eq!(runtime_string_to_ms("00:42:00.500"), Some(2_520_500));
        assert_eq!(runtime_string_to_ms("N/A"), None);
        assert_eq!(runtime_string_to_ms("00:99:00"), None);
    }

    // ---- Radarr ----

    #[tokio::test]
    async fn sync_radarr_upserts_a_work_leaf_media_file() {
        let work_id = Uuid::new_v4();
        let pool = test_pool_with_work(work_id, "movie").await;
        let sync = media_sync(pool.clone());

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/movie/1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": 1,
                "title": "Orbit",
                "sortTitle": "heat",
                "tmdbId": 949,
                "monitored": true,
                "hasFile": true,
                "path": "/movies/Orbit (1995)",
                "movieFile": {
                    "id": 30,
                    "movieId": 1,
                    "relativePath": "Orbit (1995) Bluray-1080p.mkv",
                    "path": "/movies/Orbit (1995)/Orbit (1995) Bluray-1080p.mkv",
                    "size": 12_345_678_900i64,
                    "quality": {
                        "quality": { "id": 7, "name": "Bluray-1080p", "source": "bluray", "resolution": 1080 },
                        "revision": { "version": 1, "real": 0, "isRepack": false }
                    },
                    "mediaInfo": {
                        "audioCodec": "DTS",
                        "audioBitrate": 1_509_000,
                        "audioChannels": 6.0,
                        "videoCodec": "x264",
                        "videoBitrate": 8_000_000,
                        "resolution": "1920x1080",
                        "runTime": "2:50:00"
                    }
                }
            })))
            .mount(&server)
            .await;

        let client = ArrClient::Radarr(RadarrClient::new(server.uri(), "test-key"));
        let instance_id = Uuid::new_v4();
        sync.sync_work(&client, work_id, 1, instance_id)
            .await
            .expect("sync_work should succeed");

        let media_file_repo: Arc<dyn MediaFileRepo> = Arc::new(SqlxMediaFileRepo::new(pool));
        let files = media_file_repo.list_by_work_id(work_id).await.unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].leaf_ref, LeafRef::Work);
        assert_eq!(files[0].codec, "x264");
        assert_eq!(files[0].container, "mkv");
        assert_eq!(files[0].source_file_id.as_deref(), Some("30"));
        assert_eq!(files[0].source_instance_id, instance_id);
        assert_eq!(files[0].duration_ms, Some(10_200_000));
    }

    #[tokio::test]
    async fn sync_radarr_without_a_file_is_a_noop() {
        let work_id = Uuid::new_v4();
        let pool = test_pool_with_work(work_id, "movie").await;
        let sync = media_sync(pool.clone());

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/movie/7"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": 7,
                "title": "Sample Seven",
                "sortTitle": "sample seven",
                "tmdbId": 807,
                "monitored": true,
                "hasFile": false,
                "path": "/movies/Sample Seven (1995)"
            })))
            .mount(&server)
            .await;

        let client = ArrClient::Radarr(RadarrClient::new(server.uri(), "test-key"));
        sync.sync_work(&client, work_id, 7, Uuid::new_v4())
            .await
            .expect("sync_work should succeed even with no file yet");

        let media_file_repo: Arc<dyn MediaFileRepo> = Arc::new(SqlxMediaFileRepo::new(pool));
        assert!(media_file_repo
            .list_by_work_id(work_id)
            .await
            .unwrap()
            .is_empty());
    }

    // ---- Sonarr ----

    #[tokio::test]
    async fn find_or_upsert_episode_persists_remote_thumbnail() {
        let work_id = Uuid::new_v4();
        let pool = test_pool_with_work(work_id, "series").await;
        let sync = media_sync(pool.clone());
        let (season_id, _) = sync.find_or_create_season(work_id, 1).await.unwrap();
        let images = vec![ImageAsset {
            kind: playarr_model::ImageKind::Thumb,
            url: "https://artworks.thetvdb.com/episodes/10.jpg".to_string(),
            width: None,
            height: None,
        }];

        let (episode_id, created) = sync
            .find_or_upsert_episode(
                season_id,
                1,
                "Pilot",
                Some("First episode"),
                &images,
                chrono::NaiveDate::from_ymd_opt(2024, 1, 2),
                Some(43),
                true,
            )
            .await
            .unwrap();
        let replacement = vec![ImageAsset {
            kind: playarr_model::ImageKind::Thumb,
            url: "https://artworks.thetvdb.com/episodes/10-v2.jpg".to_string(),
            width: None,
            height: None,
        }];
        let (updated_id, updated) = sync
            .find_or_upsert_episode(
                season_id,
                1,
                "Pilot",
                Some("Updated synopsis"),
                &replacement,
                chrono::NaiveDate::from_ymd_opt(2024, 1, 3),
                Some(44),
                true,
            )
            .await
            .unwrap();
        assert_eq!(updated_id, episode_id);
        assert!(
            created && updated,
            "insert and real edit both report a change"
        );

        let images_json: (String,) = sqlx::query_as("SELECT images FROM episodes WHERE id = ?")
            .bind(episode_id.to_string())
            .fetch_one(&pool)
            .await
            .unwrap();
        let persisted: Vec<ImageAsset> = serde_json::from_str(&images_json.0).unwrap();
        assert_eq!(persisted, replacement);

        let metadata: (Option<String>, Option<String>, Option<i64>) =
            sqlx::query_as("SELECT overview, air_date, runtime_minutes FROM episodes WHERE id = ?")
                .bind(episode_id.to_string())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(metadata.0.as_deref(), Some("Updated synopsis"));
        assert_eq!(metadata.1.as_deref(), Some("2024-01-03"));
        assert_eq!(metadata.2, Some(44));
    }

    #[tokio::test]
    async fn find_or_upsert_episode_reports_a_change_only_when_metadata_differs() {
        let work_id = Uuid::new_v4();
        let pool = test_pool_with_work(work_id, "series").await;
        let sync = media_sync(pool);
        let (season_id, season_created) = sync.find_or_create_season(work_id, 1).await.unwrap();
        let (_, season_again) = sync.find_or_create_season(work_id, 1).await.unwrap();
        assert!(season_created && !season_again);

        let upsert = |title: &'static str, overview: Option<&'static str>, runtime| {
            sync.find_or_upsert_episode(
                season_id,
                1,
                title,
                overview,
                &[],
                chrono::NaiveDate::from_ymd_opt(2024, 1, 2),
                runtime,
                true,
            )
        };
        assert!(upsert("Pilot", None, Some(43)).await.unwrap().1, "insert");
        assert!(
            !upsert("Pilot", None, Some(43)).await.unwrap().1,
            "identical"
        );
        assert!(
            upsert("Pilot", Some("Synopsis"), Some(43)).await.unwrap().1,
            "overview"
        );
        assert!(
            !upsert("Pilot", Some("Synopsis"), Some(43)).await.unwrap().1,
            "identical"
        );
        assert!(
            upsert("Pilot", Some("Synopsis"), None).await.unwrap().1,
            "runtime to null"
        );
        assert!(
            !upsert("Pilot", Some("Synopsis"), None).await.unwrap().1,
            "null is stable"
        );
        assert!(
            upsert("Renamed", Some("Synopsis"), None).await.unwrap().1,
            "title"
        );
    }

    async fn series_upserted_events(pool: &DbPool, series: Uuid) -> usize {
        let repo = playarr_db::SqlxLiveEventRepo::new(pool.clone());
        playarr_db::LiveEventRepo::list_after(&repo, 0, 1000)
            .await
            .unwrap()
            .iter()
            .filter(|e| {
                e.kind == "library"
                    && e.entity == "work"
                    && e.entity_id.as_deref() == Some(series.to_string().as_str())
                    && e.changed == ["upserted"]
            })
            .count()
    }

    /// Season and episode rows are written with raw SQL, so the sync announces
    /// metadata edits itself: once for the first sight, silence for an identical
    /// re-sync, and once more when the *arr app edits an episode (task 278).
    #[tokio::test]
    async fn sync_sonarr_publishes_library_events_for_episode_metadata_edits_only() {
        let work_id = Uuid::new_v4();
        let pool = test_pool_with_work(work_id, "series").await;
        let sync = media_sync(pool.clone())
            .with_live_events(playarr_db::LiveEventPublisher::from_pool(pool.clone()));
        let source = Uuid::new_v4();

        let server = MockServer::start().await;
        mount_sonarr(&server, 1).await;
        let client = ArrClient::Sonarr(SonarrClient::new(server.uri(), "test-key"));
        sync.sync_work(&client, work_id, 1, source).await.unwrap();
        assert_eq!(
            series_upserted_events(&pool, work_id).await,
            1,
            "first sight"
        );
        sync.sync_work(&client, work_id, 1, source).await.unwrap();
        assert_eq!(
            series_upserted_events(&pool, work_id).await,
            1,
            "unchanged re-sync is silent"
        );

        let edited = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/episode"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                sonarr_episode_json(10, 1, 1, "Pilot, retitled", 55),
            ])))
            .mount(&edited)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v3/episodefile"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                sonarr_episode_file_json(55, 1, "S01E01.mkv"),
            ])))
            .mount(&edited)
            .await;
        let client = ArrClient::Sonarr(SonarrClient::new(edited.uri(), "test-key"));
        sync.sync_work(&client, work_id, 1, source).await.unwrap();
        assert_eq!(
            series_upserted_events(&pool, work_id).await,
            2,
            "title edit announced"
        );
    }

    fn sonarr_episode_json(
        id: i64,
        season: i64,
        number: i64,
        title: &str,
        episode_file_id: i64,
    ) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "seriesId": 1,
            "seasonNumber": season,
            "episodeNumber": number,
            "title": title,
            "overview": format!("{title} synopsis"),
            "airDate": "2024-01-02",
            "runtime": 43,
            "images": [
                {
                    "coverType": "screenshot",
                    "url": format!("/MediaCover/episodes/{id}/screenshot.jpg"),
                    "remoteUrl": format!("https://artworks.thetvdb.com/episodes/{id}.jpg")
                },
                {
                    "coverType": "screenshot",
                    "url": format!("/MediaCover/episodes/{id}/local-only.jpg")
                }
            ],
            "hasFile": episode_file_id != 0,
            "monitored": true,
            "episodeFileId": episode_file_id
        })
    }

    fn sonarr_episode_file_json(id: i64, season: i64, path: &str) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "seriesId": 1,
            "seasonNumber": season,
            "relativePath": path,
            "path": format!("/tv/Show/{path}"),
            "size": 1_234_567i64,
            "quality": {
                "quality": { "id": 7, "name": "Bluray-1080p", "source": "bluray", "resolution": 1080 },
                "revision": { "version": 1, "real": 0, "isRepack": false }
            },
            "mediaInfo": {
                "audioCodec": "AC3",
                "audioBitrate": 384000,
                "audioChannels": 6.0,
                "videoCodec": "x264",
                "videoBitrate": 4_000_000,
                "resolution": "1920x1080",
                "runTime": "00:42:00.500"
            }
        })
    }

    async fn mount_sonarr(server: &MockServer, series_id: i64) {
        Mock::given(method("GET"))
            .and(path("/api/v3/episode"))
            .and(query_param("seriesId", series_id.to_string()))
            .and(query_param("includeImages", "true"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                sonarr_episode_json(10, 1, 1, "Pilot", 55),
                sonarr_episode_json(11, 1, 2, "Test Episode One", 0),
            ])))
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v3/episodefile"))
            .and(query_param("seriesId", series_id.to_string()))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                sonarr_episode_file_json(55, 1, "S01E01.mkv"),
            ])))
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn sync_sonarr_creates_season_episode_and_media_file_for_episode_with_file() {
        let work_id = Uuid::new_v4();
        let pool = test_pool_with_work(work_id, "series").await;
        let sync = media_sync(pool.clone());

        let server = MockServer::start().await;
        mount_sonarr(&server, 1).await;

        let client = ArrClient::Sonarr(SonarrClient::new(server.uri(), "test-key"));
        sync.sync_work(&client, work_id, 1, Uuid::new_v4())
            .await
            .expect("sync_work should succeed");

        let media_file_repo: Arc<dyn MediaFileRepo> =
            Arc::new(SqlxMediaFileRepo::new(pool.clone()));
        let files = media_file_repo.list_by_work_id(work_id).await.unwrap();
        // Only the episode with a real `episode_file_id` (Pilot) gets a
        // `MediaFile` -- the second episode (`episodeFileId: 0`) is skipped.
        assert_eq!(files.len(), 1);
        let episode_id = match files[0].leaf_ref {
            LeafRef::Episode(id) => id,
            other => panic!("expected LeafRef::Episode, got {other:?}"),
        };
        assert_eq!(files[0].container, "mkv");
        assert_eq!(files[0].codec, "x264");
        assert_eq!(files[0].source_file_id.as_deref(), Some("55"));
        assert_eq!(files[0].duration_ms, Some(2_520_500));

        let seasons: Vec<(String, i64)> = sqlx::query_as("SELECT id, season_number FROM seasons")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(seasons.len(), 1);
        assert_eq!(seasons[0].1, 1);

        let episode_row: (
            String,
            i64,
            String,
            String,
            Option<String>,
            Option<String>,
            Option<i64>,
        ) = sqlx::query_as(
            "SELECT id, episode_number, title, images, overview, air_date, runtime_minutes \
                 FROM episodes WHERE id = ?",
        )
        .bind(episode_id.to_string())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(episode_row.1, 1);
        assert_eq!(episode_row.2, "Pilot");
        let images: Vec<ImageAsset> = serde_json::from_str(&episode_row.3).unwrap();
        assert_eq!(images.len(), 1, "local-only Sonarr artwork is dropped");
        assert_eq!(episode_row.4.as_deref(), Some("Pilot synopsis"));
        assert_eq!(episode_row.5.as_deref(), Some("2024-01-02"));
        assert_eq!(episode_row.6, Some(43));
        assert_eq!(images[0].kind, playarr_model::ImageKind::Thumb);
        assert_eq!(
            images[0].url,
            "https://artworks.thetvdb.com/episodes/10.jpg"
        );
    }

    #[tokio::test]
    async fn sync_sonarr_is_idempotent_across_resyncs() {
        let work_id = Uuid::new_v4();
        let pool = test_pool_with_work(work_id, "series").await;
        let sync = media_sync(pool.clone());

        let server = MockServer::start().await;
        mount_sonarr(&server, 1).await;
        let client = ArrClient::Sonarr(SonarrClient::new(server.uri(), "test-key"));
        let instance_id = Uuid::new_v4();

        sync.sync_work(&client, work_id, 1, instance_id)
            .await
            .unwrap();
        let media_file_repo: Arc<dyn MediaFileRepo> =
            Arc::new(SqlxMediaFileRepo::new(pool.clone()));
        let first_pass = media_file_repo.list_by_work_id(work_id).await.unwrap();
        assert_eq!(first_pass.len(), 1);
        let episode_id_first = match first_pass[0].leaf_ref {
            LeafRef::Episode(id) => id,
            other => panic!("expected LeafRef::Episode, got {other:?}"),
        };

        // Re-sync -- same season/episode natural keys and the same
        // (source_instance_id, source_file_id) file key must resolve back
        // to the same rows, not duplicate them.
        sync.sync_work(&client, work_id, 1, instance_id)
            .await
            .unwrap();
        let second_pass = media_file_repo.list_by_work_id(work_id).await.unwrap();
        assert_eq!(
            second_pass.len(),
            1,
            "resync must not duplicate the MediaFile row"
        );
        assert_eq!(second_pass[0].id, first_pass[0].id);
        let episode_id_second = match second_pass[0].leaf_ref {
            LeafRef::Episode(id) => id,
            other => panic!("expected LeafRef::Episode, got {other:?}"),
        };
        assert_eq!(
            episode_id_second, episode_id_first,
            "resync must resolve back to the same episode row, not create a second one"
        );

        let episode_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM episodes")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(episode_count.0, 1);
    }

    // ---- Whisparr ----

    fn whisparr_episode_json(
        id: i64,
        season: i64,
        number: i64,
        title: &str,
        episode_file_id: i64,
    ) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "seriesId": 1,
            "seasonNumber": season,
            "episodeNumber": number,
            "title": title,
            "overview": format!("{title} synopsis"),
            "releaseDate": "2024-01-02",
            "runtime": 32,
            "images": [
                {
                    "coverType": "screenshot",
                    "url": format!("/MediaCover/episodes/{id}/screenshot.jpg"),
                    "remoteUrl": format!("https://cdn.theporndb.net/episodes/{id}.jpg")
                },
                {
                    "coverType": "screenshot",
                    "url": format!("/MediaCover/episodes/{id}/local-only.jpg")
                }
            ],
            "hasFile": episode_file_id != 0,
            "monitored": true,
            "episodeFileId": episode_file_id
        })
    }

    fn whisparr_episode_file_json(id: i64, season: i64, path: &str) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "seriesId": 1,
            "seasonNumber": season,
            "relativePath": path,
            "path": format!("/scenes/Studio/{path}"),
            "size": 1_234_567i64,
            "quality": {
                "quality": { "id": 7, "name": "Bluray-1080p", "source": "bluray", "resolution": 1080 },
                "revision": { "version": 1, "real": 0, "isRepack": false }
            },
            "mediaInfo": {
                "audioCodec": "AC3",
                "audioBitrate": 384000,
                "audioChannels": 6.0,
                "videoCodec": "x264",
                "videoBitrate": 4_000_000,
                "resolution": "1920x1080",
                "runTime": "00:32:00.500"
            }
        })
    }

    async fn mount_whisparr(server: &MockServer, series_id: i64) {
        Mock::given(method("GET"))
            .and(path("/api/v3/episode"))
            .and(query_param("seriesId", series_id.to_string()))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                whisparr_episode_json(10, 1, 1, "Scene One", 55),
                whisparr_episode_json(11, 1, 2, "Scene Two", 0),
            ])))
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v3/episodefile"))
            .and(query_param("seriesId", series_id.to_string()))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                whisparr_episode_file_json(55, 1, "S01E01.mkv"),
            ])))
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn sync_whisparr_creates_season_episode_and_media_file_for_episode_with_file() {
        let work_id = Uuid::new_v4();
        let pool = test_pool_with_work(work_id, "series").await;
        let sync = media_sync(pool.clone());

        let server = MockServer::start().await;
        mount_whisparr(&server, 1).await;

        let client = ArrClient::Whisparr(WhisparrClient::new(server.uri(), "test-key"));
        sync.sync_work(&client, work_id, 1, Uuid::new_v4())
            .await
            .expect("sync_work should succeed");

        let media_file_repo: Arc<dyn MediaFileRepo> =
            Arc::new(SqlxMediaFileRepo::new(pool.clone()));
        let files = media_file_repo.list_by_work_id(work_id).await.unwrap();
        // Only the episode with a real `episode_file_id` (Scene One) gets a
        // `MediaFile` -- the second episode (`episodeFileId: 0`) is skipped.
        assert_eq!(files.len(), 1);
        let episode_id = match files[0].leaf_ref {
            LeafRef::Episode(id) => id,
            other => panic!("expected LeafRef::Episode, got {other:?}"),
        };
        assert_eq!(files[0].container, "mkv");
        assert_eq!(files[0].codec, "x264");
        assert_eq!(files[0].source_file_id.as_deref(), Some("55"));
        assert_eq!(files[0].duration_ms, Some(1_920_500));

        let seasons: Vec<(String, i64)> = sqlx::query_as("SELECT id, season_number FROM seasons")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(seasons.len(), 1);
        assert_eq!(seasons[0].1, 1);

        let episode_row: (
            String,
            i64,
            String,
            String,
            Option<String>,
            Option<String>,
            Option<i64>,
        ) = sqlx::query_as(
            "SELECT id, episode_number, title, images, overview, air_date, runtime_minutes \
                 FROM episodes WHERE id = ?",
        )
        .bind(episode_id.to_string())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(episode_row.1, 1);
        assert_eq!(episode_row.2, "Scene One");
        let images: Vec<ImageAsset> = serde_json::from_str(&episode_row.3).unwrap();
        assert_eq!(images.len(), 1, "local-only Whisparr artwork is dropped");
        assert_eq!(episode_row.4.as_deref(), Some("Scene One synopsis"));
        assert_eq!(episode_row.5.as_deref(), Some("2024-01-02"));
        assert_eq!(episode_row.6, Some(32));
        assert_eq!(images[0].kind, playarr_model::ImageKind::Thumb);
        assert_eq!(images[0].url, "https://cdn.theporndb.net/episodes/10.jpg");
    }

    #[tokio::test]
    async fn sync_whisparr_is_idempotent_across_resyncs() {
        let work_id = Uuid::new_v4();
        let pool = test_pool_with_work(work_id, "series").await;
        let sync = media_sync(pool.clone());

        let server = MockServer::start().await;
        mount_whisparr(&server, 1).await;
        let client = ArrClient::Whisparr(WhisparrClient::new(server.uri(), "test-key"));
        let instance_id = Uuid::new_v4();

        sync.sync_work(&client, work_id, 1, instance_id)
            .await
            .unwrap();
        let media_file_repo: Arc<dyn MediaFileRepo> =
            Arc::new(SqlxMediaFileRepo::new(pool.clone()));
        let first_pass = media_file_repo.list_by_work_id(work_id).await.unwrap();
        assert_eq!(first_pass.len(), 1);
        let episode_id_first = match first_pass[0].leaf_ref {
            LeafRef::Episode(id) => id,
            other => panic!("expected LeafRef::Episode, got {other:?}"),
        };

        // Re-sync -- same season/episode natural keys and the same
        // (source_instance_id, source_file_id) file key must resolve back
        // to the same rows, not duplicate them.
        sync.sync_work(&client, work_id, 1, instance_id)
            .await
            .unwrap();
        let second_pass = media_file_repo.list_by_work_id(work_id).await.unwrap();
        assert_eq!(
            second_pass.len(),
            1,
            "resync must not duplicate the MediaFile row"
        );
        assert_eq!(second_pass[0].id, first_pass[0].id);
        let episode_id_second = match second_pass[0].leaf_ref {
            LeafRef::Episode(id) => id,
            other => panic!("expected LeafRef::Episode, got {other:?}"),
        };
        assert_eq!(
            episode_id_second, episode_id_first,
            "resync must resolve back to the same episode row, not create a second one"
        );

        let episode_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM episodes")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(episode_count.0, 1);
    }

    /// Real Whisparr V3 instances omit `episodeNumber` from `/api/v3/episode`
    /// entirely (see `WhisparrEpisode::episode_number`'s doc comment) --
    /// this mounts a scene payload with no `episodeNumber` key at all
    /// (rather than going through `whisparr_episode_json`, which always
    /// supplies one) and proves `sync_whisparr` still succeeds using the
    /// `WhisparrEpisode::id`-based fallback, and that the fallback stays
    /// stable (so a resync updates the same episode row rather than
    /// duplicating it) since the same scene always carries the same id.
    #[tokio::test]
    async fn sync_whisparr_falls_back_to_episode_id_when_episode_number_is_absent() {
        let work_id = Uuid::new_v4();
        let pool = test_pool_with_work(work_id, "series").await;
        let sync = media_sync(pool.clone());

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v3/episode"))
            .and(query_param("seriesId", "1"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!([{
                    "id": 8117,
                    "seriesId": 1,
                    "seasonNumber": 2006,
                    "title": "Test Episode Adult",
                    "overview": "Scene synopsis",
                    "releaseDate": "2006-06-08",
                    "runtime": 41,
                    "hasFile": true,
                    "monitored": false,
                    "episodeFileId": 55
                }])),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v3/episodefile"))
            .and(query_param("seriesId", "1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                whisparr_episode_file_json(55, 2006, "Test Episode Adult.mkv"),
            ])))
            .mount(&server)
            .await;

        let client = ArrClient::Whisparr(WhisparrClient::new(server.uri(), "test-key"));
        let instance_id = Uuid::new_v4();
        sync.sync_work(&client, work_id, 1, instance_id)
            .await
            .expect("sync_work should tolerate a missing episodeNumber");

        let episode_row: (i64,) =
            sqlx::query_as("SELECT episode_number FROM episodes WHERE season_id = (SELECT id FROM seasons WHERE season_number = 2006)")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            episode_row.0, 8117,
            "falls back to the scene's own stable Whisparr id"
        );

        // Resync: the same fallback id must resolve back to the same row.
        sync.sync_work(&client, work_id, 1, instance_id)
            .await
            .unwrap();
        let episode_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM episodes")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            episode_count.0, 1,
            "resync must not duplicate the episode row"
        );
    }

    // ---- Lidarr ----

    #[tokio::test]
    async fn sync_lidarr_creates_album_and_track_and_media_file() {
        let work_id = Uuid::new_v4();
        let pool = test_pool_with_work(work_id, "artist").await;
        let sync = media_sync(pool.clone());

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/album"))
            .and(query_param("artistId", "1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {
                    "id": 100,
                    "title": "Sample Album",
                    "foreignAlbumId": "d6591261-daa1-32e1-8d0e-a60e6f97a698",
                    "artistId": 1,
                    "monitored": true,
                    "albumType": "Album",
                    "secondaryTypes": ["Live"],
                    "releaseDate": "1997-05-21T00:00:00Z",
                    "duration": 3_200_000,
                    "images": [{
                        "coverType": "cover",
                        "url": "/MediaCover/Albums/100/cover.jpg",
                        "remoteUrl": "https://images.lidarr.audio/cache/cover.jpg"
                    }]
                }
            ])))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/track"))
            .and(query_param("artistId", "1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {
                    "id": 300,
                    "artistId": 1,
                    "albumId": 100,
                    "trackFileId": 500,
                    "absoluteTrackNumber": 2,
                    "trackNumber": "1-2",
                    "title": "Sample Track One",
                    "duration": 284_000,
                    "mediumNumber": 1,
                    "hasFile": true
                }
            ])))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/trackfile"))
            .and(query_param("artistId", "1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {
                    "id": 500,
                    "artistId": 1,
                    "albumId": 100,
                    "path": "/music/Sample Band/Sample Album/01 - Sample Track One.flac",
                    "size": 34_567_890,
                    "quality": {
                        "quality": { "id": 6, "name": "FLAC" },
                        "revision": { "version": 1, "real": 0, "isRepack": false }
                    },
                    "mediaInfo": {
                        "audioCodec": "",
                        "audioBitRate": "1000 kbps",
                        "audioChannels": 2.0,
                        "audioBits": 16,
                        "audioSampleRate": "44100"
                    }
                }
            ])))
            .mount(&server)
            .await;

        let client = ArrClient::Lidarr(LidarrClient::new(server.uri(), "test-key"));
        sync.sync_work(&client, work_id, 1, Uuid::new_v4())
            .await
            .expect("sync_work should succeed");

        let media_file_repo: Arc<dyn MediaFileRepo> =
            Arc::new(SqlxMediaFileRepo::new(pool.clone()));
        let files = media_file_repo.list_by_work_id(work_id).await.unwrap();
        assert_eq!(files.len(), 1);
        assert!(matches!(files[0].leaf_ref, LeafRef::Track(_)));
        assert_eq!(files[0].codec, "FLAC");
        assert_eq!(files[0].container, "flac");
        assert_eq!(files[0].bitrate, Some(1_000_000));
        assert_eq!(files[0].duration_ms, Some(284_000));

        let album_row: (String, String, String, Option<String>) = sqlx::query_as(
            "SELECT title, images, album_type, release_date FROM albums WHERE artist_work_id = ?",
        )
        .bind(work_id.to_string())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(album_row.0, "Sample Album");
        let album_images: Vec<ImageAsset> = serde_json::from_str(&album_row.1).unwrap();
        assert_eq!(album_images.len(), 1);
        assert_eq!(album_images[0].kind, playarr_model::ImageKind::Poster);
        assert_eq!(
            album_images[0].url,
            "https://images.lidarr.audio/cache/cover.jpg"
        );
        assert_eq!(album_row.2, "live");
        assert_eq!(album_row.3.as_deref(), Some("1997-05-21"));

        let track_row: (i64, i64, String, Option<i64>) =
            sqlx::query_as("SELECT disc_number, track_number, title, duration_seconds FROM tracks")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(track_row, (1, 2, "Sample Track One".to_string(), Some(284)));
    }

    // ---- Readarr ----

    #[tokio::test]
    async fn sync_readarr_creates_book_and_media_file() {
        let work_id = Uuid::new_v4();
        let pool = test_pool_with_work(work_id, "author").await;
        let sync = media_sync(pool.clone());

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/book"))
            .and(query_param("authorId", "5"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {
                    "id": 200,
                    "title": "Sample Title",
                    "foreignBookId": "234225",
                    "authorId": 5,
                    "monitored": true
                }
            ])))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/bookfile"))
            .and(query_param("authorId", "5"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {
                    "id": 900,
                    "authorId": 5,
                    "bookId": 200,
                    "path": "/books/Sample Author/Sample Title/Sample Title.epub",
                    "size": 2_345_678,
                    "quality": {
                        "quality": { "id": 1, "name": "EPUB" },
                        "revision": { "version": 1, "real": 0, "isRepack": false }
                    }
                }
            ])))
            .mount(&server)
            .await;

        let client = ArrClient::Readarr(ReadarrClient::new(server.uri(), "test-key"));
        sync.sync_work(&client, work_id, 5, Uuid::new_v4())
            .await
            .expect("sync_work should succeed");

        let media_file_repo: Arc<dyn MediaFileRepo> =
            Arc::new(SqlxMediaFileRepo::new(pool.clone()));
        let files = media_file_repo.list_by_work_id(work_id).await.unwrap();
        assert_eq!(files.len(), 1);
        assert!(matches!(files[0].leaf_ref, LeafRef::Book(_)));
        assert_eq!(files[0].codec, "EPUB");
        assert_eq!(files[0].container, "epub");

        let book_row: (String,) =
            sqlx::query_as("SELECT title FROM books WHERE author_work_id = ?")
                .bind(work_id.to_string())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(book_row.0, "Sample Title");
    }
}
