//! Translates between local catalogue rows and portable [`ItemRef`]s.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::Datelike;
use playarr_catalog::{WorkChildren, WorkDetail};
use playarr_model::media::LeafRef;
use playarr_model::{ExternalProvider, MediaFile, Work, WorkKind};
use playarr_portability::matching::{
    normalize_title, resolve_by_ids, resolve_by_title, Resolution, WorkCandidate,
};
use playarr_portability::{ItemRef, PlayarrRef};
use uuid::Uuid;

use crate::AppState;

/// (work id, title, release year) of every work of the wanted kinds.
type CandidatePool = Vec<(Uuid, String, Option<i32>)>;

const CANDIDATE_PAGE: i64 = 1_000;
const CANDIDATE_CAP: usize = 200_000;

pub fn provider_key(provider: &ExternalProvider) -> String {
    match provider {
        ExternalProvider::Tmdb => "tmdb".into(),
        ExternalProvider::Tvdb => "tvdb".into(),
        ExternalProvider::Imdb => "imdb".into(),
        ExternalProvider::MusicBrainzArtist => "musicbrainz_artist".into(),
        ExternalProvider::MusicBrainzReleaseGroup => "musicbrainz_release_group".into(),
        ExternalProvider::Goodreads => "goodreads".into(),
        ExternalProvider::Isbn => "isbn".into(),
        ExternalProvider::Asin => "asin".into(),
        ExternalProvider::Tpdb => "tpdb".into(),
        ExternalProvider::Other(name) => format!("other:{name}"),
    }
}

pub fn parse_provider_key(key: &str) -> Option<ExternalProvider> {
    Some(match key {
        "tmdb" => ExternalProvider::Tmdb,
        "tvdb" => ExternalProvider::Tvdb,
        "imdb" => ExternalProvider::Imdb,
        "musicbrainz_artist" => ExternalProvider::MusicBrainzArtist,
        "musicbrainz_release_group" => ExternalProvider::MusicBrainzReleaseGroup,
        "goodreads" => ExternalProvider::Goodreads,
        "isbn" => ExternalProvider::Isbn,
        "asin" => ExternalProvider::Asin,
        "tpdb" => ExternalProvider::Tpdb,
        other => ExternalProvider::Other(other.strip_prefix("other:")?.to_owned()),
    })
}

pub fn work_kind_key(kind: WorkKind) -> &'static str {
    match kind {
        WorkKind::Movie => "movie",
        WorkKind::Series => "series",
        WorkKind::Site => "site",
        WorkKind::Artist => "artist",
        WorkKind::Author => "author",
    }
}

/// The work kinds an item of `kind` can live under; `None` for kinds this
/// server does not know (reported as unsupported, never guessed).
pub fn work_kinds_for(kind: &str) -> Option<&'static [WorkKind]> {
    Some(match kind {
        "movie" => &[WorkKind::Movie],
        "series" => &[WorkKind::Series],
        "site" => &[WorkKind::Site],
        "episode" => &[WorkKind::Series, WorkKind::Site],
        "artist" | "track" => &[WorkKind::Artist],
        "author" | "book" => &[WorkKind::Author],
        _ => return None,
    })
}

fn base_item(work: &Work) -> ItemRef {
    ItemRef {
        kind: work_kind_key(work.kind).to_owned(),
        title: work.title.clone(),
        year: work.release_date.map(|date| date.year()),
        external_ids: work
            .external_refs
            .iter()
            .map(|r| (provider_key(&r.provider), r.external_id.clone()))
            .collect(),
        playarr: Some(PlayarrRef {
            work_id: work.id,
            leaf_id: None,
        }),
        ..ItemRef::default()
    }
}

/// Portable reference for a watchlist snapshot.
pub fn item_for_watchlist(row: &playarr_model::discovery::WatchlistItem) -> ItemRef {
    ItemRef {
        kind: row.kind.as_str().to_owned(),
        title: row.title.clone(),
        year: row.year,
        external_ids: row
            .external_refs
            .iter()
            .map(|r| (provider_key(&r.provider), r.external_id.clone()))
            .collect(),
        playarr: row.work_id.map(|work_id| PlayarrRef {
            work_id,
            leaf_id: None,
        }),
        ..ItemRef::default()
    }
}

