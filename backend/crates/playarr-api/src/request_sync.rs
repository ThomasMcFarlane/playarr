//! Request sync engine for the Ombi and Seerr integrations (TASKS 280-287).
//!
//! Pure of HTTP routing: it owns the PULL (import and status flow back), PUSH
//! (create as the mapped user, mirror direct adds) and admin-decision logic
//! against the repos and the [`RequestManagerClient`] trait, so conflict
//! handling is testable with mocked Ombi/Seerr servers.
//!
//! Loop avoidance: one `media_requests` row per title identity. A request
//! Playarr pushes records the external id the moment the remote accepts it, so
//! the next pull links to that row instead of importing a duplicate. Rows are
//! matched by external id first, then by any shared TMDB/TVDB/IMDb id, then by
//! the title key. Pulled (`origin` ombi/seerr) rows are never pushed anywhere.
//! A single async mutex serialises pulls and pushes, which keeps the
//! match-then-insert sequence race free.

use std::collections::HashSet;
use std::sync::Arc;

use chrono::Utc;
use playarr_arr_client::{
    NewRemoteRequest, OmbiClient, RemoteRequest, RequestManagerClient, SeerrClient,
};
use playarr_db::{MediaRequestRepo, RequestIntegrationRepo, UserRepo, WorkRepo};
use playarr_model::discovery::{identity_key, normalise_title, DiscoveryKind};
use playarr_model::requests::{
    map_external_to_local, map_local_to_external, merge_seasons, reconcile_status, ExternalUser,
    IntegrationKind, LocalUserRef, MediaRequest, RequestBackend, RequestIntegration, RequestOrigin,
    RequestStatus,
};
use playarr_model::{Availability, ExternalProvider, ExternalRef};
use uuid::Uuid;

