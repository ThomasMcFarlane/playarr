//! Unified media-request model shared by Playarr's direct Radarr/Sonarr adds
//! and the Ombi and Seerr integrations (TASKS 280-287).
//!
//! One [`MediaRequest`] row exists per title identity (`title_key`, see
//! [`crate::discovery::identity_key`]). `origin` records which system created
//! it; the per-system request ids let a poll or webhook find the same row
//! again, so a request pushed to Ombi is recognised (not re-imported) when the
//! next pull sees it. Everything here is pure so the conflict rules are
//! testable without a database or HTTP.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::discovery::DiscoveryKind;
use crate::sensitive::Sensitive;

macro_rules! string_enum {
    ($(#[$m:meta])* $name:ident { $($var:ident => $s:literal),+ $(,)? }) => {
        $(#[$m])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(rename_all = "snake_case")]
        #[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
        pub enum $name { $($var),+ }
        impl $name {
            pub fn as_str(self) -> &'static str {
                match self { $(Self::$var => $s),+ }
            }
            pub fn parse(raw: &str) -> Option<Self> {
                match raw { $($s => Some(Self::$var),)+ _ => None }
            }
        }
    };
}

string_enum!(
    /// Lifecycle of a request, identical across systems.
    RequestStatus {
        Pending => "pending",
        Approved => "approved",
        Declined => "declined",
        Available => "available",
        Failed => "failed",
    }
);

string_enum!(
    /// Which system created the request.
    RequestOrigin {
        Playarr => "playarr",
        Ombi => "ombi",
        Seerr => "seerr",
    }
);

string_enum!(
    /// External request manager an integration talks to.
    IntegrationKind {
        Ombi => "ombi",
        Seerr => "seerr",
    }
);

string_enum!(
    /// How a Playarr user is matched to a user of the external system.
    UserMappingStrategy {
        Email => "email",
        Username => "username",
        Map => "map",
    }
);

string_enum!(
    /// Where a Playarr request is sent (admin setting).
    RequestBackend {
        Direct => "direct",
        Ombi => "ombi",
        Seerr => "seerr",
        DirectMirror => "direct_mirror",
    }
);

impl IntegrationKind {
    pub fn origin(self) -> RequestOrigin {
        match self {
            Self::Ombi => RequestOrigin::Ombi,
            Self::Seerr => RequestOrigin::Seerr,
        }
    }
}

impl RequestStatus {
    /// Final states a user can request again from.
    pub fn is_open(self) -> bool {
        matches!(self, Self::Pending | Self::Approved)
    }
}

/// The unified request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MediaRequest {
    pub id: Uuid,
    pub title_key: String,
    pub kind: DiscoveryKind,
    pub title: String,
    pub year: Option<i32>,
    pub tmdb_id: Option<i64>,
    pub tvdb_id: Option<i64>,
    pub imdb_id: Option<String>,
    pub poster_url: Option<String>,
    /// Requested season numbers; empty means all seasons (or not applicable).
    pub seasons: Vec<i32>,
    pub requester_user_id: Option<Uuid>,
    /// Display name, username or email of the requester in the origin system.
    pub requester_label: Option<String>,
    pub status: RequestStatus,
    pub origin: RequestOrigin,
    pub ombi_request_id: Option<String>,
    pub seerr_request_id: Option<String>,
    /// Radarr/Sonarr instance the title was added to directly, if any.
    pub direct_instance_id: Option<Uuid>,
    pub status_note: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl MediaRequest {
    pub fn external_id(&self, kind: IntegrationKind) -> Option<&str> {
        match kind {
            IntegrationKind::Ombi => self.ombi_request_id.as_deref(),
            IntegrationKind::Seerr => self.seerr_request_id.as_deref(),
        }
    }

    pub fn set_external_id(&mut self, kind: IntegrationKind, id: Option<String>) {
        match kind {
            IntegrationKind::Ombi => self.ombi_request_id = id,
            IntegrationKind::Seerr => self.seerr_request_id = id,
        }
    }
}

/// Configuration of one Ombi or Seerr connection.
#[derive(Debug, Clone, PartialEq)]
pub struct RequestIntegration {
    pub id: Uuid,
    pub kind: IntegrationKind,
    pub name: String,
    pub base_url: String,
    /// Stored key; empty when the key comes from `api_key_env`.
    pub api_key: Sensitive<String>,
    /// Name of an environment variable (mounted from a Kubernetes Secret)
    /// holding the key. Wins over the stored key when set and non-empty.
    pub api_key_env: Option<String>,
    pub enabled: bool,
    pub poll_interval_secs: u32,
    pub mapping: UserMappingStrategy,
    /// Explicit map for [`UserMappingStrategy::Map`] (and an override for the
    /// other strategies): Playarr user id -> external user id.
    pub user_map: BTreeMap<String, String>,
    /// Shared secret for the signal-only webhook receiver.
    pub webhook_secret: Sensitive<String>,
    pub last_sync_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
}

pub const MIN_POLL_INTERVAL_SECS: u32 = 30;
pub const DEFAULT_POLL_INTERVAL_SECS: u32 = 300;

impl RequestIntegration {
    /// The effective API key: environment variable first, then the stored one.
    pub fn resolve_api_key(&self, env: impl Fn(&str) -> Option<String>) -> String {
        self.api_key_env
            .as_deref()
            .filter(|n| !n.is_empty())
            .and_then(env)
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| self.api_key.expose_secret().clone())
    }
}

