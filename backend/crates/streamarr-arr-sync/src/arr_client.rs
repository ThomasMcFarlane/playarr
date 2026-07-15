//! Bridges `streamarr-arr-client`'s per-app clients (each with its own DTO
//! shape and inherent methods — there is no shared "list everything" trait,
//! see that crate's docs) into one dispatchable [`ArrClient`] enum, and
//! normalizes each app's DTO into a [`RemoteWork`] the reconciliation poller
//! can diff against `streamarr_model::Work` without knowing which *arr app
//! it came from.

use streamarr_arr_client::{
    ArrClientError, BazarrClient, LidarrArtist, LidarrClient, ProwlarrClient, ReadarrAuthor,
    ReadarrClient, RadarrClient, RadarrMovie, SonarrClient, SonarrSeries,
};
use streamarr_model::{Availability, ExternalProvider, SourceInstance, SourceKind, WorkKind};

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
    pub title: String,
    pub sort_title: String,
    pub monitored: bool,
    /// `None` when this source kind's trimmed DTO doesn't carry enough
    /// information to derive availability (e.g. Sonarr's series-level
    /// payload has no file-count summary) — callers must leave the existing
    /// `Work::availability` untouched rather than downgrading it to
    /// `Unknown` on every sync pass.
    pub availability: Option<Availability>,
}

fn map_sonarr(series: &SonarrSeries) -> RemoteWork {
    RemoteWork {
        external_id: series.tvdb_id.to_string(),
        title: series.title.clone(),
        sort_title: series.sort_title.clone(),
        monitored: series.monitored,
        // Series-level Sonarr payloads don't carry an episode-file-count
        // summary in our trimmed DTO; per-episode availability is out of
        // scope for this pass (episodes are a separate child aggregate —
        // see `streamarr_model::series`), so we deliberately don't guess.
        availability: None,
    }
}

fn map_radarr(movie: &RadarrMovie) -> RemoteWork {
    RemoteWork {
        external_id: movie.tmdb_id.to_string(),
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
    }
}

fn map_lidarr(artist: &LidarrArtist) -> RemoteWork {
    RemoteWork {
        external_id: artist.foreign_artist_id.clone(),
        title: artist.artist_name.clone(),
        // Lidarr's artist DTO has no distinct sort-title field.
        sort_title: artist.artist_name.clone(),
        monitored: artist.monitored,
        availability: None,
    }
}

fn map_readarr(author: &ReadarrAuthor) -> RemoteWork {
    RemoteWork {
        external_id: author.foreign_author_id.clone(),
        title: author.author_name.clone(),
        sort_title: author.author_name.clone(),
        monitored: author.monitored,
        availability: None,
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
/// TODO: once `WorkRepo` (or a sibling repo) grows a write path for
/// subtitle-completeness state, Bazarr reconciliation should target that
/// instead of `Work` directly — it's deliberately not shoehorned in here.
pub fn work_kind_and_provider(source_kind: SourceKind) -> Option<(WorkKind, ExternalProvider)> {
    match source_kind {
        SourceKind::Sonarr => Some((WorkKind::Series, ExternalProvider::Tvdb)),
        SourceKind::Radarr => Some((WorkKind::Movie, ExternalProvider::Tmdb)),
        SourceKind::Lidarr => Some((WorkKind::Artist, ExternalProvider::MusicBrainzArtist)),
        SourceKind::Readarr => Some((WorkKind::Author, ExternalProvider::Goodreads)),
        SourceKind::Bazarr | SourceKind::Prowlarr => None,
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
        }
    }

    /// The full remote list, normalized to [`RemoteWork`]. Empty (not an
    /// error) for source kinds `work_kind_and_provider` returns `None` for —
    /// there's nothing to list onto the `Work` aggregate for those.
    pub async fn list_all(&self) -> Result<Vec<RemoteWork>, ArrClientError> {
        match self {
            ArrClient::Sonarr(client) => Ok(client
                .list_series()
                .await?
                .iter()
                .map(map_sonarr)
                .collect()),
            ArrClient::Radarr(client) => {
                Ok(client.list_movies().await?.iter().map(map_radarr).collect())
            }
            ArrClient::Lidarr(client) => Ok(client
                .list_artists()
                .await?
                .iter()
                .map(map_lidarr)
                .collect()),
            ArrClient::Readarr(client) => Ok(client
                .list_authors()
                .await?
                .iter()
                .map(map_readarr)
                .collect()),
            ArrClient::Bazarr(_) | ArrClient::Prowlarr(_) => Ok(Vec::new()),
        }
    }

    /// A single remote entity by the source app's own id, normalized to
    /// [`RemoteWork`]. `Ok(None)` (not an error) for source kinds with no
    /// `Work`-owning catalog surface.
    pub async fn get_one(&self, id: i64) -> Result<Option<RemoteWork>, ArrClientError> {
        match self {
            ArrClient::Sonarr(client) => Ok(Some(map_sonarr(&client.get_series(id).await?))),
            ArrClient::Radarr(client) => Ok(Some(map_radarr(&client.get_movie(id).await?))),
            ArrClient::Lidarr(client) => Ok(Some(map_lidarr(&client.get_artist(id).await?))),
            ArrClient::Readarr(client) => Ok(Some(map_readarr(&client.get_author(id).await?))),
            ArrClient::Bazarr(_) | ArrClient::Prowlarr(_) => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sonarr_maps_tvdb_id_as_external_id_and_leaves_availability_unknown() {
        let series = SonarrSeries {
            id: 42,
            title: "Example Show".to_string(),
            sort_title: "example show".to_string(),
            tvdb_id: 12345,
            monitored: true,
            status: "continuing".to_string(),
            path: "/tv/example-show".to_string(),
        };
        let remote = map_sonarr(&series);
        assert_eq!(remote.external_id, "12345");
        assert_eq!(remote.title, "Example Show");
        assert!(remote.monitored);
        assert_eq!(remote.availability, None);
    }

    #[test]
    fn radarr_derives_available_from_has_file() {
        let movie = RadarrMovie {
            id: 1,
            title: "Example Movie".to_string(),
            sort_title: "example movie".to_string(),
            tmdb_id: 999,
            monitored: true,
            has_file: true,
            path: "/movies/example-movie".to_string(),
        };
        let remote = map_radarr(&movie);
        assert_eq!(remote.external_id, "999");
        assert_eq!(remote.availability, Some(Availability::Available));
    }

    #[test]
    fn radarr_monitored_without_file_is_pending() {
        let movie = RadarrMovie {
            id: 2,
            title: "Unreleased".to_string(),
            sort_title: "unreleased".to_string(),
            tmdb_id: 1000,
            monitored: true,
            has_file: false,
            path: "/movies/unreleased".to_string(),
        };
        let remote = map_radarr(&movie);
        assert_eq!(remote.availability, Some(Availability::Pending));
    }

    #[test]
    fn radarr_unmonitored_without_file_is_unknown() {
        let movie = RadarrMovie {
            id: 3,
            title: "Ignored".to_string(),
            sort_title: "ignored".to_string(),
            tmdb_id: 1001,
            monitored: false,
            has_file: false,
            path: "/movies/ignored".to_string(),
        };
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
    }

    #[test]
    fn work_kind_and_provider_is_none_for_non_catalog_sources() {
        assert_eq!(work_kind_and_provider(SourceKind::Bazarr), None);
        assert_eq!(work_kind_and_provider(SourceKind::Prowlarr), None);
    }
}