/// The discovery kind a portable item kind names, if this server knows it.
pub fn discovery_kind(kind: &str) -> Option<playarr_model::discovery::DiscoveryKind> {
    use playarr_model::discovery::DiscoveryKind as K;
    Some(match kind {
        "movie" => K::Movie,
        "series" => K::Series,
        "artist" => K::Artist,
        "author" => K::Author,
        "site" => K::Site,
        "programme" => K::Programme,
        "game" => K::Game,
        _ => return None,
    })
}

/// Outcome of resolving an imported item to local content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkMatch {
    Found(Uuid),
    Ambiguous(Vec<Uuid>),
    NoMatch,
    Unsupported,
}

/// The local leaf (file or playlist target) an item resolves to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LeafMatch {
    Found {
        work_id: Uuid,
        media_file_id: Option<Uuid>,
        track_id: Option<Uuid>,
    },
    Ambiguous(Vec<String>),
    NoMatch,
    Unsupported,
}

/// Per-request resolver with caches, scoped to one user's library grants.
pub struct Resolver<'a> {
    state: &'a AppState,
    allowed: Option<Vec<Uuid>>,
    details: HashMap<Uuid, Option<Arc<WorkDetail>>>,
    candidates: HashMap<&'static str, Arc<CandidatePool>>,
}

impl<'a> Resolver<'a> {
    pub fn new(state: &'a AppState, allowed: Option<Vec<Uuid>>) -> Self {
        Self {
            state,
            allowed,
            details: HashMap::new(),
            candidates: HashMap::new(),
        }
    }

    /// Catalogue detail for a work the user may see; `None` otherwise.
    pub async fn detail(&mut self, work_id: Uuid) -> Option<Arc<WorkDetail>> {
        if let Some(cached) = self.details.get(&work_id) {
            return cached.clone();
        }
        let fetched = self
            .state
            .catalog
            .get_by_id(work_id, self.allowed.as_deref())
            .await
            .ok()
            .map(Arc::new);
        self.details.insert(work_id, fetched.clone());
        fetched
    }

    // ---- export direction -------------------------------------------------

    /// Portable reference for the leaf a media file plays.
    pub async fn item_for_media_file(&mut self, file: &MediaFile) -> Option<ItemRef> {
        let detail = self.detail(file.work_id).await?;
        let mut item = base_item(&detail.work);
        match (&file.leaf_ref, &detail.children) {
            (LeafRef::Work, WorkChildren::Movie) => {}
            (LeafRef::Episode(id), WorkChildren::Series(seasons)) => {
                let (season, episode) = seasons.iter().find_map(|season| {
                    season
                        .episodes
                        .iter()
                        .find(|e| e.episode.id == *id)
                        .map(|e| (&season.season, &e.episode))
                })?;
                item.kind = "episode".into();
                item.season_number = Some(season.season_number);
                item.episode_number = Some(episode.episode_number);
                item.episode_title = episode.title.clone();
                item.playarr = Some(PlayarrRef {
                    work_id: file.work_id,
                    leaf_id: Some(*id),
                });
            }
            (LeafRef::Track(id), WorkChildren::Artist(albums)) => {
                let (album, track) = albums.iter().find_map(|album| {
                    album
                        .tracks
                        .iter()
                        .find(|t| t.track.id == *id)
                        .map(|t| (&album.album, &t.track))
                })?;
                fill_track(&mut item, album.title.clone(), track, file.work_id);
            }
            (LeafRef::Book(id), WorkChildren::Author(books)) => {
                let book = books.iter().find(|b| b.book.id == *id)?;
                item.kind = "book".into();
                item.book_title = Some(book.book.title.clone());
                item.playarr = Some(PlayarrRef {
                    work_id: file.work_id,
                    leaf_id: Some(*id),
                });
            }
            _ => return None,
        }
        Some(item)
    }

    /// Portable reference for a playlist entry (work-level, or one track).
    pub async fn item_for_playlist_entry(
        &mut self,
        work_id: Uuid,
        track_id: Option<Uuid>,
    ) -> Option<ItemRef> {
        let detail = self.detail(work_id).await?;
        let mut item = base_item(&detail.work);
        if let (Some(track_id), WorkChildren::Artist(albums)) = (track_id, &detail.children) {
            let (album, track) = albums.iter().find_map(|album| {
                album
                    .tracks
                    .iter()
                    .find(|t| t.track.id == track_id)
                    .map(|t| (&album.album, &t.track))
            })?;
            fill_track(&mut item, album.title.clone(), track, work_id);
        }
        Some(item)
    }

