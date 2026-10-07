//! Bridges `playarr-arr-client`'s per-app clients (each with its own DTO
//! shape and inherent methods — there is no shared "list everything" trait,
//! see that crate's docs) into one dispatchable [`ArrClient`] enum, and
//! normalizes each app's DTO into a [`RemoteWork`] the reconciliation poller
//! can diff against `playarr_model::Work` without knowing which *arr app
//! it came from.

use chrono::{DateTime, Utc};
use playarr_arr_client::{
    ArrClientError, ArrRootFolder, BazarrClient, DubarrClient, LidarrAlbum, LidarrArtist,
    LidarrClient, LidarrImage, ProwlarrClient, RadarrClient, RadarrImage, RadarrMovie,
    ReadarrAuthor, ReadarrClient, SonarrClient, SonarrImage, SonarrSeries, WhisparrClient,
    WhisparrImage, WhisparrSeries,
};
use playarr_model::{
    Availability, ExternalProvider, ImageAsset, ImageKind, SourceInstance, SourceKind, WorkKind,
};
use uuid::Uuid;

/// Converts one *arr `images[]` entry to an [`ImageAsset`], or `None` when
/// it should be dropped. Two things can drop an entry: no `remote_url` at
/// all (the only URL available is the source app's own local, API-key-
/// gated path -- forwarding that to a Playarr Server client would leak this
/// *arr instance's credential, see e.g. `SonarrImage::remote_url`'s doc
/// comment), or a `cover_type` this app doesn't have a matching
/// `ImageKind` for (unrecognized/future *arr cover types fail closed by
/// being skipped, not by guessing).
fn image_asset(cover_type: &str, remote_url: Option<&str>) -> Option<ImageAsset> {
    let url = remote_url?;
    let parsed = reqwest::Url::parse(url).ok()?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return None;
    }
    let kind = match cover_type {
        "poster" | "cover" => ImageKind::Poster,
        "fanart" => ImageKind::Backdrop,
        "banner" => ImageKind::Banner,
        "clearlogo" | "logo" => ImageKind::Logo,
        "screenshot" => ImageKind::Thumb,
        _ => return None,
    };
    Some(ImageAsset {
        kind,
        url: url.to_string(),
        // *arr's `images[]` entries carry no width/height metadata.
        width: None,
        height: None,
    })
}

fn lidarr_image_asset(image: &LidarrImage, source_instance_id: Uuid) -> Option<ImageAsset> {
    image_asset(&image.cover_type, image.remote_url.as_deref()).or_else(|| {
        let kind = match image.cover_type.as_str() {
            "poster" | "cover" => ImageKind::Poster,
            "fanart" => ImageKind::Backdrop,
            "banner" => ImageKind::Banner,
            "clearlogo" | "logo" => ImageKind::Logo,
            _ => return None,
        };
        let url = playarr_artwork::arr_artwork_locator(source_instance_id, &image.url)?;
        Some(ImageAsset {
            kind,
            url,
            width: None,
            height: None,
        })
    })
}

pub(crate) fn sonarr_images(images: &[SonarrImage]) -> Vec<ImageAsset> {
    images
        .iter()
        .filter_map(|img| image_asset(&img.cover_type, img.remote_url.as_deref()))
        .collect()
}

fn radarr_images(images: &[RadarrImage]) -> Vec<ImageAsset> {
    images
        .iter()
        .filter_map(|img| image_asset(&img.cover_type, img.remote_url.as_deref()))
        .collect()
}

fn lidarr_images(images: &[LidarrImage], source_instance_id: Uuid) -> Vec<ImageAsset> {
    images
        .iter()
        .filter_map(|image| lidarr_image_asset(image, source_instance_id))
        .collect()
}

pub(crate) fn lidarr_album_images(
    album: &LidarrAlbum,
    source_instance_id: Uuid,
) -> Vec<ImageAsset> {
    lidarr_images(&album.images, source_instance_id)
}

pub(crate) fn whisparr_images(images: &[WhisparrImage]) -> Vec<ImageAsset> {
    images
        .iter()
        .filter_map(|img| image_asset(&img.cover_type, img.remote_url.as_deref()))
        .collect()
}