pub const SETTING_BACKEND: &str = "backend";
const REMOTE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
/// A pull never deletes more than this many local rows in one pass unless
/// that is a minority of the rows tracked for the integration.
const MAX_REMOVALS_PER_PULL: usize = 5;

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("this title is already requested")]
    AlreadyRequested(Box<MediaRequest>),
    #[error("{0}")]
    Unmapped(String),
    #[error("no enabled {0} integration is configured")]
    NoIntegration(&'static str),
    #[error("{0}")]
    Remote(String),
    #[error("{0}")]
    Db(#[from] playarr_db::DbError),
    #[error("request not found")]
    NotFound,
}

fn remote_err(prefix: &str, e: impl std::fmt::Display) -> SyncError {
    SyncError::Remote(format!("{prefix}: {e}"))
}

/// What a caller wants requested.
#[derive(Debug, Clone)]
pub struct NewTitle {
    pub kind: DiscoveryKind,
    pub title: String,
    pub year: Option<i32>,
    pub tmdb_id: Option<i64>,
    pub tvdb_id: Option<i64>,
    pub imdb_id: Option<String>,
    pub poster_url: Option<String>,
    pub seasons: Vec<i32>,
    pub user: Option<LocalUserRef>,
    pub requester_label: Option<String>,
}

impl NewTitle {
    pub fn refs(&self) -> Vec<ExternalRef> {
        let mut refs = Vec::new();
        if let Some(i) = self.tmdb_id {
            refs.push(ExternalRef {
                provider: ExternalProvider::Tmdb,
                external_id: i.to_string(),
            });
        }
        if let Some(i) = self.tvdb_id {
            refs.push(ExternalRef {
                provider: ExternalProvider::Tvdb,
                external_id: i.to_string(),
            });
        }
        if let Some(i) = &self.imdb_id {
            refs.push(ExternalRef {
                provider: ExternalProvider::Imdb,
                external_id: i.clone(),
            });
        }
        refs
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
pub struct PullReport {
    pub fetched: usize,
    pub created: usize,
    pub updated: usize,
    pub linked: usize,
    pub removed: usize,
    pub unmapped: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Approve,
    Decline,
}

type EnvLookup = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;

pub struct RequestSync {
    pub requests: Arc<dyn MediaRequestRepo>,
    pub integrations: Arc<dyn RequestIntegrationRepo>,
    users: Arc<dyn UserRepo>,
    works: Arc<dyn WorkRepo>,
    env: EnvLookup,
    gate: tokio::sync::Mutex<()>,
}

impl RequestSync {
    pub fn new(
        requests: Arc<dyn MediaRequestRepo>,
        integrations: Arc<dyn RequestIntegrationRepo>,
        users: Arc<dyn UserRepo>,
        works: Arc<dyn WorkRepo>,
    ) -> Self {
        Self {
            requests,
            integrations,
            users,
            works,
            env: Arc::new(|name| std::env::var(name).ok()),
            gate: tokio::sync::Mutex::new(()),
        }
    }

    pub fn client(&self, i: &RequestIntegration) -> Box<dyn RequestManagerClient> {
        let key = i.resolve_api_key(|n| (self.env)(n));
        match i.kind {
            IntegrationKind::Ombi => Box::new(OmbiClient::new(&i.base_url, key)),
            IntegrationKind::Seerr => Box::new(SeerrClient::new(&i.base_url, key)),
        }
    }

    /// Declarative registration (Helm): creates an enabled integration of
    /// `kind` pointing at `url` with its key read from `key_env`, but only when
    /// none of that kind exists, so later admin edits are never overwritten.
    pub async fn ensure_declared(
        &self,
        kind: IntegrationKind,
        url: &str,
        key_env: &str,
    ) -> Result<bool, SyncError> {
        if self
            .integrations
            .list()
            .await?
            .iter()
            .any(|i| i.kind == kind)
        {
            return Ok(false);
        }
        self.integrations
            .upsert(&RequestIntegration {
                id: Uuid::new_v4(),
                kind,
                name: match kind {
                    IntegrationKind::Ombi => "Ombi".into(),
                    IntegrationKind::Seerr => "Seerr".into(),
                },
                base_url: url.trim().trim_end_matches('/').to_string(),
                api_key: playarr_model::Sensitive::new(String::new()),
                api_key_env: Some(key_env.to_string()),
                enabled: true,
                poll_interval_secs: playarr_model::requests::DEFAULT_POLL_INTERVAL_SECS,
                mapping: playarr_model::requests::UserMappingStrategy::Email,
                user_map: Default::default(),
                webhook_secret: playarr_model::Sensitive::new(format!(
                    "{}{}",
                    Uuid::new_v4().simple(),
                    Uuid::new_v4().simple()
                )),
                last_sync_at: None,
                last_error: None,
            })
            .await?;
        Ok(true)
    }

    pub async fn backend(&self) -> RequestBackend {
        self.integrations
            .get_setting(SETTING_BACKEND)
            .await
            .ok()
            .flatten()
            .and_then(|v| RequestBackend::parse(&v))
            .unwrap_or(RequestBackend::Direct)
    }

    pub async fn set_backend(&self, backend: RequestBackend) -> Result<(), SyncError> {
        self.integrations
            .set_setting(SETTING_BACKEND, backend.as_str())
            .await?;
        Ok(())
    }

    pub async fn enabled_integration(&self, kind: IntegrationKind) -> Option<RequestIntegration> {
        self.integrations
            .list()
            .await
            .ok()?
            .into_iter()
            .find(|i| i.enabled && i.kind == kind)
    }

    async fn locals(&self) -> Result<Vec<LocalUserRef>, SyncError> {
        Ok(self
            .users
            .list_all()
            .await?
            .into_iter()
            .map(|u| LocalUserRef {
                id: u.id,
                username: u.username,
                email: u.email,
            })
            .collect())
    }

    async fn remote_users(
        &self,
        client: &dyn RequestManagerClient,
    ) -> Result<Vec<ExternalUser>, SyncError> {
        tokio::time::timeout(REMOTE_TIMEOUT, client.users())
            .await
            .map_err(|_| SyncError::Remote("the request manager timed out".into()))?
            .map_err(|e| remote_err("could not list users", e))
    }

    /// Existing row for the same title, by ids then title key.
    async fn find_existing(&self, t: &NewTitle) -> Result<Option<MediaRequest>, SyncError> {
        if let Some(r) = self
            .requests
            .find_match(t.kind, t.tmdb_id, t.tvdb_id, t.imdb_id.as_deref())
            .await?
        {
            return Ok(Some(r));
        }
        let key = identity_key(t.kind, &t.title, t.year, &t.refs());
        Ok(self.requests.find_by_title_key(&key).await?)
    }

    fn new_row(&self, t: &NewTitle, origin: RequestOrigin, status: RequestStatus) -> MediaRequest {
        let now = Utc::now();
        MediaRequest {
            id: Uuid::new_v4(),
            title_key: identity_key(t.kind, &t.title, t.year, &t.refs()),
            kind: t.kind,
            title: t.title.clone(),
            year: t.year,
            tmdb_id: t.tmdb_id,
            tvdb_id: t.tvdb_id,
            imdb_id: t.imdb_id.clone(),
            poster_url: t.poster_url.clone(),
            seasons: t.seasons.clone(),
            requester_user_id: t.user.as_ref().map(|u| u.id),
            requester_label: t.requester_label.clone(),
            status,
            origin,
            ombi_request_id: None,
            seerr_request_id: None,
            direct_instance_id: None,
            status_note: None,
            created_at: now,
            updated_at: now,
        }
    }

    /// Records a request Playarr satisfied by adding the title directly to
    /// Radarr/Sonarr. Returns the existing row when the title is already
    /// tracked (a previous request or an import) after attaching the direct
    /// instance to it.
    pub async fn record_direct(
        &self,
        t: &NewTitle,
        direct_instance: Uuid,
    ) -> Result<MediaRequest, SyncError> {
        let _g = self.gate.lock().await;
        if let Some(mut existing) = self.find_existing(t).await? {
            if existing.direct_instance_id.is_none() {
                existing.direct_instance_id = Some(direct_instance);
                existing.updated_at = Utc::now();
                self.requests.upsert(&existing).await?;
            }
            return Ok(existing);
        }
        let mut row = self.new_row(t, RequestOrigin::Playarr, RequestStatus::Approved);
        row.direct_instance_id = Some(direct_instance);
        self.requests.upsert(&row).await?;
        Ok(row)
    }

    /// PUSH: creates the request in the integration as the mapped user.
    pub async fn push(
        &self,
        t: &NewTitle,
        integration: &RequestIntegration,
    ) -> Result<MediaRequest, SyncError> {
        let _g = self.gate.lock().await;
        if let Some(existing) = self.find_existing(t).await? {
            if existing.status.is_open() || existing.status == RequestStatus::Available {
                return Err(SyncError::AlreadyRequested(Box::new(existing)));
            }
        }
        let client = self.client(integration);
        let user = t
            .user
            .as_ref()
            .ok_or_else(|| SyncError::Unmapped("the requesting user is unknown".into()))?;
        let externals = self.remote_users(client.as_ref()).await?;
        let external = map_local_to_external(integration, user, &externals).ok_or_else(|| {
            SyncError::Unmapped(format!(
                "your account is not linked to a user in {}; ask an administrator to map it",
                integration.name
            ))
        })?;
        // Claim the title locally first so a concurrent duplicate cannot also
        // reach the remote (the key is unique).
        let mut row = match self.find_existing(t).await? {
            Some(old) => old,
            None => self.new_row(t, RequestOrigin::Playarr, RequestStatus::Pending),
        };
        row.status = RequestStatus::Pending;
        row.requester_user_id = Some(user.id);
        row.requester_label = t.requester_label.clone();
        row.updated_at = Utc::now();
        self.requests.upsert(&row).await?;
        let created = tokio::time::timeout(
            REMOTE_TIMEOUT,
            client.create_request(&NewRemoteRequest {
                kind: t.kind,
                title: t.title.clone(),
                tmdb_id: t.tmdb_id,
                tvdb_id: t.tvdb_id,
                seasons: t.seasons.clone(),
                on_behalf_of: Some(external.id.clone()),
            }),
        )
        .await;
        match created {
            Ok(Ok(remote)) => {
                row.set_external_id(integration.kind, Some(remote.id.clone()));
                row.status = remote.status;
                row.status_note = remote.note;
                row.updated_at = Utc::now();
                self.requests.upsert(&row).await?;
                Ok(row)
            }
            Ok(Err(e)) => {
                self.requests.delete(row.id).await?;
                Err(remote_err(
                    &format!("{} refused the request", integration.name),
                    e,
                ))
            }
            Err(_) => {
                self.requests.delete(row.id).await?;
                Err(SyncError::Remote(format!("{} timed out", integration.name)))
            }
        }
    }

    /// Mirrors a direct add into one integration as an approved request so its
    /// request list stays complete. Best effort: failures are recorded on the
    /// row and retried by [`Self::retry_mirrors`].
    pub async fn mirror(
        &self,
        row_id: Uuid,
        integration: &RequestIntegration,
    ) -> Result<(), SyncError> {
        let _g = self.gate.lock().await;
        let Some(mut row) = self.requests.get(row_id).await? else {
            return Err(SyncError::NotFound);
        };
        if row.external_id(integration.kind).is_some() {
            return Ok(());
        }
        let client = self.client(integration);
        let outcome = self
            .mirror_inner(&mut row, integration, client.as_ref())
            .await;
        match &outcome {
            Ok(()) => row.status_note = None,
            Err(e) => row.status_note = Some(format!("Mirror to {} failed: {e}", integration.name)),
        }
        row.updated_at = Utc::now();
        self.requests.upsert(&row).await?;
        outcome
    }

    async fn mirror_inner(
        &self,
        row: &mut MediaRequest,
        integration: &RequestIntegration,
        client: &dyn RequestManagerClient,
    ) -> Result<(), SyncError> {
        let externals = self.remote_users(client).await?;
        let locals = self.locals().await?;
        let on_behalf = row
            .requester_user_id
            .and_then(|id| locals.iter().find(|l| l.id == id))
            .and_then(|l| map_local_to_external(integration, l, &externals))
            .map(|e| e.id.clone());
        let remote = tokio::time::timeout(
            REMOTE_TIMEOUT,
            client.create_request(&NewRemoteRequest {
                kind: row.kind,
                title: row.title.clone(),
                tmdb_id: row.tmdb_id,
                tvdb_id: row.tvdb_id,
                seasons: row.seasons.clone(),
                on_behalf_of: on_behalf,
            }),
        )
        .await
        .map_err(|_| SyncError::Remote("timed out".into()))?
        .map_err(|e| remote_err("create failed", e))?;
        row.set_external_id(integration.kind, Some(remote.id.clone()));
        if remote.status == RequestStatus::Pending {
            // The title is already being fetched directly, so approve it
            // upstream; a failure here is not fatal (it stays pending there).
            if let Err(e) = client.approve(row.kind, &remote.id).await {
                tracing::warn!(error = %e, "requests: could not approve mirrored request");
            }
        }
        Ok(())
    }

    /// Retries mirrors that failed or were created before an integration was
    /// enabled, only while the backend mode is `direct_mirror`.
    pub async fn retry_mirrors(&self) {
        if self.backend().await != RequestBackend::DirectMirror {
            return;
        }
        let Ok(integrations) = self.integrations.list().await else {
            return;
        };
        let Ok(rows) = self.requests.list().await else {
            return;
        };
        for integration in integrations.iter().filter(|i| i.enabled) {
            for row in rows.iter().filter(|r| {
                r.origin == RequestOrigin::Playarr
                    && r.direct_instance_id.is_some()
                    && r.external_id(integration.kind).is_none()
            }) {
                if let Err(e) = self.mirror(row.id, integration).await {
                    tracing::debug!(error = %e, title = %row.title, "requests: mirror retry failed");
                }
            }
        }
    }

    /// PULL: imports and refreshes requests from one integration.
    pub async fn pull(&self, integration_id: Uuid) -> Result<PullReport, SyncError> {
        let Some(integration) = self.integrations.get(integration_id).await? else {
            return Err(SyncError::NotFound);
        };
        let _g = self.gate.lock().await;
        let client = self.client(&integration);
        let result = self.pull_inner(&integration, client.as_ref()).await;
        let (at, err) = (Utc::now(), result.as_ref().err().map(|e| e.to_string()));
        self.integrations
            .record_sync(integration.id, at, err.as_deref())
            .await?;
        result
    }

    async fn pull_inner(
        &self,
        integration: &RequestIntegration,
        client: &dyn RequestManagerClient,
    ) -> Result<PullReport, SyncError> {
        let remotes = tokio::time::timeout(REMOTE_TIMEOUT * 3, client.list_requests())
            .await
            .map_err(|_| SyncError::Remote("the request manager timed out".into()))?
            .map_err(|e| remote_err("could not list requests", e))?;
        let locals = self.locals().await?;
        let mut report = PullReport {
            fetched: remotes.len(),
            ..Default::default()
        };
        let mut seen_ids: HashSet<String> = HashSet::new();
        for group in group_remotes(remotes) {
            for r in &group.members {
                seen_ids.insert(r.id.clone());
            }
            self.apply_group(integration, client, &locals, group, &mut report)
                .await?;
        }
        report.removed = self.drop_vanished(integration, &seen_ids).await?;
        Ok(report)
    }

    async fn apply_group(
        &self,
        integration: &RequestIntegration,
        client: &dyn RequestManagerClient,
        locals: &[LocalUserRef],
        group: RemoteGroup,
        report: &mut PullReport,
    ) -> Result<(), SyncError> {
        let primary = group.primary().clone();
        let mut existing = None;
        for m in &group.members {
            if let Some(r) = self
                .requests
                .find_by_external(integration.kind, &m.id)
                .await?
            {
                existing = Some(r);
                break;
            }
        }
        if existing.is_none() {
            existing = self
                .requests
                .find_match(
                    primary.kind,
                    group.tmdb_id(),
                    group.tvdb_id(),
                    group.imdb_id().as_deref(),
                )
                .await?;
        }
        let incoming = group.status();
        if let Some(mut row) = existing {
            let before = row.clone();
            let tracked_in_group = row
                .external_id(integration.kind)
                .is_some_and(|id| group.members.iter().any(|m| m.id == id));
            if !tracked_in_group {
                if row.external_id(integration.kind).is_none() {
                    report.linked += 1;
                }
                row.set_external_id(integration.kind, Some(primary.id.clone()));
            }
            row.status = reconcile_status(row.status, incoming);
            row.seasons = if row.kind == DiscoveryKind::Series {
                merge_seasons(&row.seasons, &group.seasons())
            } else {
                Vec::new()
            };
            row.tmdb_id = row.tmdb_id.or(group.tmdb_id());
            row.tvdb_id = row.tvdb_id.or(group.tvdb_id());
            row.imdb_id = row.imdb_id.clone().or(group.imdb_id());
            if row.poster_url.is_none() {
                row.poster_url = primary.poster_url.clone();
            }
            row.status_note = primary
                .note
                .clone()
                .filter(|_| row.status == RequestStatus::Declined);
            if row != before {
                row.updated_at = Utc::now();
                self.requests.upsert(&row).await?;
                report.updated += 1;
            }
            return Ok(());
        }
        // New to Playarr: import it.
        let (mut title, mut year, mut poster) = (
            primary.title.clone(),
            primary.year,
            primary.poster_url.clone(),
        );
        if title.is_empty() {
            if let Some(tmdb) = primary.tmdb_id {
                if let Ok(Ok(info)) =
                    tokio::time::timeout(REMOTE_TIMEOUT, client.title_info(primary.kind, tmdb))
                        .await
                {
                    title = info.title;
                    year = year.or(info.year);
                    poster = poster.or(info.poster_url);
                }
            }
        }
        if title.is_empty() {
            title = format!(
                "TMDB {}",
                primary.tmdb_id.or(primary.tvdb_id).unwrap_or_default()
            );
        }
        let local = primary
            .requester
            .as_ref()
            .and_then(|e| map_external_to_local(integration, e, locals));
        if primary.requester.is_some() && local.is_none() {
            report.unmapped += 1;
        }
        let label = primary.requester.as_ref().and_then(|e| {
            e.display_name
                .clone()
                .or_else(|| e.username.clone())
                .or_else(|| e.email.clone())
        });
        let t = NewTitle {
            kind: primary.kind,
            title,
            year,
            tmdb_id: group.tmdb_id(),
            tvdb_id: group.tvdb_id(),
            imdb_id: group.imdb_id(),
            poster_url: poster,
            seasons: group.seasons(),
            user: local.cloned(),
            requester_label: label,
        };
        let mut row = self.new_row(&t, integration.kind.origin(), incoming);
        row.set_external_id(integration.kind, Some(primary.id.clone()));
        if let Some(at) = primary.created_at {
            row.created_at = at;
        }
        row.status_note = primary
            .note
            .clone()
            .filter(|_| incoming == RequestStatus::Declined);
        // Two remote titles can share a title key when both lack ids; the
        // unique key makes the second attach to the first instead.
        if let Some(mut clash) = self.requests.find_by_title_key(&row.title_key).await? {
            clash.set_external_id(integration.kind, Some(primary.id.clone()));
            clash.updated_at = Utc::now();
            self.requests.upsert(&clash).await?;
            report.linked += 1;
            return Ok(());
        }
        self.requests.upsert(&row).await?;
        report.created += 1;
        Ok(())
    }

    /// Rows tracked for this integration that its list no longer contains were
    /// removed there: delete rows that exist nowhere else, otherwise just clear
    /// the stale link.
    async fn drop_vanished(
        &self,
        integration: &RequestIntegration,
        seen: &HashSet<String>,
    ) -> Result<usize, SyncError> {
        let rows = self.requests.list().await?;
        let stale: Vec<MediaRequest> = rows
            .into_iter()
            .filter(|r| {
                r.external_id(integration.kind)
                    .is_some_and(|id| !seen.contains(id))
            })
            .collect();
        if stale.is_empty() {
            return Ok(0);
        }
        let tracked = seen.len() + stale.len();
        if stale.len() > MAX_REMOVALS_PER_PULL && stale.len() * 2 > tracked {
            tracing::warn!(
                integration = %integration.name,
                stale = stale.len(),
                "requests: refusing to unlink most tracked requests in one pull"
            );
            return Ok(0);
        }
        let mut removed = 0;
        for mut row in stale {
            row.set_external_id(integration.kind, None);
            let other = match integration.kind {
                IntegrationKind::Ombi => row.seerr_request_id.is_some(),
                IntegrationKind::Seerr => row.ombi_request_id.is_some(),
            };
            let exists_elsewhere = other || row.direct_instance_id.is_some();
            if exists_elsewhere {
                row.status_note = Some(format!("Removed from {}", integration.name));
                row.updated_at = Utc::now();
                self.requests.upsert(&row).await?;
            } else {
                self.requests.delete(row.id).await?;
                removed += 1;
            }
        }
        Ok(removed)
    }

    /// Marks open requests whose title is now playable in the library as
    /// available, and tells Ombi so its list matches.
    pub async fn refresh_availability(&self) {
        let Ok(rows) = self.requests.list().await else {
            return;
        };
        for mut row in rows
            .into_iter()
            .filter(|r| matches!(r.status, RequestStatus::Pending | RequestStatus::Approved))
        {
            if !self.library_has(&row).await {
                continue;
            }
            row.status = RequestStatus::Available;
            row.updated_at = Utc::now();
            if self.requests.upsert(&row).await.is_err() {
                continue;
            }
            if let (Some(id), Some(i)) = (
                row.ombi_request_id.clone(),
                self.enabled_integration(IntegrationKind::Ombi).await,
            ) {
                let client = self.client(&i);
                if let Err(e) = client.mark_available(row.kind, &id).await {
                    tracing::debug!(error = %e, "requests: could not mark available in Ombi");
                }
            }
        }
    }

    async fn library_has(&self, row: &MediaRequest) -> bool {
        let mut refs = Vec::new();
        if let Some(i) = row.tmdb_id {
            refs.push((ExternalProvider::Tmdb, i.to_string()));
        }
        if let Some(i) = row.tvdb_id {
            refs.push((ExternalProvider::Tvdb, i.to_string()));
        }
        if let Some(i) = &row.imdb_id {
            refs.push((ExternalProvider::Imdb, i.clone()));
        }
        for (provider, id) in refs {
            if let Ok(Some(work)) = self.works.find_by_external_ref(&provider, &id).await {
                if DiscoveryKind::from(work.kind) == row.kind
                    && work.availability == Availability::Available
                {
                    return true;
                }
            }
        }
        false
    }

    /// Administrator approve/decline: pushed to every system that tracks the
    /// request, then recorded locally.
    pub async fn decide(
        &self,
        id: Uuid,
        decision: Decision,
        reason: Option<&str>,
    ) -> Result<MediaRequest, SyncError> {
        let _g = self.gate.lock().await;
        let Some(mut row) = self.requests.get(id).await? else {
            return Err(SyncError::NotFound);
        };
        for kind in [IntegrationKind::Ombi, IntegrationKind::Seerr] {
            let (Some(ext), Some(i)) = (
                row.external_id(kind).map(str::to_string),
                self.integrations
                    .list()
                    .await?
                    .into_iter()
                    .find(|i| i.kind == kind && i.enabled),
            ) else {
                continue;
            };
            let client = self.client(&i);
            let r = match decision {
                Decision::Approve => client.approve(row.kind, &ext).await,
                Decision::Decline => client.decline(row.kind, &ext, reason).await,
            };
            r.map_err(|e| remote_err(&format!("{} rejected the change", i.name), e))?;
        }
        row.status = match decision {
            Decision::Approve => RequestStatus::Approved,
            Decision::Decline => RequestStatus::Declined,
        };
        row.status_note = reason
            .map(str::to_string)
            .filter(|_| decision == Decision::Decline);
        row.updated_at = Utc::now();
        self.requests.upsert(&row).await?;
        Ok(row)
    }

    /// Removes a request here and in every system that tracks it. A direct
    /// Radarr/Sonarr add is left alone (removing the title there is a library
    /// decision, not a request decision).
    pub async fn remove(&self, id: Uuid) -> Result<(), SyncError> {
        let _g = self.gate.lock().await;
        let Some(row) = self.requests.get(id).await? else {
            return Err(SyncError::NotFound);
        };
        for kind in [IntegrationKind::Ombi, IntegrationKind::Seerr] {
            let (Some(ext), Some(i)) = (
                row.external_id(kind).map(str::to_string),
                self.integrations
                    .list()
                    .await?
                    .into_iter()
                    .find(|i| i.kind == kind && i.enabled),
            ) else {
                continue;
            };
            let client = self.client(&i);
            client
                .remove(row.kind, &ext)
                .await
                .map_err(|e| remote_err(&format!("{} could not remove it", i.name), e))?;
        }
        self.requests.delete(id).await?;
        Ok(())
    }

    /// One scheduler pass: pull every due integration, retry mirrors, refresh
    /// availability. `last_pulled` tracks when each integration last ran.
    pub async fn run_once(
        &self,
        last_pulled: &mut std::collections::HashMap<Uuid, std::time::Instant>,
    ) {
        let Ok(list) = self.integrations.list().await else {
            return;
        };
        for i in list.into_iter().filter(|i| i.enabled) {
            let every = std::time::Duration::from_secs(u64::from(
                i.poll_interval_secs
                    .max(playarr_model::requests::MIN_POLL_INTERVAL_SECS),
            ));
            if last_pulled.get(&i.id).is_some_and(|t| t.elapsed() < every) {
                continue;
            }
            last_pulled.insert(i.id, std::time::Instant::now());
            match self.pull(i.id).await {
                Ok(r) => tracing::debug!(integration = %i.name, ?r, "requests: pulled"),
                Err(e) => {
                    tracing::warn!(integration = %i.name, error = %e, "requests: pull failed")
                }
            }
        }
        self.retry_mirrors().await;
        self.refresh_availability().await;
    }
}

/// Remote requests describing one title.
pub(crate) struct RemoteGroup {
    pub members: Vec<RemoteRequest>,
}

impl RemoteGroup {
    /// The earliest request (the one whose requester the title is attributed to).
    fn primary(&self) -> &RemoteRequest {
        self.members
            .iter()
            .min_by_key(|m| (m.created_at, m.id.parse::<i64>().unwrap_or(i64::MAX)))
            .expect("a group has at least one member")
    }
    fn tmdb_id(&self) -> Option<i64> {
        self.members.iter().find_map(|m| m.tmdb_id)
    }
    fn tvdb_id(&self) -> Option<i64> {
        self.members.iter().find_map(|m| m.tvdb_id)
    }
    fn imdb_id(&self) -> Option<String> {
        self.members.iter().find_map(|m| m.imdb_id.clone())
    }
    fn seasons(&self) -> Vec<i32> {
        let mut acc: Option<Vec<i32>> = None;
        for m in &self.members {
            acc = Some(match acc {
                None => m.seasons.clone(),
                Some(a) => merge_seasons(&a, &m.seasons),
            });
        }
        acc.unwrap_or_default()
    }
    /// Declined/available/failed only when every member agrees; any approved
    /// or available member makes the title approved, else pending.
    fn status(&self) -> RequestStatus {
        let all = |s: RequestStatus| self.members.iter().all(|m| m.status == s);
        if all(RequestStatus::Available) {
            RequestStatus::Available
        } else if all(RequestStatus::Declined) {
            RequestStatus::Declined
        } else if all(RequestStatus::Failed) {
            RequestStatus::Failed
        } else if self
            .members
            .iter()
            .any(|m| matches!(m.status, RequestStatus::Approved | RequestStatus::Available))
        {
            RequestStatus::Approved
        } else {
            RequestStatus::Pending
        }
    }
}

fn same_title(a: &RemoteRequest, b: &RemoteRequest) -> bool {
    if a.kind != b.kind {
        return false;
    }
    let ids = (a.tmdb_id.is_some() && a.tmdb_id == b.tmdb_id)
        || (a.tvdb_id.is_some() && a.tvdb_id == b.tvdb_id)
        || (a.imdb_id.is_some() && a.imdb_id == b.imdb_id);
    if ids {
        return true;
    }
    let has_ids =
        |r: &RemoteRequest| r.tmdb_id.is_some() || r.tvdb_id.is_some() || r.imdb_id.is_some();
    !has_ids(a)
        && !has_ids(b)
        && !a.title.is_empty()
        && normalise_title(&a.title) == normalise_title(&b.title)
        && a.year == b.year
}

pub(crate) fn group_remotes(remotes: Vec<RemoteRequest>) -> Vec<RemoteGroup> {
    let mut groups: Vec<RemoteGroup> = Vec::new();
    for r in remotes {
        match groups
            .iter_mut()
            .find(|g| g.members.iter().any(|m| same_title(m, &r)))
        {
            Some(g) => g.members.push(r),
            None => groups.push(RemoteGroup { members: vec![r] }),
        }
    }
    groups
}

/// Background scheduler: wakes every few seconds and pulls whichever
/// integrations are due (each has its own poll interval).
pub async fn run_scheduler(sync: Arc<RequestSync>) {
    let mut last = std::collections::HashMap::new();
    loop {
        sync.run_once(&mut last).await;
        tokio::time::sleep(std::time::Duration::from_secs(15)).await;
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use playarr_model::requests::UserMappingStrategy;
    use playarr_model::Sensitive;
    use serde_json::{json, Value};
    use wiremock::matchers::{body_partial_json, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::test_support::{seed_streaming_user, test_state};

    fn integration(
        kind: IntegrationKind,
        url: &str,
        user_map: BTreeMap<String, String>,
    ) -> RequestIntegration {
        RequestIntegration {
            id: Uuid::new_v4(),
            kind,
            name: format!("{kind:?}"),
            base_url: url.to_string(),
            api_key: Sensitive::new("key".into()),
            api_key_env: None,
            enabled: true,
            poll_interval_secs: 60,
            mapping: UserMappingStrategy::Map,
            user_map,
            webhook_secret: Sensitive::new("s".into()),
            last_sync_at: None,
            last_error: None,
        }
    }

    fn ombi_movie(
        id: i64,
        tmdb: i64,
        approved: bool,
        denied: bool,
        available: bool,
        user: &str,
    ) -> Value {
        json!({"id": id, "theMovieDbId": tmdb, "title": format!("Movie {tmdb}"), "releaseDate": "2020-01-01T00:00:00Z",
            "approved": approved, "denied": denied, "available": available, "requestedDate": "2026-01-01T00:00:00Z",
            "requestedUserId": user, "requestedUser": {"id": user, "userName": "ext", "emailAddress": "e@example.com"}})
    }

    async fn serve_ombi(server: &MockServer, movies: Vec<Value>) {
        server.reset().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/Request/movie"))
            .respond_with(ResponseTemplate::new(200).set_body_json(Value::Array(movies)))
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/Request/tv"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/Identity/Users"))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                json!([{"id": "ou1", "userName": "ext", "emailAddress": "e@example.com"}]),
            ))
            .mount(server)
            .await;
    }

    struct Fx {
        app: crate::AppState,
        user: Uuid,
        integ: RequestIntegration,
    }

    async fn fixture(server: &MockServer, kind: IntegrationKind) -> Fx {
        let (_router, state) = test_state().await;
        let user = Uuid::new_v4();
        seed_streaming_user(&state, user).await;
        let mut map = BTreeMap::new();
        map.insert(user.to_string(), "ou1".to_string());
        let integ = integration(kind, &server.uri(), map);
        state
            .app
            .request_sync
            .integrations
            .upsert(&integ)
            .await
            .unwrap();
        Fx {
            app: state.app,
            user,
            integ,
        }
    }

    fn title(tmdb: i64, user: Uuid) -> NewTitle {
        NewTitle {
            kind: DiscoveryKind::Movie,
            title: format!("Movie {tmdb}"),
            year: Some(2020),
            tmdb_id: Some(tmdb),
            tvdb_id: None,
            imdb_id: None,
            poster_url: None,
            seasons: vec![],
            user: Some(LocalUserRef {
                id: user,
                username: "u".into(),
                email: None,
            }),
            requester_label: Some("Test".into()),
        }
    }

    #[tokio::test]
    async fn pull_imports_maps_requester_and_is_idempotent() {
        let server = MockServer::start().await;
        let fx = fixture(&server, IntegrationKind::Ombi).await;
        serve_ombi(
            &server,
            vec![
                ombi_movie(1, 100, true, false, false, "ou1"),
                ombi_movie(2, 200, false, false, false, "stranger"),
            ],
        )
        .await;
        let sync = &fx.app.request_sync;
        let r = sync.pull(fx.integ.id).await.unwrap();
        assert_eq!((r.fetched, r.created, r.unmapped), (2, 2, 1));
        let rows = sync.requests.list().await.unwrap();
        let mapped = rows.iter().find(|r| r.tmdb_id == Some(100)).unwrap();
        assert_eq!(mapped.requester_user_id, Some(fx.user));
        assert_eq!(mapped.status, RequestStatus::Approved);
        assert_eq!(mapped.origin, RequestOrigin::Ombi);
        let other = rows.iter().find(|r| r.tmdb_id == Some(200)).unwrap();
        assert!(other.requester_user_id.is_none());
        assert_eq!(other.status, RequestStatus::Pending);
        let again = sync.pull(fx.integ.id).await.unwrap();
        assert_eq!((again.created, again.updated, again.linked), (0, 0, 0));
        assert_eq!(sync.requests.list().await.unwrap().len(), 2);
        assert!(sync
            .integrations
            .get(fx.integ.id)
            .await
            .unwrap()
            .unwrap()
            .last_sync_at
            .is_some());
    }

    #[tokio::test]
    async fn status_flows_back_and_available_never_regresses() {
        let server = MockServer::start().await;
        let fx = fixture(&server, IntegrationKind::Ombi).await;
        let sync = &fx.app.request_sync;
        serve_ombi(
            &server,
            vec![ombi_movie(1, 100, false, false, false, "ou1")],
        )
        .await;
        sync.pull(fx.integ.id).await.unwrap();
        serve_ombi(&server, vec![ombi_movie(1, 100, true, false, false, "ou1")]).await;
        assert_eq!(sync.pull(fx.integ.id).await.unwrap().updated, 1);
        assert_eq!(
            sync.requests.list().await.unwrap()[0].status,
            RequestStatus::Approved
        );
        serve_ombi(&server, vec![ombi_movie(1, 100, false, true, false, "ou1")]).await;
        sync.pull(fx.integ.id).await.unwrap();
        assert_eq!(
            sync.requests.list().await.unwrap()[0].status,
            RequestStatus::Declined
        );
        // library says available locally; a later "approved" upstream must not undo it
        let mut row = sync.requests.list().await.unwrap().remove(0);
        row.status = RequestStatus::Available;
        sync.requests.upsert(&row).await.unwrap();
        serve_ombi(&server, vec![ombi_movie(1, 100, true, false, false, "ou1")]).await;
        sync.pull(fx.integ.id).await.unwrap();
        assert_eq!(
            sync.requests.list().await.unwrap()[0].status,
            RequestStatus::Available
        );
    }

    #[tokio::test]
    async fn push_creates_as_mapped_user_then_pull_links_instead_of_duplicating() {
        let server = MockServer::start().await;
        let fx = fixture(&server, IntegrationKind::Ombi).await;
        let sync = &fx.app.request_sync;
        serve_ombi(
            &server,
            vec![ombi_movie(7, 300, false, false, false, "ou1")],
        )
        .await;
        Mock::given(method("POST"))
            .and(path("/api/v1/Request/movie"))
            .and(body_partial_json(
                json!({"theMovieDbId": 300, "requestOnBehalf": "ou1"}),
            ))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!({"result": true, "isError": false})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let row = sync.push(&title(300, fx.user), &fx.integ).await.unwrap();
        assert_eq!(row.ombi_request_id.as_deref(), Some("7"));
        assert_eq!(row.origin, RequestOrigin::Playarr);
        assert_eq!(row.requester_user_id, Some(fx.user));
        let pulled = sync.pull(fx.integ.id).await.unwrap();
        assert_eq!((pulled.created, pulled.linked), (0, 0));
        assert_eq!(sync.requests.list().await.unwrap().len(), 1);
        // pushing the same title again is refused without touching the remote (expect(1) above)
        let err = sync
            .push(&title(300, fx.user), &fx.integ)
            .await
            .unwrap_err();
        assert!(matches!(err, SyncError::AlreadyRequested(_)));
    }

    #[tokio::test]
    async fn push_for_unmapped_user_or_refusal_leaves_no_row() {
        let server = MockServer::start().await;
        let fx = fixture(&server, IntegrationKind::Ombi).await;
        let sync = &fx.app.request_sync;
        serve_ombi(&server, vec![]).await;
        let stranger = Uuid::new_v4();
        let err = sync.push(&title(1, stranger), &fx.integ).await.unwrap_err();
        assert!(matches!(err, SyncError::Unmapped(_)), "{err}");
        Mock::given(method("POST"))
            .and(path("/api/v1/Request/movie"))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                json!({"result": false, "isError": true, "errorMessage": "quota reached"}),
            ))
            .mount(&server)
            .await;
        let err = sync.push(&title(2, fx.user), &fx.integ).await.unwrap_err();
        assert!(err.to_string().contains("quota reached"), "{err}");
        assert!(sync.requests.list().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn same_title_in_ombi_and_seerr_is_one_row_with_both_ids() {
        let ombi = MockServer::start().await;
        let fx = fixture(&ombi, IntegrationKind::Ombi).await;
        serve_ombi(&ombi, vec![ombi_movie(1, 603, true, false, false, "ou1")]).await;
        let seerr = MockServer::start().await;
        Mock::given(method("GET")).and(path("/api/v1/request"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"results": [
                {"id": 11, "status": 2, "type": "movie", "media": {"tmdbId": 603, "status": 3}, "requestedBy": {"id": 5, "username": "x"}}]})))
            .mount(&seerr).await;
        Mock::given(method("GET"))
            .and(path("/api/v1/user"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"results": []})))
            .mount(&seerr)
            .await;
        let seerr_i = integration(IntegrationKind::Seerr, &seerr.uri(), BTreeMap::new());
        let sync = &fx.app.request_sync;
        sync.integrations.upsert(&seerr_i).await.unwrap();
        sync.pull(fx.integ.id).await.unwrap();
        let r = sync.pull(seerr_i.id).await.unwrap();
        assert_eq!((r.created, r.linked), (0, 1));
        let rows = sync.requests.list().await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].ombi_request_id.as_deref(), Some("1"));
        assert_eq!(rows[0].seerr_request_id.as_deref(), Some("11"));
    }

    #[tokio::test]
    async fn tv_children_of_one_show_collapse_into_one_row() {
        let server = MockServer::start().await;
        let fx = fixture(&server, IntegrationKind::Ombi).await;
        server.reset().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/Request/movie"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/Identity/Users"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;
        Mock::given(method("GET")).and(path("/api/v1/Request/tv")).respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {"tvDbId": 5, "externalProviderId": 50, "title": "Show", "releaseDate": "2020-01-01T00:00:00Z", "childRequests": [
                {"id": 1, "approved": false, "denied": true, "available": false, "requestedDate": "2026-01-01T00:00:00Z", "requestedUserId": "ou1", "seasonRequests": [{"seasonNumber": 1}]},
                {"id": 2, "approved": true, "denied": false, "available": false, "requestedDate": "2026-02-01T00:00:00Z", "requestedUserId": "ou1", "seasonRequests": [{"seasonNumber": 2}]}]}]))).mount(&server).await;
        fx.app.request_sync.pull(fx.integ.id).await.unwrap();
        let rows = fx.app.request_sync.requests.list().await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, RequestStatus::Approved);
        assert_eq!(rows[0].seasons, vec![1, 2]);
        assert_eq!(rows[0].ombi_request_id.as_deref(), Some("1"));
    }

    #[tokio::test]
    async fn vanished_requests_are_removed_unless_tracked_elsewhere() {
        let server = MockServer::start().await;
        let fx = fixture(&server, IntegrationKind::Ombi).await;
        let sync = &fx.app.request_sync;
        serve_ombi(
            &server,
            vec![
                ombi_movie(1, 100, true, false, false, "ou1"),
                ombi_movie(2, 200, true, false, false, "ou1"),
            ],
        )
        .await;
        sync.pull(fx.integ.id).await.unwrap();
        // 200 is also a direct add
        let mut r200 = sync
            .requests
            .find_match(DiscoveryKind::Movie, Some(200), None, None)
            .await
            .unwrap()
            .unwrap();
        r200.direct_instance_id = Some(Uuid::new_v4());
        sync.requests.upsert(&r200).await.unwrap();
        serve_ombi(&server, vec![]).await;
        let r = sync.pull(fx.integ.id).await.unwrap();
        assert_eq!(r.removed, 1);
        let rows = sync.requests.list().await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].tmdb_id, Some(200));
        assert!(rows[0].ombi_request_id.is_none());
        assert!(rows[0]
            .status_note
            .as_deref()
            .unwrap_or("")
            .contains("Removed"));
    }

    #[tokio::test]
    async fn direct_add_is_mirrored_approved_and_failures_are_recorded_then_retried() {
        let server = MockServer::start().await;
        let fx = fixture(&server, IntegrationKind::Ombi).await;
        let sync = &fx.app.request_sync;
        let row = sync
            .record_direct(&title(400, fx.user), Uuid::new_v4())
            .await
            .unwrap();
        assert_eq!(row.status, RequestStatus::Approved);
        // remote down -> failure noted on the row
        serve_ombi(&server, vec![]).await;
        Mock::given(method("POST"))
            .and(path("/api/v1/Request/movie"))
            .respond_with(ResponseTemplate::new(500))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        assert!(sync.mirror(row.id, &fx.integ).await.is_err());
        let noted = sync.requests.get(row.id).await.unwrap().unwrap();
        assert!(noted.status_note.unwrap().contains("Mirror to"));
        // remote healthy -> retry mirrors and approves
        server.reset().await;
        serve_ombi(
            &server,
            vec![ombi_movie(9, 400, false, false, false, "ou1")],
        )
        .await;
        Mock::given(method("POST"))
            .and(path("/api/v1/Request/movie"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!({"result": true, "isError": false})),
            )
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/v1/Request/movie/approve"))
            .and(body_partial_json(json!({"id": 9})))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!({"result": true, "isError": false})),
            )
            .expect(1)
            .mount(&server)
            .await;
        sync.set_backend(RequestBackend::DirectMirror)
            .await
            .unwrap();
        sync.retry_mirrors().await;
        let done = sync.requests.get(row.id).await.unwrap().unwrap();
        assert_eq!(done.ombi_request_id.as_deref(), Some("9"));
        assert!(done.status_note.is_none());
        assert_eq!(done.origin, RequestOrigin::Playarr);
        // a second retry does nothing (idempotent: create expected exactly once)
        sync.retry_mirrors().await;
    }

    #[tokio::test]
    async fn admin_decision_and_removal_are_pushed_upstream() {
        let server = MockServer::start().await;
        let fx = fixture(&server, IntegrationKind::Ombi).await;
        let sync = &fx.app.request_sync;
        serve_ombi(
            &server,
            vec![ombi_movie(1, 100, false, false, false, "ou1")],
        )
        .await;
        sync.pull(fx.integ.id).await.unwrap();
        let id = sync.requests.list().await.unwrap()[0].id;
        Mock::given(method("PUT"))
            .and(path("/api/v1/Request/movie/deny"))
            .and(body_partial_json(json!({"id": 1, "reason": "nope"})))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"result": true})))
            .expect(1)
            .mount(&server)
            .await;
        let d = sync
            .decide(id, Decision::Decline, Some("nope"))
            .await
            .unwrap();
        assert_eq!(d.status, RequestStatus::Declined);
        assert_eq!(d.status_note.as_deref(), Some("nope"));
        Mock::given(method("DELETE"))
            .and(path("/api/v1/Request/movie/1"))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;
        sync.remove(id).await.unwrap();
        assert!(sync.requests.list().await.unwrap().is_empty());
        // upstream refusal leaves local state unchanged
        serve_ombi(
            &server,
            vec![ombi_movie(1, 100, false, false, false, "ou1")],
        )
        .await;
        sync.pull(fx.integ.id).await.unwrap();
        let id = sync.requests.list().await.unwrap()[0].id;
        Mock::given(method("POST"))
            .and(path("/api/v1/Request/movie/approve"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;
        assert!(sync.decide(id, Decision::Approve, None).await.is_err());
        assert_eq!(
            sync.requests.get(id).await.unwrap().unwrap().status,
            RequestStatus::Pending
        );
    }
}