/// A user of an external system, as returned by its user listing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ExternalUser {
    pub id: String,
    pub username: Option<String>,
    pub email: Option<String>,
    pub display_name: Option<String>,
}

/// A Playarr user as far as matching is concerned.
#[derive(Debug, Clone, PartialEq)]
pub struct LocalUserRef {
    pub id: Uuid,
    pub username: String,
    pub email: Option<String>,
}

fn same(a: &str, b: &str) -> bool {
    !a.trim().is_empty() && a.trim().eq_ignore_ascii_case(b.trim())
}

/// Picks the external user a Playarr user maps to. An explicit map entry wins
/// under every strategy; otherwise the strategy decides. `None` means unmapped.
pub fn map_local_to_external<'a>(
    integration: &RequestIntegration,
    user: &LocalUserRef,
    externals: &'a [ExternalUser],
) -> Option<&'a ExternalUser> {
    if let Some(id) = integration.user_map.get(&user.id.to_string()) {
        return externals.iter().find(|e| &e.id == id);
    }
    match integration.mapping {
        UserMappingStrategy::Map => None,
        UserMappingStrategy::Email => externals
            .iter()
            .find(|e| matches!((&e.email, &user.email), (Some(a), Some(b)) if same(a, b))),
        UserMappingStrategy::Username => externals.iter().find(|e| {
            e.username
                .as_deref()
                .is_some_and(|n| same(n, &user.username))
        }),
    }
}

/// Reverse direction: which Playarr user does an external user map to.
pub fn map_external_to_local<'a>(
    integration: &RequestIntegration,
    external: &ExternalUser,
    locals: &'a [LocalUserRef],
) -> Option<&'a LocalUserRef> {
    if let Some((uid, _)) = integration
        .user_map
        .iter()
        .find(|(_, ext)| **ext == external.id)
    {
        return locals.iter().find(|l| &l.id.to_string() == uid);
    }
    match integration.mapping {
        UserMappingStrategy::Map => None,
        UserMappingStrategy::Email => locals
            .iter()
            .find(|l| matches!((&external.email, &l.email), (Some(a), Some(b)) if same(a, b))),
        UserMappingStrategy::Username => locals.iter().find(|l| {
            external
                .username
                .as_deref()
                .is_some_and(|n| same(n, &l.username))
        }),
    }
}

/// Resolves the status when an external system reports `incoming` for a
/// request Playarr holds as `current`. The external manager owns
/// approve/decline, so it wins, with two exceptions: `Available` is never
/// regressed to an earlier state (the library is the truth for availability),
/// and a locally recorded `Failed` is replaced by anything the external side
/// reports since it implies a retry there.
pub fn reconcile_status(current: RequestStatus, incoming: RequestStatus) -> RequestStatus {
    match (current, incoming) {
        (RequestStatus::Available, RequestStatus::Pending | RequestStatus::Approved) => {
            RequestStatus::Available
        }
        (_, incoming) => incoming,
    }
}