/// A source-kind-normalized view of one remote entity, carrying only the
/// fields arr-sync actually derives from an *arr app's trimmed DTO. Deriving
/// `PartialEq` isn't useful here (call sites compare the `Work` each of
/// these gets merged/mapped into instead).
#[derive(Debug, Clone)]
pub struct RemoteWork {
    /// The metadata-provider id (tvdb/tmdb/MusicBrainz/Goodreads —
    /// whichever [`work_kind_and_provider`] says this source kind uses) used
    /// to match this remote entity against an existing `Work`. Distinct from
    /// the source app's own internal numeric id (that one only ever appears
    /// transiently, in a webhook payload or as the argument to a `get_*`
    /// call) — `Work::external_refs` is keyed by metadata provider, not by
    /// *arr instance, so that's what has to survive here.
    pub external_id: String,
    /// The source app's own internal numeric id for this entity (Sonarr
    /// `seriesId` / Radarr `movieId` / Lidarr `artistId` / Readarr
    /// `authorId`). Unlike `external_id`, this one *is* kept around (rather
    /// than only appearing transiently in a webhook payload/`get_*` call
    /// argument): `crate::media_sync::MediaSync` needs it to call the
    /// per-app file-listing endpoints (`list_episodes`/`list_episode_files`/
    /// `list_albums_for_artist`/`list_track_files`/`list_books_for_author`/
    /// `list_book_files`), which are keyed by the app's own id, not our
    /// internal `Work::id` or the metadata-provider `external_id`.
    pub source_id: i64,
    pub title: String,
    pub sort_title: String,
    pub monitored: bool,
    /// `None` when this source kind's trimmed DTO doesn't carry enough
    /// information to derive availability (e.g. Sonarr's series-level
    /// payload has no file-count summary) — callers must leave the existing
    /// `Work::availability` untouched rather than downgrading it to
    /// `Unknown` on every sync pass.
    pub availability: Option<Availability>,
    /// How many files the source says it holds for this entity, when its
    /// list payload says (Sonarr `statistics.episodeFileCount`). Series carry
    /// no availability, so this is the only list-level signal that an episode
    /// was imported into a series Playarr already knows.
    pub file_count: Option<u32>,
    /// Metadata *arr apps themselves carry (they're TMDb/TVDB/MusicBrainz-
    /// backed) — arr-sync owns these `Work` fields outright now (see
    /// `poller::new_work`/`merge_work`), unlike `tags`, which stays
    /// user/automation-owned and is never touched here.
    pub overview: Option<String>,
    pub genres: Vec<String>,
    pub images: Vec<ImageAsset>,
    /// The source *arr app's own release-date signal, mapped onto
    /// `Work::release_date` by `poller::new_work`/`merge_work`. `None` for
    /// source kinds whose trimmed DTO carries no such signal (Lidarr/
    /// Readarr -- see `map_lidarr`/`map_readarr`) or a Movie/Series entry
    /// the source app itself hasn't backfilled one for yet.
    pub release_date: Option<DateTime<Utc>>,
    /// When the source *arr app itself added this entry (Radarr movie
    /// `added`, Sonarr/Whisparr series `added`, Lidarr artist `added`),
    /// already vetted by [`usable_added`]. Seeds `Work::added_at` so "Recently
    /// added" reflects the real library history rather than first-sync time.
    /// `None` when absent or implausible; callers fall back to now.
    pub added: Option<DateTime<Utc>>,
    /// The arr app's content rating, normalised by [`normalise_certification`].
    /// `None` = unrated. Stored on the `Work` as an arr-owned
    /// `rating:<value>` tag (see `playarr_auth::household`).
    pub certification: Option<String>,
    /// Other arr-owned tags derived from the source app (`collection:` and
    /// `score:`, see `playarr_model::home_rail`), replaced wholesale on every
    /// sync pass. Empty for sources that report none.
    pub arr_tags: Vec<String>,
}

/// An *arr `added` timestamp, or `None` when it is unusable: *arr apps send
/// the .NET default (`0001-01-01`) for "unset", and a clock-skewed or
/// corrupt value in the future must not pin a title to the top of the rails.
/// Anything before 2000 or more than a day ahead counts as absent.
pub fn usable_added(raw: Option<DateTime<Utc>>) -> Option<DateTime<Utc>> {
    use chrono::{Duration, TimeZone};
    let floor = Utc.with_ymd_and_hms(2000, 1, 1, 0, 0, 0).single()?;
    raw.filter(|at| *at >= floor && *at <= Utc::now() + Duration::days(1))
}

/// Trims/uppercases a certification and drops the "not rated" spellings so
/// that unrated stays unrated rather than becoming a bogus rating tag.
pub fn normalise_certification(raw: Option<&str>) -> Option<String> {
    let value = raw?.trim().to_ascii_uppercase();
    match value.as_str() {
        "" | "NR" | "UR" | "UNRATED" | "NOT RATED" | "N/A" | "NA" => None,
        _ => Some(value),
    }
}

/// `score:` tag from Sonarr's series rating.
fn sonarr_arr_tags(series: &SonarrSeries) -> Vec<String> {
    series
        .ratings
        .as_ref()
        .and_then(|r| playarr_model::home_rail::score_tag(r.value, r.votes))
        .into_iter()
        .collect()
}

/// `collection:` and `score:` tags from Radarr's collection and ratings
/// (the best-voted of TMDb/IMDb, so a barely-rated title does not outrank a
/// well-rated one on one source's few votes).
fn radarr_arr_tags(movie: &RadarrMovie) -> Vec<String> {
    use playarr_model::home_rail::{collection_tag, score_tag};
    let mut tags = Vec::new();
    if let Some(collection) = movie
        .collection
        .as_ref()
        .filter(|c| c.tmdb_id.unwrap_or(0) > 0 && !c.title.trim().is_empty())
    {
        tags.push(collection_tag(
            collection.tmdb_id.unwrap_or(0),
            &collection.title,
        ));
    }
    if let Some(best) = movie.ratings.as_ref().and_then(|r| {
        [r.tmdb.as_ref(), r.imdb.as_ref()]
            .into_iter()
            .flatten()
            .filter(|s| s.value > 0.0)
            .max_by_key(|s| s.votes)
    }) {
        tags.extend(score_tag(best.value, best.votes));
    }
    tags
}

