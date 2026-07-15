//! File-level sync: once a [`streamarr_model::Work`]'s catalog identity is
//! reconciled (see [`crate::poller`]), [`MediaSync::sync_work`] fetches that
//! work's *file* data from the same source instance (Sonarr episode files,
//! Radarr's embedded movie file, Lidarr track files, Readarr book files) and
//! upserts real [`streamarr_model::MediaFile`] rows via
//! [`streamarr_db::MediaFileRepo::upsert_by_source`].
//!
//! ## Resolving a leaf id
//!
//! A `MediaFile` for a series/artist/author doesn't point at the `Work`
//! itself (see [`streamarr_model::media::LeafRef`]) — it points at a specific
//! episode/track/book. The *arr apps hand us their own numeric id for that
//! child (Sonarr's `episode.id`, Lidarr's `trackfile.albumId`, Readarr's
//! `bookfile.bookId`), not our internal `Uuid`, so it has to be resolved the
//! same way [`crate::poller`] resolves a *work's* numeric/external id to a
//! `Work::id`: find an existing row keyed by identity, or create one and
//! remember the fresh `Uuid` if none exists yet (compare
//! [`streamarr_db::WorkRepo::find_by_external_ref`] +
//! [`crate::poller::new_work`]'s insert-if-missing shape).
//!
//! The wrinkle: unlike `Work` (which has a real `work_external_refs` table
//! keyed by metadata-provider id), the `seasons`/`episodes`/`albums`/
//! `tracks`/`books` tables have no source-app id column at all — like
//! `streamarr-catalog`'s read path, they have no `streamarr-db` repository
//! yet (see this crate's `Cargo.toml` comment), so there's nowhere to store
//! one. This module resolves against each table's real natural key instead:
//!
//! - Season: `(series_work_id, season_number)` — a real `UNIQUE` index.
//! - Episode: `(season_id, episode_number)` — a real `UNIQUE` index; Sonarr's
//!   trimmed episode DTO conveniently carries both numbers directly.
//! - Album: `(artist_work_id, title)` — no `UNIQUE` index exists (Lidarr's
//!   trimmed DTO has no field this crate could add one on), so this is a
//!   best-effort natural key, not a guaranteed-unique one.
//! - Track: **no natural key is available at all.** Lidarr's trimmed
//!   `LidarrTrackFile` (see `streamarr-arr-client`) carries `album_id` but no
//!   track/disc number, title, or per-track id, and `LidarrClient` has no
//!   `list_tracks` method to fetch that detail separately. This module falls
//!   back to `(album_id, disc_number = 1, track_number = <Lidarr's own
//!   trackfile id>)` — deterministic and stable across re-syncs (so re-
//!   running sync doesn't duplicate rows), but not a faithful per-song
//!   track number. Documented here rather than silently guessed at.
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

use streamarr_arr_client::{
    ArrClientError, LidarrAlbum, LidarrClient, RadarrClient, ReadarrBook, ReadarrClient,
    SonarrClient, SonarrEpisodeFile,
};
use streamarr_db::{DbPool, MediaFileRepo};
use streamarr_model::media::LeafRef;
use streamarr_model::MediaFile;
use uuid::Uuid;

use crate::arr_client::ArrClient;

