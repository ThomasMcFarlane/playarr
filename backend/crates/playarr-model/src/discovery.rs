//! Unified discovery and watchlist domain types -- see
//! `docs/architecture/discovery-watchlist.md`.
//!
//! Providers (library, peers, request catalogues, live TV, games) return
//! [`DiscoveryCandidate`]s; [`merge_candidates`] folds the ones that describe
//! the same real-world title into one [`DiscoveryTitle`] with per-source
//! attribution. All of this is pure so identity and dedupe rules are testable
//! without a database or HTTP.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::work::{ExternalProvider, ExternalRef};

/// What a discovery title is. Games are deliberately separate from
/// [`crate::WorkKind`]: they have their own filter and launch semantics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum DiscoveryKind {
    Movie,
    Series,
    Artist,
    Author,
    Site,
    /// Live or upcoming broadcast programme.
    Programme,
    Game,
}

impl DiscoveryKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Movie => "movie",
            Self::Series => "series",
            Self::Artist => "artist",
            Self::Author => "author",
            Self::Site => "site",
            Self::Programme => "programme",
            Self::Game => "game",
        }
    }
}

impl From<crate::WorkKind> for DiscoveryKind {
    fn from(kind: crate::WorkKind) -> Self {
        match kind {
            crate::WorkKind::Movie => Self::Movie,
            crate::WorkKind::Series => Self::Series,
            crate::WorkKind::Site => Self::Site,
            crate::WorkKind::Artist => Self::Artist,
            crate::WorkKind::Author => Self::Author,
        }
    }
}

/// Which search scope a caller wants. Games only appear for `Games`/`All`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum DiscoveryScope {
    #[default]
    Media,
    Games,
    All,
}