fn map_sonarr(series: &SonarrSeries) -> RemoteWork {
    RemoteWork {
        file_count: series.statistics.as_ref().map(|s| s.episode_file_count),
        external_id: series.tvdb_id.to_string(),
        source_id: series.id,
        title: series.title.clone(),
        sort_title: series.sort_title.clone(),
        monitored: series.monitored,
        // Series-level Sonarr payloads don't carry an episode-file-count
        // summary in our trimmed DTO; per-episode availability is out of
        // scope for this pass (episodes are a separate child aggregate —
        // see `playarr_model::series`), so we deliberately don't guess.
        availability: None,
        overview: series.overview.clone(),
        genres: series.genres.clone(),
        images: sonarr_images(&series.images),
        release_date: series.first_aired,
        added: usable_added(series.added),
        certification: normalise_certification(series.certification.as_deref()),
        arr_tags: sonarr_arr_tags(series),
    }
}

fn map_radarr(movie: &RadarrMovie) -> RemoteWork {
    RemoteWork {
        file_count: None,
        external_id: movie.tmdb_id.to_string(),
        source_id: movie.id,
        title: movie.title.clone(),
        sort_title: movie.sort_title.clone(),
        monitored: movie.monitored,
        availability: Some(if movie.has_file {
            Availability::Available
        } else if movie.monitored {
            Availability::Pending
        } else {
            Availability::Unknown
        }),
        overview: movie.overview.clone(),
        genres: movie.genres.clone(),
        images: radarr_images(&movie.images),
        release_date: radarr_release_date(movie),
        added: usable_added(movie.added),
        certification: normalise_certification(movie.certification.as_deref()),
        arr_tags: radarr_arr_tags(movie),
    }
}

/// Original release date of a Radarr movie. Prefers the theatrical date
/// (`inCinemas`), then the film's `year`; the digital/physical dates are
/// home-media re-release dates (Sample Movie Four, 1994, has a 2005 DVD) and are only
/// used when nothing better exists. When only the year is known, an
/// earliest home-media date inside that same year refines it to a real day.
fn radarr_release_date(movie: &RadarrMovie) -> Option<DateTime<Utc>> {
    use chrono::{Datelike, TimeZone};
    if let Some(cinemas) = movie.in_cinemas {
        return Some(cinemas);
    }
    let home_media = match (movie.digital_release, movie.physical_release) {
        (Some(d), Some(p)) => Some(d.min(p)),
        (d, p) => d.or(p),
    };
    match movie.year.filter(|year| *year > 0) {
        Some(year) => home_media
            .filter(|date| date.year() == year)
            .or_else(|| Utc.with_ymd_and_hms(year, 1, 1, 0, 0, 0).single()),
        None => home_media,
    }
}

fn map_lidarr(artist: &LidarrArtist, source_instance_id: Uuid) -> RemoteWork {
    RemoteWork {
        file_count: None,
        certification: None,
        arr_tags: Vec::new(),
        external_id: artist.foreign_artist_id.clone(),
        source_id: artist.id,
        title: artist.artist_name.clone(),
        sort_title: artist
            .sort_name
            .clone()
            .unwrap_or_else(|| artist.artist_name.clone()),
        monitored: artist.monitored,
        availability: artist.statistics.as_ref().map(|statistics| {
            if statistics.track_file_count > 0 {
                Availability::Available
            } else if artist.monitored {
                Availability::Pending
            } else {
                Availability::Unknown
            }
        }),
        overview: artist.overview.clone(),
        genres: artist.genres.clone(),
        images: lidarr_images(&artist.images, source_instance_id),
        // An artist (unlike a single album) has no one release date of its
        // own -- see `Work::release_date`'s doc comment.
        release_date: None,
        added: usable_added(artist.added),
    }
}

fn map_lidarr_with_album_fallback(
    artist: &LidarrArtist,
    albums: &[LidarrAlbum],
    source_instance_id: Uuid,
) -> RemoteWork {
    let mut remote = map_lidarr(artist, source_instance_id);
    if !remote
        .images
        .iter()
        .any(|image| image.kind == ImageKind::Poster)
    {
        remote.images.extend(
            albums
                .iter()
                .filter(|album| album.artist_id == artist.id)
                .flat_map(|album| lidarr_album_images(album, source_instance_id))
                .find(|image| image.kind == ImageKind::Poster),
        );
    }
    remote
}

fn map_readarr(author: &ReadarrAuthor) -> RemoteWork {
    RemoteWork {
        file_count: None,
        certification: None,
        arr_tags: Vec::new(),
        external_id: author.foreign_author_id.clone(),
        source_id: author.id,
        title: author.author_name.clone(),
        sort_title: author.author_name.clone(),
        monitored: author.monitored,
        availability: None,
        // Readarr's trimmed DTO (`ReadarrAuthor`) hasn't grown overview/
        // genres/images fields -- Readarr is archived upstream (see the
        // crate-level docs) and best-effort here, so extending it wasn't
        // part of this pass's scope (Sonarr/Radarr/Lidarr only).
        overview: None,
        genres: Vec::new(),
        images: Vec::new(),
        // An author, like an artist, has no one release date of its own.
        release_date: None,
        added: usable_added(author.added),
    }
}