#[derive(Debug, thiserror::Error)]
pub enum MediaSyncError {
    #[error("arr client error: {0}")]
    Client(#[from] ArrClientError),
    #[error(transparent)]
    Db(#[from] streamarr_db::DbError),
    #[error(transparent)]
    Sql(#[from] sqlx::Error),
}

/// Same engine detection `streamarr_db::pool::Backend` does internally
/// (that type is private to that crate) — this module's raw SQL against
/// `seasons`/`episodes`/`albums`/`tracks`/`books` needs the same
/// per-backend placeholder split (`?` vs `$1`) every `streamarr-db` repo
/// uses, since `sqlx::Any` doesn't translate placeholder syntax itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Backend {
    Sqlite,
    Postgres,
}

impl Backend {
    fn detect(pool: &DbPool) -> Self {
        let scheme = pool
            .connect_options()
            .database_url
            .scheme()
            .to_ascii_lowercase();
        if scheme.starts_with("postgres") {
            Backend::Postgres
        } else {
            Backend::Sqlite
        }
    }
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

/// Best-effort file-stem-derived title, used only where the source *arr
/// app's trimmed DTO carries no title of its own (Lidarr's per-file/per-
/// track detail — see this module's doc comment).
fn title_from_path(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| path.to_string())
}

pub struct MediaSync {
    pool: DbPool,
    backend: Backend,
    media_file_repo: std::sync::Arc<dyn MediaFileRepo>,
}

impl MediaSync {
    pub fn new(pool: DbPool, media_file_repo: std::sync::Arc<dyn MediaFileRepo>) -> Self {
        let backend = Backend::detect(&pool);
        Self {
            pool,
            backend,
            media_file_repo,
        }
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
        match arr_client {
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
            ArrClient::Bazarr(_) | ArrClient::Prowlarr(_) => Ok(()),
        }
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
            size_bytes: file.size as u64,
            source_instance_id,
            source_file_id: Some(file.id.to_string()),
        };
        self.media_file_repo.upsert_by_source(&media_file).await?;
        Ok(())
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

            let season_id = self
                .find_or_create_season(series_work_id, episode.season_number as i32)
                .await?;
            let episode_id = self
                .find_or_upsert_episode(
                    season_id,
                    episode.episode_number as i32,
                    &episode.title,
                    episode.monitored,
                )
                .await?;

            let media_info = file.media_info.as_ref();
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
                size_bytes: file.size as u64,
                source_instance_id,
                source_file_id: Some(file.id.to_string()),
            };
            self.media_file_repo.upsert_by_source(&media_file).await?;
        }
        Ok(())
    }

    // ---- Lidarr: albums + track files, joined by album_id ----

    async fn sync_lidarr(
        &self,
        client: &LidarrClient,
        artist_work_id: Uuid,
        artist_id: i64,
        source_instance_id: Uuid,
    ) -> Result<(), MediaSyncError> {
        let albums = client.list_albums_for_artist(artist_id).await?;
        let files = client.list_track_files(artist_id).await?;
        let albums_by_id: HashMap<i64, LidarrAlbum> =
            albums.into_iter().map(|a| (a.id, a)).collect();

        for file in files {
            let Some(album) = albums_by_id.get(&file.album_id) else {
                continue;
            };
            let album_id = self
                .find_or_create_album(artist_work_id, &album.title)
                .await?;
            // See this module's doc comment: no real per-track identity is
            // available from this trimmed client, so the file's own Lidarr
            // id stands in as a deterministic "track number".
            let track_id = self
                .find_or_create_track(album_id, 1, file.id, &title_from_path(&file.path))
                .await?;

            let media_info = file.media_info.as_ref();
            let media_file = MediaFile {
                id: Uuid::new_v4(),
                work_id: artist_work_id,
                leaf_ref: LeafRef::Track(track_id),
                path: PathBuf::from(&file.path),
                container: container_from_path(&file.path),
                codec: media_info
                    .and_then(|m| m.audio_codec.clone())
                    .unwrap_or_else(|| file.quality.quality.name.clone()),
                bitrate: media_info.and_then(|m| m.audio_bitrate).map(|b| b as u64),
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
    ) -> Result<Uuid, MediaSyncError> {
        let select_sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id FROM seasons WHERE series_work_id = ? AND season_number = ?"
            }
            Backend::Postgres => {
                "SELECT id FROM seasons WHERE series_work_id = $1 AND season_number = $2"
            }
        };
        if let Some(id) = self
            .select_uuid(select_sql, series_work_id.to_string(), season_number as i64)
            .await?
        {
            return Ok(id);
        }

        let id = Uuid::new_v4();
        let insert_sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO seasons (id, series_work_id, season_number, title, overview, monitored, availability) \
                 VALUES (?, ?, ?, NULL, NULL, 1, 'unknown')"
            }
            Backend::Postgres => {
                "INSERT INTO seasons (id, series_work_id, season_number, title, overview, monitored, availability) \
                 VALUES ($1, $2, $3, NULL, NULL, 1, 'unknown')"
            }
        };
        sqlx::query(insert_sql)
            .bind(id.to_string())
            .bind(series_work_id.to_string())
            .bind(season_number as i64)
            .execute(&self.pool)
            .await?;
        Ok(id)
    }

    /// Finds the episode row for `(season_id, episode_number)`, updating its
    /// title/monitored/availability to the latest Sonarr state if it already
    /// exists, or inserting a fresh one (marked `available`, since this is
    /// only ever called for an episode a file was just matched against) if
    /// not.
    async fn find_or_upsert_episode(
        &self,
        season_id: Uuid,
        episode_number: i32,
        title: &str,
        monitored: bool,
    ) -> Result<Uuid, MediaSyncError> {
        let select_sql = match self.backend {
            Backend::Sqlite => "SELECT id FROM episodes WHERE season_id = ? AND episode_number = ?",
            Backend::Postgres => {
                "SELECT id FROM episodes WHERE season_id = $1 AND episode_number = $2"
            }
        };
        if let Some(id) = self
            .select_uuid(select_sql, season_id.to_string(), episode_number as i64)
            .await?
        {
            let update_sql = match self.backend {
                Backend::Sqlite => {
                    "UPDATE episodes SET title = ?, monitored = ?, availability = 'available' WHERE id = ?"
                }
                Backend::Postgres => {
                    "UPDATE episodes SET title = $1, monitored = $2, availability = 'available' WHERE id = $3"
                }
            };
            sqlx::query(update_sql)
                .bind(title)
                .bind(monitored as i64)
                .bind(id.to_string())
                .execute(&self.pool)
                .await?;
            return Ok(id);
        }

        let id = Uuid::new_v4();
        let insert_sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO episodes (id, season_id, episode_number, title, overview, air_date, runtime_minutes, monitored, availability) \
                 VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, 'available')"
            }
            Backend::Postgres => {
                "INSERT INTO episodes (id, season_id, episode_number, title, overview, air_date, runtime_minutes, monitored, availability) \
                 VALUES ($1, $2, $3, $4, NULL, NULL, NULL, $5, 'available')"
            }
        };
        sqlx::query(insert_sql)
            .bind(id.to_string())
            .bind(season_id.to_string())
            .bind(episode_number as i64)
            .bind(title)
            .bind(monitored as i64)
            .execute(&self.pool)
            .await?;
        Ok(id)
    }

    async fn find_or_create_album(
        &self,
        artist_work_id: Uuid,
        title: &str,
    ) -> Result<Uuid, MediaSyncError> {
        let select_sql = match self.backend {
            Backend::Sqlite => "SELECT id FROM albums WHERE artist_work_id = ? AND title = ?",
            Backend::Postgres => "SELECT id FROM albums WHERE artist_work_id = $1 AND title = $2",
        };
        if let Some(id) = self
            .select_uuid_str(select_sql, artist_work_id.to_string(), title)
            .await?
        {
            return Ok(id);
        }

        let id = Uuid::new_v4();
        let insert_sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO albums (id, artist_work_id, title, album_type, release_date, monitored, availability) \
                 VALUES (?, ?, ?, 'studio', NULL, 1, 'available')"
            }
            Backend::Postgres => {
                "INSERT INTO albums (id, artist_work_id, title, album_type, release_date, monitored, availability) \
                 VALUES ($1, $2, $3, 'studio', NULL, 1, 'available')"
            }
        };
        sqlx::query(insert_sql)
            .bind(id.to_string())
            .bind(artist_work_id.to_string())
            .bind(title)
            .execute(&self.pool)
            .await?;
        Ok(id)
    }

    async fn find_or_create_track(
        &self,
        album_id: Uuid,
        disc_number: i64,
        track_number: i64,
        title: &str,
    ) -> Result<Uuid, MediaSyncError> {
        let select_sql = match self.backend {
            Backend::Sqlite => {
                "SELECT id FROM tracks WHERE album_id = ? AND disc_number = ? AND track_number = ?"
            }
            Backend::Postgres => {
                "SELECT id FROM tracks WHERE album_id = $1 AND disc_number = $2 AND track_number = $3"
            }
        };
        let row = sqlx::query(select_sql)
            .bind(album_id.to_string())
            .bind(disc_number)
            .bind(track_number)
            .fetch_optional(&self.pool)
            .await?;
        if let Some(row) = row {
            return uuid_from_row(&row);
        }

        let id = Uuid::new_v4();
        let insert_sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO tracks (id, album_id, disc_number, track_number, title, duration_seconds, availability) \
                 VALUES (?, ?, ?, ?, ?, NULL, 'available')"
            }
            Backend::Postgres => {
                "INSERT INTO tracks (id, album_id, disc_number, track_number, title, duration_seconds, availability) \
                 VALUES ($1, $2, $3, $4, $5, NULL, 'available')"
            }
        };
        sqlx::query(insert_sql)
            .bind(id.to_string())
            .bind(album_id.to_string())
            .bind(disc_number)
            .bind(track_number)
            .bind(title)
            .execute(&self.pool)
            .await?;
        Ok(id)
    }

    async fn find_or_create_book(
        &self,
        author_work_id: Uuid,
        title: &str,
    ) -> Result<Uuid, MediaSyncError> {
        let select_sql = match self.backend {
            Backend::Sqlite => "SELECT id FROM books WHERE author_work_id = ? AND title = ?",
            Backend::Postgres => "SELECT id FROM books WHERE author_work_id = $1 AND title = $2",
        };
        if let Some(id) = self
            .select_uuid_str(select_sql, author_work_id.to_string(), title)
            .await?
        {
            return Ok(id);
        }

        let id = Uuid::new_v4();
        let insert_sql = match self.backend {
            Backend::Sqlite => {
                "INSERT INTO books (id, author_work_id, title, isbn, release_date, series_name, series_position, monitored, availability) \
                 VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 1, 'available')"
            }
            Backend::Postgres => {
                "INSERT INTO books (id, author_work_id, title, isbn, release_date, series_name, series_position, monitored, availability) \
                 VALUES ($1, $2, $3, NULL, NULL, NULL, NULL, 1, 'available')"
            }
        };
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

    use streamarr_db::repo::SqlxMediaFileRepo;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    /// Opens a fresh, migrated, in-memory SQLite `DbPool` and inserts a
    /// parent `works` row -- same pattern `streamarr-catalog`'s and
    /// `streamarr-api`'s test harnesses use, and the same reason
    /// (`media_files.work_id`/`seasons.series_work_id`/etc all carry a real
    /// `REFERENCES works (id)` foreign key).
    async fn test_pool_with_work(work_id: Uuid, kind: &str) -> DbPool {
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let url = format!("sqlite://streamarr_arr_sync_media_test_{n}?mode=memory&cache=shared");

        sqlx::any::install_default_drivers();
        let pool: DbPool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .expect("open in-memory sqlite pool");
        streamarr_db::run_migrations(&pool, false)
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
                "sortTitle": "sampleseven",
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
                "runTime": "42:00"
            }
        })
    }

    async fn mount_sonarr(server: &MockServer, series_id: i64) {
        Mock::given(method("GET"))
            .and(path("/api/v3/episode"))
            .and(query_param("seriesId", series_id.to_string()))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                sonarr_episode_json(10, 1, 1, "Pilot", 55),
                sonarr_episode_json(11, 1, 2, "Test Episode Three", 0),
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

        let seasons: Vec<(String, i64)> = sqlx::query_as("SELECT id, season_number FROM seasons")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(seasons.len(), 1);
        assert_eq!(seasons[0].1, 1);

        let episode_row: (String, i64, String) =
            sqlx::query_as("SELECT id, episode_number, title FROM episodes WHERE id = ?")
                .bind(episode_id.to_string())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(episode_row.1, 1);
        assert_eq!(episode_row.2, "Pilot");
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
                    "monitored": true
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
                        "audioCodec": "FLAC",
                        "audioBitrate": 1000,
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

        let album_row: (String,) =
            sqlx::query_as("SELECT title FROM albums WHERE artist_work_id = ?")
                .bind(work_id.to_string())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(album_row.0, "Sample Album");
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