/// Union of season lists with stable order; `[]` (all seasons) absorbs.
pub fn merge_seasons(a: &[i32], b: &[i32]) -> Vec<i32> {
    if a.is_empty() || b.is_empty() {
        return Vec::new();
    }
    let mut out: Vec<i32> = a.iter().chain(b).copied().collect();
    out.sort_unstable();
    out.dedup();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn integration(mapping: UserMappingStrategy) -> RequestIntegration {
        RequestIntegration {
            id: Uuid::new_v4(),
            kind: IntegrationKind::Ombi,
            name: "Ombi".into(),
            base_url: "http://ombi".into(),
            api_key: Sensitive::new("k".into()),
            api_key_env: None,
            enabled: true,
            poll_interval_secs: 300,
            mapping,
            user_map: BTreeMap::new(),
            webhook_secret: Sensitive::new("s".into()),
            last_sync_at: None,
            last_error: None,
        }
    }

    fn ext(id: &str, name: &str, email: &str) -> ExternalUser {
        ExternalUser {
            id: id.into(),
            username: Some(name.into()),
            email: Some(email.into()),
            display_name: None,
        }
    }

    #[test]
    fn status_round_trips_and_open_states() {
        for s in ["pending", "approved", "declined", "available", "failed"] {
            assert_eq!(RequestStatus::parse(s).unwrap().as_str(), s);
        }
        assert!(RequestStatus::Pending.is_open());
        assert!(!RequestStatus::Declined.is_open());
        assert_eq!(
            RequestBackend::parse("direct_mirror"),
            Some(RequestBackend::DirectMirror)
        );
    }

    #[test]
    fn email_username_and_explicit_mapping() {
        let me = LocalUserRef {
            id: Uuid::new_v4(),
            username: "Finlay".into(),
            email: Some("F@Example.com".into()),
        };
        let others = [
            ext("1", "someone", "x@example.com"),
            ext("2", "finlay", "f@example.com"),
        ];
        let by_email = integration(UserMappingStrategy::Email);
        assert_eq!(
            map_local_to_external(&by_email, &me, &others).unwrap().id,
            "2"
        );
        let by_name = integration(UserMappingStrategy::Username);
        assert_eq!(
            map_local_to_external(&by_name, &me, &others).unwrap().id,
            "2"
        );
        let mut explicit = integration(UserMappingStrategy::Map);
        assert!(map_local_to_external(&explicit, &me, &others).is_none());
        explicit.user_map.insert(me.id.to_string(), "1".into());
        assert_eq!(
            map_local_to_external(&explicit, &me, &others).unwrap().id,
            "1"
        );
        // explicit beats strategy
        let mut over = integration(UserMappingStrategy::Email);
        over.user_map.insert(me.id.to_string(), "1".into());
        assert_eq!(map_local_to_external(&over, &me, &others).unwrap().id, "1");
        // reverse
        let locals = [me.clone()];
        assert_eq!(
            map_external_to_local(&over, &others[0], &locals)
                .unwrap()
                .id,
            me.id
        );
        assert_eq!(
            map_external_to_local(&by_email, &others[1], &locals)
                .unwrap()
                .id,
            me.id
        );
        assert!(map_external_to_local(&by_email, &others[0], &locals).is_none());
    }

    #[test]
    fn available_never_regresses_but_declines_win() {
        use RequestStatus::*;
        assert_eq!(reconcile_status(Available, Approved), Available);
        assert_eq!(reconcile_status(Available, Pending), Available);
        assert_eq!(reconcile_status(Approved, Declined), Declined);
        assert_eq!(reconcile_status(Pending, Approved), Approved);
        assert_eq!(reconcile_status(Failed, Pending), Pending);
        assert_eq!(reconcile_status(Available, Declined), Declined);
    }

    #[test]
    fn seasons_union_and_all_absorbs() {
        assert_eq!(merge_seasons(&[2, 1], &[2, 3]), vec![1, 2, 3]);
        assert!(merge_seasons(&[], &[1]).is_empty());
    }

    #[test]
    fn api_key_prefers_environment() {
        let mut i = integration(UserMappingStrategy::Email);
        assert_eq!(i.resolve_api_key(|_| None), "k");
        i.api_key_env = Some("OMBI_KEY".into());
        assert_eq!(
            i.resolve_api_key(|n| (n == "OMBI_KEY").then(|| "from-env".to_string())),
            "from-env"
        );
        assert_eq!(i.resolve_api_key(|_| None), "k");
    }
}