fn map_whisparr(series: &WhisparrSeries) -> RemoteWork {
    RemoteWork {
        file_count: None,
        certification: None,
        arr_tags: Vec::new(),
        external_id: series.tpdb_id.to_string(),
        source_id: series.id,
        title: series.title.clone(),
        sort_title: series.sort_title.clone(),
        monitored: series.monitored,
        // Series-level Whisparr payloads don't carry an episode-file-count
        // summary in our trimmed DTO, same as Sonarr's -- per-scene
        // availability is a separate child aggregate concern, so this
        // deliberately doesn't guess (see `map_sonarr`'s matching comment).
        availability: None,
        overview: series.overview.clone(),
        genres: series.genres.clone(),
        images: whisparr_images(&series.images),
        release_date: series.first_aired,
        added: usable_added(series.added),
    }
}

/// Which `WorkKind` a source kind's entities map onto, and which
/// `ExternalProvider` its remote ids should be matched against in
/// `Work::external_refs`. `None` for source kinds that don't own `Work`
/// entities of their own:
///
/// - Bazarr augments subtitle-completeness state on series Sonarr already
///   owns; it has no independent catalog surface, and `BazarrSeries` has no
///   metadata-provider id to key a `Work` lookup on at all.
/// - Prowlarr manages search indexers, not media — its webhook/poll surface
///   (`ProwlarrIndexer`) has nothing to do with the `Work` aggregate.
///
/// Whisparr deliberately returns `(WorkKind::Site, ExternalProvider::Tpdb)`
/// rather than reusing Sonarr's `(WorkKind::Series, ExternalProvider::Tvdb)`
/// pair: the reconciliation
/// poller's per-`(WorkKind, ExternalProvider)` diffing (see
/// `crate::poller::diff_works`) treats every source instance sharing one
/// bucket as jointly authoritative over it, so a source instance's
/// reconciliation pass will delete any `Work` in its bucket that its own
/// listing didn't return. If Whisparr shared Sonarr's `Tvdb` bucket, a
/// Whisparr instance's pass would see every Sonarr-sourced series as
/// "missing" (Whisparr's own listing never returns them) and delete them,
/// and vice versa. This is the same documented gap that already exists for
/// two same-kind instances (e.g. two independent Sonarr instances) -- giving
/// Whisparr its own provider avoids adding a *second*, needless instance of
/// it, not fixing the underlying gap itself.
///
/// TODO: once `WorkRepo` (or a sibling repo) grows a write path for
/// subtitle-completeness state, Bazarr reconciliation should target that
/// instead of `Work` directly — it's deliberately not shoehorned in here.
pub fn work_kind_and_provider(source_kind: SourceKind) -> Option<(WorkKind, ExternalProvider)> {
    match source_kind {
        SourceKind::Sonarr => Some((WorkKind::Series, ExternalProvider::Tvdb)),
        SourceKind::Radarr => Some((WorkKind::Movie, ExternalProvider::Tmdb)),
        SourceKind::Lidarr => Some((WorkKind::Artist, ExternalProvider::MusicBrainzArtist)),
        SourceKind::Readarr => Some((WorkKind::Author, ExternalProvider::Goodreads)),
        SourceKind::Whisparr => Some((WorkKind::Site, ExternalProvider::Tpdb)),
        SourceKind::Bazarr | SourceKind::Prowlarr | SourceKind::Dubarr => None,
    }
}

/// One configured *arr connection, dispatchable without the caller needing
/// to match on `SourceKind` itself every time it wants to list or fetch.
pub enum ArrClient {
    Sonarr(SonarrClient),
    Radarr(RadarrClient),
    Lidarr(LidarrClient),
    Readarr(ReadarrClient),
    Bazarr(BazarrClient),
    Prowlarr(ProwlarrClient),
    Whisparr(WhisparrClient),
    Dubarr(DubarrClient),
}

impl ArrClient {
    /// Builds the concrete client matching `instance.kind`, pointed at its
    /// configured base URL and API key. `api_key_encrypted` is treated as
    /// already-decrypted plaintext here — decrypting it from storage happens
    /// before a `SourceInstance` is constructed (see that type's docs); this
    /// crate has no encryption dependency of its own.
    pub fn from_source_instance(instance: &SourceInstance) -> Self {
        let base_url = instance.base_url.clone();
        let api_key = instance.api_key_encrypted.expose_secret().clone();
        match instance.kind {
            SourceKind::Sonarr => ArrClient::Sonarr(SonarrClient::new(base_url, api_key)),
            SourceKind::Radarr => ArrClient::Radarr(RadarrClient::new(base_url, api_key)),
            SourceKind::Lidarr => ArrClient::Lidarr(LidarrClient::new(base_url, api_key)),
            SourceKind::Readarr => ArrClient::Readarr(ReadarrClient::new(base_url, api_key)),
            SourceKind::Bazarr => ArrClient::Bazarr(BazarrClient::new(base_url, api_key)),
            SourceKind::Prowlarr => ArrClient::Prowlarr(ProwlarrClient::new(base_url, api_key)),
            SourceKind::Whisparr => ArrClient::Whisparr(WhisparrClient::new(base_url, api_key)),
            SourceKind::Dubarr => ArrClient::Dubarr(DubarrClient::new(base_url, api_key)),
        }
    }