impl DiscoveryScope {
    pub fn includes(self, kind: DiscoveryKind) -> bool {
        match self {
            Self::Media => kind != DiscoveryKind::Game,
            Self::Games => kind == DiscoveryKind::Game,
            Self::All => true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum SourceKindTag {
    Library,
    Peer,
    Request,
    LiveTv,
    Game,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum SourceAvailability {
    Available,
    Requestable,
    Upcoming,
    Unavailable,
}

/// One source's claim on a title.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct TitleSource {
    pub source: SourceKindTag,
    /// Human label, for example the library or peer name.
    pub label: String,
    pub availability: SourceAvailability,
    pub reason: Option<String>,
    pub edition: Option<String>,
    /// Local work id when this source is the library.
    pub work_id: Option<Uuid>,
    /// Provider instance (for example a Radarr source instance) for requests.
    pub provider_instance_id: Option<Uuid>,
}

/// What a provider hands back before merging.
#[derive(Debug, Clone, PartialEq)]
pub struct DiscoveryCandidate {
    pub kind: DiscoveryKind,
    pub title: String,
    pub year: Option<i32>,
    pub external_refs: Vec<ExternalRef>,
    pub poster_url: Option<String>,
    pub overview: Option<String>,
    pub source: TitleSource,
}

/// A merged real-world title.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct DiscoveryTitle {
    /// Stable identity, see [`identity_key`].
    pub title_key: String,
    pub kind: DiscoveryKind,
    pub title: String,
    pub year: Option<i32>,
    pub external_refs: Vec<ExternalRef>,
    pub poster_url: Option<String>,
    pub overview: Option<String>,
    pub editions: Vec<String>,
    pub sources: Vec<TitleSource>,
}

fn provider_rank(provider: &ExternalProvider) -> u8 {
    match provider {
        ExternalProvider::Tmdb => 0,
        ExternalProvider::Tvdb => 1,
        ExternalProvider::Imdb => 2,
        _ => 3,
    }
}

fn provider_tag(provider: &ExternalProvider) -> String {
    match provider {
        ExternalProvider::Tmdb => "tmdb".into(),
        ExternalProvider::Tvdb => "tvdb".into(),
        ExternalProvider::Imdb => "imdb".into(),
        ExternalProvider::MusicBrainzArtist => "mbartist".into(),
        ExternalProvider::MusicBrainzReleaseGroup => "mbrg".into(),
        ExternalProvider::Goodreads => "goodreads".into(),
        ExternalProvider::Isbn => "isbn".into(),
        ExternalProvider::Asin => "asin".into(),
        ExternalProvider::Tpdb => "tpdb".into(),
        ExternalProvider::Other(name) => format!("other-{}", normalise_title(name)),
    }
}

/// Lower-cases, drops a leading article and everything that is not
/// alphanumeric, so "The Test Film" and "test film!" compare equal.
pub fn normalise_title(title: &str) -> String {
    let lower = title.trim().to_lowercase();
    let trimmed = ["the ", "a ", "an "]
        .iter()
        .find_map(|p| lower.strip_prefix(p))
        .unwrap_or(&lower);
    trimmed
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
}

/// The stable key for a title: `provider:kind:id` from the best external ref,
/// else `title:kind:normalised:year`.
pub fn identity_key(
    kind: DiscoveryKind,
    title: &str,
    year: Option<i32>,
    refs: &[ExternalRef],
) -> String {
    if let Some(best) = refs
        .iter()
        .min_by_key(|r| (provider_rank(&r.provider), provider_tag(&r.provider)))
    {
        return format!(
            "{}:{}:{}",
            provider_tag(&best.provider),
            kind.as_str(),
            best.external_id.trim().to_lowercase()
        );
    }
    format!(
        "title:{}:{}:{}",
        kind.as_str(),
        normalise_title(title),
        year.map(|y| y.to_string()).unwrap_or_default()
    )
}

fn ref_keys(c: &DiscoveryCandidate) -> Vec<String> {
    c.external_refs
        .iter()
        .map(|r| {
            format!(
                "{}:{}:{}",
                provider_tag(&r.provider),
                c.kind.as_str(),
                r.external_id.trim().to_lowercase()
            )
        })
        .collect()
}

fn same_title(a: &DiscoveryCandidate, b: &DiscoveryCandidate) -> bool {
    if a.kind != b.kind {
        return false;
    }
    let (ka, kb) = (ref_keys(a), ref_keys(b));
    if ka.iter().any(|k| kb.contains(k)) {
        return true;
    }
    // Refs on both sides that do not overlap are a deliberate "different
    // title"; only fall back to the name when one side has no refs at all.
    if !ka.is_empty() && !kb.is_empty() {
        return false;
    }
    normalise_title(&a.title) == normalise_title(&b.title) && a.year == b.year
}

/// Folds candidates describing the same title into one [`DiscoveryTitle`]
/// each. Merging is transitive and the output order follows the first
/// appearance of each title.
pub fn merge_candidates(candidates: Vec<DiscoveryCandidate>) -> Vec<DiscoveryTitle> {
    let n = candidates.len();
    let mut parent: Vec<usize> = (0..n).collect();
    fn find(parent: &mut [usize], mut i: usize) -> usize {
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    }
    for i in 0..n {
        for j in (i + 1)..n {
            if same_title(&candidates[i], &candidates[j]) {
                let (ri, rj) = (find(&mut parent, i), find(&mut parent, j));
                if ri != rj {
                    parent[rj.max(ri)] = ri.min(rj);
                }
            }
        }
    }
    let mut groups: Vec<(usize, Vec<usize>)> = Vec::new();
    for i in 0..n {
        let root = find(&mut parent, i);
        match groups.iter_mut().find(|(r, _)| *r == root) {
            Some((_, members)) => members.push(i),
            None => groups.push((root, vec![i])),
        }
    }
    groups
        .into_iter()
        .map(|(_, members)| build_title(members.iter().map(|&i| &candidates[i]).collect()))
        .collect()
}

fn build_title(members: Vec<&DiscoveryCandidate>) -> DiscoveryTitle {
    // A library entry names the title best; otherwise the first seen.
    let primary = members
        .iter()
        .find(|c| c.source.source == SourceKindTag::Library)
        .unwrap_or(&members[0]);
    let mut refs: Vec<ExternalRef> = Vec::new();
    let mut editions: Vec<String> = Vec::new();
    let mut sources: Vec<TitleSource> = Vec::new();
    for c in &members {
        for r in &c.external_refs {
            if !refs.contains(r) {
                refs.push(r.clone());
            }
        }
        if let Some(e) = &c.source.edition {
            if !editions.contains(e) {
                editions.push(e.clone());
            }
        }
        if !sources.contains(&c.source) {
            sources.push(c.source.clone());
        }
    }
    sources.sort_by_key(|s| (s.source as u8, s.availability as u8));
    DiscoveryTitle {
        title_key: identity_key(primary.kind, &primary.title, primary.year, &refs),
        kind: primary.kind,
        title: primary.title.clone(),
        year: primary.year.or_else(|| members.iter().find_map(|c| c.year)),
        external_refs: refs,
        poster_url: members.iter().find_map(|c| c.poster_url.clone()),
        overview: members.iter().find_map(|c| c.overview.clone()),
        editions,
        sources,
    }
}

/// A stored watchlist row: a snapshot of a title for one profile.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct WatchlistItem {
    pub title_key: String,
    pub kind: DiscoveryKind,
    pub title: String,
    pub year: Option<i32>,
    pub work_id: Option<Uuid>,
    pub external_refs: Vec<ExternalRef>,
    pub poster_url: Option<String>,
    pub added_at: chrono::DateTime<chrono::Utc>,
}

/// One provider's health for a search.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ProviderState {
    Ok,
    Unavailable,
    Stale,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ProviderStatus {
    pub provider: SourceKindTag,
    pub state: ProviderState,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ActionKind {
    Play,
    Resume,
    Request,
    Record,
    Launch,
}

/// A source-aware thing the viewer can do with a title. Disabled actions are
/// listed with a reason so clients can explain rather than hide them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct TitleAction {
    pub action: ActionKind,
    pub enabled: bool,
    pub reason: Option<String>,
    pub work_id: Option<Uuid>,
    pub media_file_id: Option<Uuid>,
    pub position_ms: Option<u64>,
    pub provider_instance_id: Option<Uuid>,
}

impl TitleAction {
    pub fn disabled(action: ActionKind, reason: impl Into<String>) -> Self {
        Self {
            action,
            enabled: false,
            reason: Some(reason.into()),
            work_id: None,
            media_file_id: None,
            position_ms: None,
            provider_instance_id: None,
        }
    }
}

/// Facts about the viewer's relationship with a title, gathered by the API
/// layer, from which [`compute_actions`] derives the action list.
#[derive(Debug, Clone, Default)]
pub struct ActionContext {
    pub kind: Option<DiscoveryKind>,
    /// Visible library work and a file that plays it (movie file, or the
    /// first episode file for a series).
    pub library_work_id: Option<Uuid>,
    pub playable_media_file_id: Option<Uuid>,
    /// Most recently updated part-watched file of the work.
    pub resume: Option<(Uuid, u64)>,
    pub request_instance_id: Option<Uuid>,
    pub request_unavailable_reason: Option<String>,
    pub can_request: bool,
}

pub fn compute_actions(ctx: &ActionContext) -> Vec<TitleAction> {
    let kind = ctx.kind.unwrap_or(DiscoveryKind::Movie);
    let mut out = Vec::new();
    if kind == DiscoveryKind::Game {
        out.push(TitleAction::disabled(
            ActionKind::Launch,
            "Game launching is not available yet (Games integration pending)",
        ));
        return out;
    }
    if let Some((media_file_id, position_ms)) = ctx.resume {
        out.push(TitleAction {
            action: ActionKind::Resume,
            enabled: true,
            reason: None,
            work_id: ctx.library_work_id,
            media_file_id: Some(media_file_id),
            position_ms: Some(position_ms),
            provider_instance_id: None,
        });
    }
    match (ctx.library_work_id, ctx.playable_media_file_id) {
        (Some(work_id), Some(file)) => out.push(TitleAction {
            action: ActionKind::Play,
            enabled: true,
            reason: None,
            work_id: Some(work_id),
            media_file_id: Some(file),
            position_ms: None,
            provider_instance_id: None,
        }),
        (Some(work_id), None) => {
            let mut a = TitleAction::disabled(
                ActionKind::Play,
                "In the library but no playable file has synced yet",
            );
            a.work_id = Some(work_id);
            out.push(a);
        }
        (None, _) => out.push(TitleAction::disabled(
            ActionKind::Play,
            "Not in a library you can access",
        )),
    }
    if ctx.library_work_id.is_none() {
        if let (Some(instance), true) = (ctx.request_instance_id, ctx.can_request) {
            out.push(TitleAction {
                action: ActionKind::Request,
                enabled: true,
                reason: None,
                work_id: None,
                media_file_id: None,
                position_ms: None,
                provider_instance_id: Some(instance),
            });
        } else {
            let reason = if !ctx.can_request && ctx.request_instance_id.is_some() {
                "Your account is not allowed to request titles".to_string()
            } else {
                ctx.request_unavailable_reason
                    .clone()
                    .unwrap_or_else(|| "No request provider is configured".to_string())
            };
            out.push(TitleAction::disabled(ActionKind::Request, reason));
        }
    }
    out.push(TitleAction::disabled(
        ActionKind::Record,
        "Recording is not available yet (live TV integration pending)",
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(p: ExternalProvider, id: &str) -> ExternalRef {
        ExternalRef {
            provider: p,
            external_id: id.into(),
        }
    }

    fn cand(
        kind: DiscoveryKind,
        title: &str,
        year: Option<i32>,
        refs: Vec<ExternalRef>,
        source: SourceKindTag,
        edition: Option<&str>,
    ) -> DiscoveryCandidate {
        DiscoveryCandidate {
            kind,
            title: title.into(),
            year,
            external_refs: refs,
            poster_url: None,
            overview: None,
            source: TitleSource {
                source,
                label: format!("{source:?}"),
                availability: SourceAvailability::Available,
                reason: None,
                edition: edition.map(Into::into),
                work_id: None,
                provider_instance_id: None,
            },
        }
    }

    #[test]
    fn key_prefers_tmdb_then_tvdb_then_imdb() {
        let refs = vec![
            r(ExternalProvider::Imdb, "tt1"),
            r(ExternalProvider::Tmdb, "155"),
        ];
        assert_eq!(
            identity_key(DiscoveryKind::Movie, "x", None, &refs),
            "tmdb:movie:155"
        );
        assert_eq!(
            identity_key(
                DiscoveryKind::Series,
                "x",
                None,
                &[r(ExternalProvider::Tvdb, "9")]
            ),
            "tvdb:series:9"
        );
    }

    #[test]
    fn key_falls_back_to_normalised_title_and_year() {
        assert_eq!(
            identity_key(DiscoveryKind::Movie, "The Test Film!", Some(2008), &[]),
            "title:movie:testfilm:2008"
        );
    }

    #[test]
    fn shared_ref_merges_and_unions_refs_and_sources() {
        let a = cand(
            DiscoveryKind::Movie,
            "Orbit",
            Some(1995),
            vec![r(ExternalProvider::Imdb, "tt0113277")],
            SourceKindTag::Library,
            None,
        );
        let b = cand(
            DiscoveryKind::Movie,
            "Orbit",
            Some(1995),
            vec![
                r(ExternalProvider::Imdb, "tt0113277"),
                r(ExternalProvider::Tmdb, "949"),
            ],
            SourceKindTag::Request,
            None,
        );
        let merged = merge_candidates(vec![a, b]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].external_refs.len(), 2);
        assert_eq!(merged[0].sources.len(), 2);
        assert_eq!(merged[0].title_key, "tmdb:movie:949");
    }

    #[test]
    fn merge_is_transitive() {
        let a = cand(
            DiscoveryKind::Movie,
            "A",
            None,
            vec![r(ExternalProvider::Imdb, "tt1")],
            SourceKindTag::Library,
            None,
        );
        let c = cand(
            DiscoveryKind::Movie,
            "A",
            None,
            vec![r(ExternalProvider::Tmdb, "2")],
            SourceKindTag::Peer,
            None,
        );
        let b = cand(
            DiscoveryKind::Movie,
            "A",
            None,
            vec![
                r(ExternalProvider::Imdb, "tt1"),
                r(ExternalProvider::Tmdb, "2"),
            ],
            SourceKindTag::Request,
            None,
        );
        assert_eq!(merge_candidates(vec![a, c, b]).len(), 1);
    }

    #[test]
    fn disjoint_refs_with_same_name_stay_separate_remake() {
        let a = cand(
            DiscoveryKind::Movie,
            "Sample Title",
            Some(1984),
            vec![r(ExternalProvider::Tmdb, "841")],
            SourceKindTag::Library,
            None,
        );
        let b = cand(
            DiscoveryKind::Movie,
            "Sample Title",
            Some(2021),
            vec![r(ExternalProvider::Tmdb, "438631")],
            SourceKindTag::Library,
            None,
        );
        assert_eq!(merge_candidates(vec![a, b]).len(), 2);
    }

    #[test]
    fn different_kinds_never_merge() {
        let a = cand(
            DiscoveryKind::Movie,
            "Fargo",
            Some(1996),
            vec![],
            SourceKindTag::Library,
            None,
        );
        let b = cand(
            DiscoveryKind::Series,
            "Fargo",
            Some(1996),
            vec![],
            SourceKindTag::Library,
            None,
        );
        assert_eq!(merge_candidates(vec![a, b]).len(), 2);
    }

    #[test]
    fn ref_less_candidates_merge_on_name_and_year() {
        let a = cand(
            DiscoveryKind::Movie,
            "The Thing",
            Some(1982),
            vec![],
            SourceKindTag::Library,
            None,
        );
        let c = cand(
            DiscoveryKind::Movie,
            "the thing",
            Some(1982),
            vec![],
            SourceKindTag::Peer,
            None,
        );
        assert_eq!(merge_candidates(vec![a.clone(), c]).len(), 1);
        let d = cand(
            DiscoveryKind::Movie,
            "The Thing",
            Some(2011),
            vec![],
            SourceKindTag::Peer,
            None,
        );
        assert_eq!(merge_candidates(vec![a, d]).len(), 2);
    }

    #[test]
    fn editions_collapse_into_one_title() {
        let refs = vec![r(ExternalProvider::Tmdb, "78")];
        let a = cand(
            DiscoveryKind::Movie,
            "Sample Runner",
            Some(1982),
            refs.clone(),
            SourceKindTag::Library,
            Some("Final Cut"),
        );
        let b = cand(
            DiscoveryKind::Movie,
            "Sample Runner",
            Some(1982),
            refs,
            SourceKindTag::Library,
            Some("Theatrical"),
        );
        let merged = merge_candidates(vec![a, b]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].editions, vec!["Final Cut", "Theatrical"]);
    }

    #[test]
    fn scope_filters_games() {
        assert!(!DiscoveryScope::Media.includes(DiscoveryKind::Game));
        assert!(DiscoveryScope::Games.includes(DiscoveryKind::Game));
        assert!(!DiscoveryScope::Games.includes(DiscoveryKind::Movie));
        assert!(DiscoveryScope::All.includes(DiscoveryKind::Game));
    }

    #[test]
    fn actions_resume_play_and_disabled_reasons() {
        let file = Uuid::new_v4();
        let work = Uuid::new_v4();
        let acts = compute_actions(&ActionContext {
            kind: Some(DiscoveryKind::Movie),
            library_work_id: Some(work),
            playable_media_file_id: Some(file),
            resume: Some((file, 5000)),
            ..Default::default()
        });
        assert_eq!(acts[0].action, ActionKind::Resume);
        assert_eq!(acts[0].position_ms, Some(5000));
        assert!(acts
            .iter()
            .any(|a| a.action == ActionKind::Play && a.enabled));
        assert!(acts
            .iter()
            .any(|a| a.action == ActionKind::Record && !a.enabled && a.reason.is_some()));
        assert!(!acts.iter().any(|a| a.action == ActionKind::Request));
    }

    #[test]
    fn request_enabled_only_when_not_in_library_and_permitted() {
        let inst = Uuid::new_v4();
        let ok = compute_actions(&ActionContext {
            kind: Some(DiscoveryKind::Movie),
            request_instance_id: Some(inst),
            can_request: true,
            ..Default::default()
        });
        assert!(ok
            .iter()
            .any(|a| a.action == ActionKind::Request && a.enabled));
        let denied = compute_actions(&ActionContext {
            kind: Some(DiscoveryKind::Movie),
            request_instance_id: Some(inst),
            can_request: false,
            ..Default::default()
        });
        let req = denied
            .iter()
            .find(|a| a.action == ActionKind::Request)
            .unwrap();
        assert!(!req.enabled);
        assert!(req.reason.as_deref().unwrap().contains("not allowed"));
    }

    #[test]
    fn games_only_offer_a_disabled_launch() {
        let acts = compute_actions(&ActionContext {
            kind: Some(DiscoveryKind::Game),
            ..Default::default()
        });
        assert_eq!(acts.len(), 1);
        assert_eq!(acts[0].action, ActionKind::Launch);
        assert!(!acts[0].enabled);
    }
}