    // ---- import direction -------------------------------------------------

    async fn candidate_pool(&mut self, kinds: &'static [WorkKind]) -> Arc<CandidatePool> {
        let key = work_kind_key(kinds[0]);
        let cache_key = if kinds.len() > 1 { "series+site" } else { key };
        if let Some(pool) = self.candidates.get(cache_key) {
            return pool.clone();
        }
        let mut pool = Vec::new();
        'kinds: for kind in kinds {
            let mut offset = 0;
            loop {
                let page = self
                    .state
                    .work_repo
                    .list_by_kind(*kind, CANDIDATE_PAGE, offset)
                    .await
                    .unwrap_or_default();
                let n = page.len();
                pool.extend(
                    page.into_iter()
                        .map(|w| (w.id, w.title, w.release_date.map(|d| d.year()))),
                );
                if (n as i64) < CANDIDATE_PAGE {
                    break;
                }
                if pool.len() >= CANDIDATE_CAP {
                    break 'kinds;
                }
                offset += CANDIDATE_PAGE;
            }
        }
        let pool = Arc::new(pool);
        self.candidates.insert(cache_key, pool.clone());
        pool
    }

    async fn visible(&self, work_id: Uuid) -> bool {
        self.state
            .catalog
            .is_work_visible(work_id, self.allowed.as_deref())
            .await
            .unwrap_or(false)
    }

    /// Identifier match first, then the title fallback (never both).
    pub async fn match_work(&mut self, item: &ItemRef) -> WorkMatch {
        let Some(kinds) = work_kinds_for(&item.kind) else {
            return WorkMatch::Unsupported;
        };
        let mut hits: Vec<Vec<Uuid>> = Vec::new();
        for (key, value) in &item.external_ids {
            let Some(provider) = parse_provider_key(key) else {
                continue;
            };
            if let Ok(Some(work)) = self
                .state
                .work_repo
                .find_by_external_ref(&provider, value)
                .await
            {
                if kinds.contains(&work.kind) {
                    hits.push(vec![work.id]);
                }
            }
        }
        let resolution = match resolve_by_ids(&hits) {
            Resolution::NoMatch => {
                let pool = self.candidate_pool(kinds).await;
                let candidates: Vec<WorkCandidate> = pool
                    .iter()
                    .map(|(id, title, year)| WorkCandidate {
                        id: *id,
                        kind: item.kind.clone(),
                        title: title.clone(),
                        year: *year,
                    })
                    .collect();
                resolve_by_title(item, &candidates)
            }
            other => other,
        };
        match resolution {
            Resolution::Matched(id) if self.visible(id).await => WorkMatch::Found(id),
            // A work this account may not see is indistinguishable from none.
            Resolution::Matched(_) => WorkMatch::NoMatch,
            Resolution::Ambiguous(ids) => {
                let mut visible = Vec::new();
                for id in ids {
                    if self.visible(id).await {
                        visible.push(id);
                    }
                }
                match visible.len() {
                    0 => WorkMatch::NoMatch,
                    _ => WorkMatch::Ambiguous(visible),
                }
            }
            Resolution::NoMatch => WorkMatch::NoMatch,
        }
    }

    /// Short human-readable descriptions of candidate works, for previews.
    pub async fn describe_works(&mut self, ids: &[Uuid]) -> Vec<String> {
        let mut out = Vec::new();
        for id in ids.iter().take(5) {
            if let Some(detail) = self.detail(*id).await {
                let year = detail
                    .work
                    .release_date
                    .map(|d| format!(" ({})", d.year()))
                    .unwrap_or_default();
                out.push(format!("{}{year}", detail.work.title));
            }
        }
        out
    }

    /// Resolves an item to a playable leaf (files) or work/track (playlists).
    pub async fn match_leaf(&mut self, item: &ItemRef) -> LeafMatch {
        let work_id = match self.match_work(item).await {
            WorkMatch::Found(id) => id,
            WorkMatch::Ambiguous(ids) => {
                return LeafMatch::Ambiguous(self.describe_works(&ids).await)
            }
            WorkMatch::NoMatch => return LeafMatch::NoMatch,
            WorkMatch::Unsupported => return LeafMatch::Unsupported,
        };
        let Some(detail) = self.detail(work_id).await else {
            return LeafMatch::NoMatch;
        };
        let found = |media_file_id, track_id| LeafMatch::Found {
            work_id,
            media_file_id,
            track_id,
        };
        match (item.kind.as_str(), &detail.children) {
            ("movie", WorkChildren::Movie) => found(detail.media_file_id, None),
            ("series" | "site" | "artist" | "author", _) => found(None, None),
            ("episode", WorkChildren::Series(seasons)) => {
                let wanted_title = item.episode_title.as_deref().map(normalize_title);
                let mut hits: Vec<Option<Uuid>> = Vec::new();
                for season in seasons {
                    for episode in &season.episodes {
                        let by_number = item.season_number == Some(season.season.season_number)
                            && item.episode_number == Some(episode.episode.episode_number);
                        let by_title = item.season_number.is_none()
                            && item.episode_number.is_none()
                            && wanted_title.as_deref().is_some_and(|t| {
                                !t.is_empty()
                                    && episode.episode.title.as_deref().map(normalize_title)
                                        == Some(t.to_owned())
                            });
                        if by_number || by_title {
                            hits.push(episode.media_file_id);
                        }
                    }
                }
                single_leaf(hits, |m| found(m, None))
            }
            ("track", WorkChildren::Artist(albums)) => {
                let album_wanted = item.album_title.as_deref().map(normalize_title);
                let title_wanted = item.track_title.as_deref().map(normalize_title);
                let mut hits = Vec::new();
                for album in albums {
                    if let Some(wanted) = &album_wanted {
                        if normalize_title(&album.album.title) != *wanted {
                            continue;
                        }
                    }
                    for track in &album.tracks {
                        let matches = match &title_wanted {
                            Some(wanted) if !wanted.is_empty() => {
                                normalize_title(&track.track.title) == *wanted
                            }
                            _ => {
                                item.track_number == Some(track.track.track_number as i32)
                                    && item
                                        .disc_number
                                        .is_none_or(|d| d == track.track.disc_number as i32)
                            }
                        };
                        if matches {
                            hits.push((track.track.id, track.media_file_id));
                        }
                    }
                }
                single_leaf(hits, |(track_id, media_file_id)| {
                    found(media_file_id, Some(track_id))
                })
            }
            ("book", WorkChildren::Author(books)) => {
                let wanted = item.book_title.as_deref().map(normalize_title);
                let hits: Vec<Option<Uuid>> = books
                    .iter()
                    .filter(|b| {
                        wanted
                            .as_deref()
                            .is_some_and(|w| !w.is_empty() && normalize_title(&b.book.title) == w)
                    })
                    .map(|b| b.media_file_id)
                    .collect();
                single_leaf(hits, |m| found(m, None))
            }
            _ => LeafMatch::NoMatch,
        }
    }
}

fn single_leaf<T>(mut hits: Vec<T>, found: impl FnOnce(T) -> LeafMatch) -> LeafMatch {
    match hits.len() {
        0 => LeafMatch::NoMatch,
        1 => found(hits.remove(0)),
        n => LeafMatch::Ambiguous(vec![format!("{n} matching entries")]),
    }
}

fn fill_track(item: &mut ItemRef, album_title: String, track: &playarr_model::Track, work: Uuid) {
    item.kind = "track".into();
    item.album_title = Some(album_title);
    item.disc_number = Some(track.disc_number as i32);
    item.track_number = Some(track.track_number as i32);
    item.track_title = Some(track.title.clone());
    item.playarr = Some(PlayarrRef {
        work_id: work,
        leaf_id: Some(track.id),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_keys_round_trip() {
        for provider in [
            ExternalProvider::Tmdb,
            ExternalProvider::Tvdb,
            ExternalProvider::Imdb,
            ExternalProvider::Other("anidb".into()),
        ] {
            assert_eq!(parse_provider_key(&provider_key(&provider)), Some(provider));
        }
        assert_eq!(parse_provider_key("nonsense"), None);
    }
}