    /// Every root folder configured in a media-owning source app. Empty for
    /// apps that own no media library (Bazarr, Prowlarr, Dubarr).
    pub async fn list_root_folders(&self) -> Result<Vec<ArrRootFolder>, ArrClientError> {
        match self {
            ArrClient::Sonarr(client) => client.list_root_folders().await,
            ArrClient::Radarr(client) => client.list_root_folders().await,
            ArrClient::Lidarr(client) => client.list_root_folders().await,
            ArrClient::Readarr(client) => client.list_root_folders().await,
            ArrClient::Whisparr(client) => client.list_root_folders().await,
            ArrClient::Bazarr(_) | ArrClient::Prowlarr(_) | ArrClient::Dubarr(_) => Ok(Vec::new()),
        }
    }

    /// The full remote list, normalized to [`RemoteWork`]. Empty (not an
    /// error) for source kinds `work_kind_and_provider` returns `None` for —
    /// there's nothing to list onto the `Work` aggregate for those.
    pub async fn list_all(
        &self,
        source_instance_id: Uuid,
    ) -> Result<Vec<RemoteWork>, ArrClientError> {
        match self {
            ArrClient::Sonarr(client) => {
                Ok(client.list_series().await?.iter().map(map_sonarr).collect())
            }
            ArrClient::Radarr(client) => {
                Ok(client.list_movies().await?.iter().map(map_radarr).collect())
            }
            ArrClient::Lidarr(client) => {
                let (artists, albums) =
                    tokio::try_join!(client.list_artists(), client.list_albums())?;
                Ok(artists
                    .iter()
                    .map(|artist| {
                        map_lidarr_with_album_fallback(artist, &albums, source_instance_id)
                    })
                    .collect())
            }
            ArrClient::Readarr(client) => Ok(client
                .list_authors()
                .await?
                .iter()
                .map(map_readarr)
                .collect()),
            ArrClient::Whisparr(client) => Ok(client
                .list_series()
                .await?
                .iter()
                .map(map_whisparr)
                .collect()),
            ArrClient::Bazarr(_) | ArrClient::Prowlarr(_) | ArrClient::Dubarr(_) => Ok(Vec::new()),
        }
    }

    /// A single remote entity by the source app's own id, normalized to
    /// [`RemoteWork`]. `Ok(None)` (not an error) for source kinds with no
    /// `Work`-owning catalog surface.
    pub async fn get_one(
        &self,
        id: i64,
        source_instance_id: Uuid,
    ) -> Result<Option<RemoteWork>, ArrClientError> {
        match self {
            ArrClient::Sonarr(client) => Ok(Some(map_sonarr(&client.get_series(id).await?))),
            ArrClient::Radarr(client) => Ok(Some(map_radarr(&client.get_movie(id).await?))),
            ArrClient::Lidarr(client) => {
                let (artist, albums) =
                    tokio::try_join!(client.get_artist(id), client.list_albums_for_artist(id))?;
                Ok(Some(map_lidarr_with_album_fallback(
                    &artist,
                    &albums,
                    source_instance_id,
                )))
            }
            ArrClient::Readarr(client) => Ok(Some(map_readarr(&client.get_author(id).await?))),
            ArrClient::Whisparr(client) => Ok(Some(map_whisparr(&client.get_series(id).await?))),
            ArrClient::Bazarr(_) | ArrClient::Prowlarr(_) | ArrClient::Dubarr(_) => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use playarr_arr_client::LidarrArtistStatistics;

    #[test]
    fn certification_is_normalised_and_unrated_spellings_drop() {
        assert_eq!(
            normalise_certification(Some(" pg-13 ")),
            Some("PG-13".into())
        );
        assert_eq!(normalise_certification(Some("TV-MA")), Some("TV-MA".into()));
        for unrated in ["", "  ", "NR", "Not Rated", "unrated", "N/A"] {
            assert_eq!(normalise_certification(Some(unrated)), None, "{unrated:?}");
        }
        assert_eq!(normalise_certification(None), None);
    }

    #[test]
    fn radarr_collection_and_best_voted_score_become_arr_tags() {
        use playarr_arr_client::{RadarrCollection, RadarrRatingSource, RadarrRatings};
        let mut movie = radarr_movie(1, "Sample Hero", 1726, true, true);
        movie.collection = Some(RadarrCollection {
            title: "Sample Hero Collection".into(),
            tmdb_id: Some(131292),
        });
        movie.ratings = Some(RadarrRatings {
            tmdb: Some(RadarrRatingSource {
                value: 7.6,
                votes: 25000,
            }),
            imdb: Some(RadarrRatingSource {
                value: 7.9,
                votes: 1000,
            }),
        });
        assert_eq!(
            map_radarr(&movie).arr_tags,
            vec![
                "collection:131292:Sample Hero Collection",
                "score:7.6:25000"
            ]
        );
        assert!(map_radarr(&radarr_movie(2, "Solo", 2, true, true))
            .arr_tags
            .is_empty());
    }

    #[test]
    fn sonarr_rating_becomes_a_score_tag() {
        let mut series = sonarr_series(1, "Show", 10, true);
        series.ratings = Some(playarr_arr_client::SonarrRatings {
            value: 8.44,
            votes: 900,
        });
        assert_eq!(map_sonarr(&series).arr_tags, vec!["score:8.4:900"]);
    }

    fn sonarr_series(id: i64, title: &str, tvdb_id: i64, monitored: bool) -> SonarrSeries {
        SonarrSeries {
            id,
            title: title.to_string(),
            sort_title: title.to_lowercase(),
            tvdb_id,
            monitored,
            status: "continuing".to_string(),
            path: format!("/tv/{title}"),
            overview: None,
            genres: Vec::new(),
            images: Vec::new(),
            first_aired: None,
            added: None,
            certification: None,
            ratings: None,
            statistics: None,
        }
    }

    fn whisparr_series(id: i64, title: &str, tpdb_id: i64, monitored: bool) -> WhisparrSeries {
        WhisparrSeries {
            id,
            title: title.to_string(),
            sort_title: title.to_lowercase(),
            tpdb_id,
            monitored,
            status: "continuing".to_string(),
            path: format!("/scenes/{title}"),
            overview: None,
            genres: Vec::new(),
            images: Vec::new(),
            first_aired: None,
            added: None,
        }
    }

    fn radarr_movie(
        id: i64,
        title: &str,
        tmdb_id: i64,
        monitored: bool,
        has_file: bool,
    ) -> RadarrMovie {
        RadarrMovie {
            id,
            title: title.to_string(),
            sort_title: title.to_lowercase(),
            tmdb_id,
            monitored,
            has_file,
            path: format!("/movies/{title}"),
            runtime: None,
            movie_file: None,
            overview: None,
            genres: Vec::new(),
            images: Vec::new(),
            digital_release: None,
            physical_release: None,
            in_cinemas: None,
            year: None,
            certification: None,
            collection: None,
            ratings: None,
            added: None,
        }
    }

    fn lidarr_artist(track_file_count: i64) -> LidarrArtist {
        LidarrArtist {
            id: 7,
            artist_name: "Sample Band".to_string(),
            sort_name: Some("Sample Band".to_string()),
            foreign_artist_id: "a74b1b7f-71a5-4011-9441-d0b5e4122711".to_string(),
            monitored: true,
            path: "/music/Sample Band".to_string(),
            overview: None,
            genres: Vec::new(),
            images: Vec::new(),
            added: None,
            statistics: Some(LidarrArtistStatistics {
                album_count: 9,
                track_file_count,
                track_count: 112,
                total_track_count: 112,
            }),
        }
    }

    #[test]
    fn sonarr_maps_tvdb_id_as_external_id_and_leaves_availability_unknown() {
        let series = sonarr_series(42, "Example Show", 12345, true);
        let remote = map_sonarr(&series);
        assert_eq!(remote.external_id, "12345");
        assert_eq!(remote.title, "Example Show");
        assert!(remote.monitored);
        assert_eq!(remote.availability, None);
    }

    #[test]
    fn lidarr_maps_sort_name_and_file_availability() {
        let source_instance_id = Uuid::new_v4();
        let remote = map_lidarr(&lidarr_artist(112), source_instance_id);
        assert_eq!(remote.sort_title, "Sample Band");
        assert_eq!(remote.availability, Some(Availability::Available));

        let remote = map_lidarr(&lidarr_artist(0), source_instance_id);
        assert_eq!(remote.availability, Some(Availability::Pending));
    }

    #[test]
    fn lidarr_keeps_authenticated_local_artist_artwork() {
        let source_instance_id = Uuid::new_v4();
        let mut artist = lidarr_artist(112);
        artist.images = vec![LidarrImage {
            cover_type: "poster".to_string(),
            url: "/MediaCover/7/poster.jpg".to_string(),
            remote_url: Some("/var/lib/lidarr/MediaCover/7/poster.jpg".to_string()),
        }];
        let album = LidarrAlbum {
            id: 100,
            title: Some("Sample Album".to_string()),
            foreign_album_id: Some("d6591261-daa1-32e1-8d0e-a60e6f97a698".to_string()),
            artist_id: artist.id,
            monitored: true,
            album_type: Some("Album".to_string()),
            secondary_types: Vec::new(),
            release_date: Some("1997-05-21T00:00:00Z".to_string()),
            duration: Some(3_200_000),
            images: vec![LidarrImage {
                cover_type: "cover".to_string(),
                url: "/MediaCover/Albums/100/cover.jpg".to_string(),
                remote_url: Some("https://images.lidarr.audio/cache/cover.jpg".to_string()),
            }],
        };

        let remote = map_lidarr_with_album_fallback(&artist, &[album], source_instance_id);

        assert_eq!(remote.images.len(), 1);
        assert_eq!(remote.images[0].kind, ImageKind::Poster);
        assert_eq!(
            remote.images[0].url,
            format!("playarr-arr://{source_instance_id}/MediaCover/7/poster.jpg")
        );
    }

    #[test]
    fn sonarr_maps_overview_genres_and_remote_hosted_images() {
        let mut series = sonarr_series(42, "Example Show", 12345, true);
        series.overview = Some("A show about examples.".to_string());
        series.genres = vec!["Drama".to_string(), "Crime".to_string()];
        series.images = vec![
            SonarrImage {
                cover_type: "poster".to_string(),
                url: "/MediaCover/42/poster.jpg".to_string(),
                remote_url: Some("https://artworks.thetvdb.com/poster.jpg".to_string()),
            },
            // No remote_url -- Sonarr's own local, API-key-gated path must
            // never be forwarded to a Playarr Server client, so this entry is
            // dropped rather than falling back to `url`.
            SonarrImage {
                cover_type: "fanart".to_string(),
                url: "/MediaCover/42/fanart.jpg".to_string(),
                remote_url: None,
            },
        ];

        let remote = map_sonarr(&series);
        assert_eq!(remote.overview.as_deref(), Some("A show about examples."));
        assert_eq!(
            remote.genres,
            vec!["Drama".to_string(), "Crime".to_string()]
        );
        assert_eq!(remote.images.len(), 1);
        assert_eq!(remote.images[0].kind, playarr_model::ImageKind::Poster);
        assert_eq!(
            remote.images[0].url,
            "https://artworks.thetvdb.com/poster.jpg"
        );
    }

    #[test]
    fn sonarr_maps_first_aired_to_release_date() {
        let mut series = sonarr_series(42, "Example Show", 12345, true);
        let aired = "2019-01-01T00:00:00Z".parse::<DateTime<Utc>>().unwrap();
        series.first_aired = Some(aired);
        let remote = map_sonarr(&series);
        assert_eq!(remote.release_date, Some(aired));
    }

    #[test]
    fn sonarr_release_date_is_none_when_first_aired_absent() {
        let series = sonarr_series(42, "Example Show", 12345, true);
        let remote = map_sonarr(&series);
        assert_eq!(remote.release_date, None);
    }

    #[test]
    fn whisparr_maps_tpdb_id_as_external_id_and_leaves_availability_unknown() {
        let series = whisparr_series(42, "Example Studio", 12345, true);
        let remote = map_whisparr(&series);
        assert_eq!(remote.external_id, "12345");
        assert_eq!(remote.title, "Example Studio");
        assert!(remote.monitored);
        assert_eq!(remote.availability, None);
    }

    #[test]
    fn whisparr_maps_overview_genres_and_remote_hosted_images() {
        let mut series = whisparr_series(42, "Example Studio", 12345, true);
        series.overview = Some("A studio producing example content.".to_string());
        series.genres = vec!["Genre A".to_string(), "Genre B".to_string()];
        series.images = vec![
            WhisparrImage {
                cover_type: "poster".to_string(),
                url: "/MediaCover/42/poster.jpg".to_string(),
                remote_url: Some("https://cdn.theporndb.net/poster.jpg".to_string()),
            },
            // No remote_url -- Whisparr's own local, API-key-gated path
            // must never be forwarded to a Playarr Server client, so this entry
            // is dropped rather than falling back to `url`.
            WhisparrImage {
                cover_type: "fanart".to_string(),
                url: "/MediaCover/42/fanart.jpg".to_string(),
                remote_url: None,
            },
        ];

        let remote = map_whisparr(&series);
        assert_eq!(
            remote.overview.as_deref(),
            Some("A studio producing example content.")
        );
        assert_eq!(
            remote.genres,
            vec!["Genre A".to_string(), "Genre B".to_string()]
        );
        assert_eq!(remote.images.len(), 1);
        assert_eq!(remote.images[0].kind, playarr_model::ImageKind::Poster);
        assert_eq!(remote.images[0].url, "https://cdn.theporndb.net/poster.jpg");
    }

    #[test]
    fn added_maps_for_every_source_and_rejects_unusable_values() {
        let at = "2023-05-04T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let mut series = sonarr_series(1, "Example Show", 1, true);
        series.added = Some(at);
        assert_eq!(map_sonarr(&series).added, Some(at));
        let mut whisparr = whisparr_series(1, "Example Studio", 1, true);
        whisparr.added = Some(at);
        assert_eq!(map_whisparr(&whisparr).added, Some(at));
        let mut movie = radarr_movie(1, "Test Movie A", 1, true, true);
        movie.added = Some(at);
        assert_eq!(map_radarr(&movie).added, Some(at));
        let mut artist = lidarr_artist(1);
        artist.added = Some(at);
        assert_eq!(map_lidarr(&artist, Uuid::new_v4()).added, Some(at));

        assert_eq!(map_sonarr(&sonarr_series(1, "X", 1, true)).added, None);
        let unset = "0001-01-01T00:00:00Z".parse::<DateTime<Utc>>().unwrap();
        assert_eq!(usable_added(Some(unset)), None);
        assert_eq!(
            usable_added(Some(Utc::now() + chrono::Duration::days(30))),
            None
        );
        assert_eq!(usable_added(None), None);
    }

    #[test]
    fn whisparr_maps_first_aired_to_release_date() {
        let mut series = whisparr_series(42, "Example Studio", 12345, true);
        let aired = "2019-01-01T00:00:00Z".parse::<DateTime<Utc>>().unwrap();
        series.first_aired = Some(aired);
        let remote = map_whisparr(&series);
        assert_eq!(remote.release_date, Some(aired));
    }

    #[test]
    fn whisparr_release_date_is_none_when_first_aired_absent() {
        let series = whisparr_series(42, "Example Studio", 12345, true);
        let remote = map_whisparr(&series);
        assert_eq!(remote.release_date, None);
    }

    #[test]
    fn radarr_prefers_in_cinemas_over_home_media_dates() {
        let mut movie = radarr_movie(1, "Sample Movie Four", 9495, true, true);
        let cinemas = "1994-05-11T00:00:00Z".parse::<DateTime<Utc>>().unwrap();
        movie.in_cinemas = Some(cinemas);
        movie.year = Some(1994);
        movie.digital_release = Some("2005-07-30T00:00:00Z".parse().unwrap());
        movie.physical_release = Some("2005-07-30T00:00:00Z".parse().unwrap());
        assert_eq!(map_radarr(&movie).release_date, Some(cinemas));
    }

    #[test]
    fn radarr_uses_year_when_there_is_no_theatrical_date() {
        let mut movie = radarr_movie(1, "Sample Movie Four", 9495, true, true);
        movie.year = Some(1994);
        movie.digital_release = Some("2005-07-30T00:00:00Z".parse().unwrap());
        let expected = "1994-01-01T00:00:00Z".parse::<DateTime<Utc>>().unwrap();
        assert_eq!(map_radarr(&movie).release_date, Some(expected));
    }

    #[test]
    fn radarr_refines_year_with_home_media_date_in_the_same_year() {
        let mut movie = radarr_movie(1, "Direct To Video", 5, true, true);
        movie.year = Some(2020);
        let digital = "2020-06-01T00:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let physical = "2020-07-01T00:00:00Z".parse::<DateTime<Utc>>().unwrap();
        movie.digital_release = Some(digital);
        movie.physical_release = Some(physical);
        assert_eq!(map_radarr(&movie).release_date, Some(digital));
    }

    #[test]
    fn radarr_falls_back_to_home_media_when_no_cinema_date_or_year() {
        let mut movie = radarr_movie(1, "Example Movie", 999, true, true);
        let physical = "2020-07-01T00:00:00Z".parse::<DateTime<Utc>>().unwrap();
        movie.physical_release = Some(physical);
        assert_eq!(map_radarr(&movie).release_date, Some(physical));
    }

    #[test]
    fn radarr_derives_available_from_has_file() {
        let movie = radarr_movie(1, "Example Movie", 999, true, true);
        let remote = map_radarr(&movie);
        assert_eq!(remote.external_id, "999");
        assert_eq!(remote.availability, Some(Availability::Available));
    }

    #[test]
    fn radarr_monitored_without_file_is_pending() {
        let movie = radarr_movie(2, "Unreleased", 1000, true, false);
        let remote = map_radarr(&movie);
        assert_eq!(remote.availability, Some(Availability::Pending));
    }

    #[test]
    fn radarr_unmonitored_without_file_is_unknown() {
        let movie = radarr_movie(3, "Ignored", 1001, false, false);
        let remote = map_radarr(&movie);
        assert_eq!(remote.availability, Some(Availability::Unknown));
    }

    #[test]
    fn work_kind_and_provider_covers_media_owning_kinds() {
        assert_eq!(
            work_kind_and_provider(SourceKind::Sonarr),
            Some((WorkKind::Series, ExternalProvider::Tvdb))
        );
        assert_eq!(
            work_kind_and_provider(SourceKind::Radarr),
            Some((WorkKind::Movie, ExternalProvider::Tmdb))
        );
        assert_eq!(
            work_kind_and_provider(SourceKind::Lidarr),
            Some((WorkKind::Artist, ExternalProvider::MusicBrainzArtist))
        );
        assert_eq!(
            work_kind_and_provider(SourceKind::Readarr),
            Some((WorkKind::Author, ExternalProvider::Goodreads))
        );
        assert_eq!(
            work_kind_and_provider(SourceKind::Whisparr),
            Some((WorkKind::Site, ExternalProvider::Tpdb))
        );
    }

    #[test]
    fn work_kind_and_provider_is_none_for_non_catalog_sources() {
        assert_eq!(work_kind_and_provider(SourceKind::Bazarr), None);
        assert_eq!(work_kind_and_provider(SourceKind::Prowlarr), None);
    }
}
