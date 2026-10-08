//! Household and child controls on the API surface
//! (`docs/architecture/household-controls.md`): the shared state and
//! enforcement helpers every route reuses, plus the `/api/v1/household/*`
//! status and guardian-approval routes.
//!
//! Enforcement is deliberately not in the handlers' own business logic: the
//! extractors (`StreamingUser`, `CatalogViewer`, `resolve_streaming_access`)
//! call [`HouseholdState::ensure_time_allowed`], the catalog takes a
//! [`HouseholdGate`] as a [`playarr_catalog::WorkGate`], and the media routes
//! call [`HouseholdState::ensure_media_file_allowed`]. Nothing here trusts a
//! client-supplied clock, profile or timezone.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration as StdDuration, Instant};

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{DateTime, Duration, Utc};
use dashmap::DashMap;
use playarr_auth::household::{
    content_decision, local_day, time_decision, ContentDecision, TimeDecision, TimeOverrides,
};
use playarr_auth::PasswordVerifier;
use playarr_catalog::WorkGate;
use playarr_db::{ApprovalRepo, HouseholdUsageRepo, PinAttemptRepo};
use playarr_model::{Approval, ApprovalKind, ApprovalStatus, MediaFile, Policy, Work};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::{forbidden, resolve_policy, AnytimeStreamingUser};
use crate::error::ApiError;
use crate::AppState;

/// Source of "now". Production uses the system clock; tests substitute a
/// settable one to cross schedule, budget and approval boundaries.
pub trait Clock: Send + Sync {
    fn now(&self) -> DateTime<Utc>;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

/// A settable clock for tests.
pub struct FixedClock(Mutex<DateTime<Utc>>);

impl FixedClock {
    pub fn new(now: DateTime<Utc>) -> Self {
        Self(Mutex::new(now))
    }

    pub fn set(&self, now: DateTime<Utc>) {
        *self.0.lock().expect("clock lock") = now;
    }

    pub fn advance(&self, by: Duration) {
        let mut guard = self.0.lock().expect("clock lock");
        *guard += by;
    }
}

impl Clock for FixedClock {
    fn now(&self) -> DateTime<Utc> {
        *self.0.lock().expect("clock lock")
    }
}

/// Seconds of served media counted per request at most (a request after a
/// longer gap counts as a fresh burst, so seeks and idle pauses are not
/// over-charged).
const MAX_CHARGE_GAP_SECONDS: i64 = 30;
/// Usage is written to the database once this many seconds accumulate.
const FLUSH_SECONDS: i64 = 10;
const WORK_TAG_CACHE_TTL: StdDuration = StdDuration::from_secs(30);

/// PIN failures before a lockout starts, per (caller, target) pair and for
/// all callers against one target.
const PIN_PAIR_THRESHOLD: u32 = 5;
const PIN_TARGET_THRESHOLD: u32 = 20;
const PIN_MAX_LOCK_SECONDS: i64 = 3600;

/// Maximum pending approval requests per profile.
const MAX_PENDING_APPROVALS: usize = 20;
const REQUEST_TTL_MINUTES: i64 = 15;
const MAX_GRANT_MINUTES: u32 = 240;
/// Default lifetime of a granted approval, in minutes.
const DEFAULT_GRANT_MINUTES: u32 = 60;

#[derive(Debug)]
struct Pending {
    day: String,
    last_served: DateTime<Utc>,
    unflushed: i64,
}

pub struct HouseholdState {
    usage: Arc<dyn HouseholdUsageRepo>,
    approvals: Arc<dyn ApprovalRepo>,
    pins: Arc<dyn PinAttemptRepo>,
    clock: Arc<dyn Clock>,
    pending: DashMap<Uuid, Pending>,
    tags: DashMap<Uuid, (Instant, Vec<String>)>,
}

/// Resolved time state for a profile at one instant.
#[derive(Debug, Clone, Copy)]
pub struct TimeState {
    pub decision: TimeDecision,
    pub now: DateTime<Utc>,
}

impl HouseholdState {
    pub fn new(
        usage: Arc<dyn HouseholdUsageRepo>,
        approvals: Arc<dyn ApprovalRepo>,
        pins: Arc<dyn PinAttemptRepo>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            usage,
            approvals,
            pins,
            clock,
            pending: DashMap::new(),
            tags: DashMap::new(),
        }
    }

    pub fn now(&self) -> DateTime<Utc> {
        self.clock.now()
    }

    pub fn approvals(&self) -> &Arc<dyn ApprovalRepo> {
        &self.approvals
    }

    async fn used_today(&self, user_id: Uuid, policy: &Policy, now: DateTime<Utc>) -> i64 {
        let day = local_day(&policy.household, now).to_string();
        let stored = self
            .usage
            .seconds_for_day(user_id, &day)
            .await
            .unwrap_or_else(|error| {
                // Fail closed on a budget: an unreadable counter must not
                // grant unlimited time.
                tracing::warn!(%user_id, %error, "household usage lookup failed; treating budget as spent");
                i64::MAX / 4
            });
        let unflushed = self
            .pending
            .get(&user_id)
            .filter(|p| p.day == day)
            .map(|p| p.unflushed)
            .unwrap_or(0);
        stored.saturating_add(unflushed)
    }

    async fn overrides(&self, user_id: Uuid, now: DateTime<Utc>) -> TimeOverrides {
        let grants = self
            .approvals
            .active_grants(user_id, ApprovalKind::Time, now)
            .await
            .unwrap_or_default();
        let mut overrides = TimeOverrides::default();
        for grant in grants {
            match grant.subject.as_str() {
                "budget" => overrides.bonus_seconds += grant.bonus_seconds.max(0),
                "schedule" => {
                    overrides.schedule_waived_until =
                        overrides.schedule_waived_until.max(grant.grant_expires_at);
                }
                _ => {}
            }
        }
        overrides
    }

    /// The current time decision for `user_id` under `policy`, with active
    /// guardian time approvals applied only when they matter.
    pub async fn time_state(&self, policy: &Policy, user_id: Uuid) -> TimeState {
        let now = self.clock.now();
        let used = if policy.household.daily_budget_minutes.is_some() && !policy.is_admin {
            self.used_today(user_id, policy, now).await
        } else {
            0
        };
        let base = time_decision(policy, now, used, TimeOverrides::default());
        if base.is_allowed() {
            return TimeState {
                decision: base,
                now,
            };
        }
        let overrides = self.overrides(user_id, now).await;
        TimeState {
            decision: time_decision(policy, now, used, overrides),
            now,
        }
    }

    /// Err(403 `household_blocked`) when the profile is outside its
    /// schedule or out of budget. Admins and unconfigured profiles pass
    /// without any I/O.
    pub async fn ensure_time_allowed(
        &self,
        policy: &Policy,
        user_id: Uuid,
    ) -> Result<(), ApiError> {
        if policy.is_admin
            || (policy.access_schedule.is_none() && policy.household.daily_budget_minutes.is_none())
        {
            return Ok(());
        }
        let state = self.time_state(policy, user_id).await;
        blocked_error(state.decision)
    }

    /// Counts served media against the profile's daily budget. Called by
    /// the media-delivery routes; a no-op for profiles without a budget.
    pub async fn record_served(&self, policy: &Policy, user_id: Uuid) {
        if policy.is_admin || policy.household.daily_budget_minutes.is_none() {
            return;
        }
        let now = self.clock.now();
        let day = local_day(&policy.household, now).to_string();
        let flush = {
            let mut entry = self.pending.entry(user_id).or_insert_with(|| Pending {
                day: day.clone(),
                last_served: now - Duration::seconds(MAX_CHARGE_GAP_SECONDS + 1),
                unflushed: 0,
            });
            let gap = (now - entry.last_served).num_seconds();
            entry.last_served = now;
            let (flush_day, flush_seconds) = if entry.day != day {
                // Day rolled over: write the old day's remainder first.
                let old = (entry.day.clone(), entry.unflushed);
                entry.day = day.clone();
                entry.unflushed = 0;
                old
            } else {
                (day.clone(), 0)
            };
            let charge = if gap > MAX_CHARGE_GAP_SECONDS {
                1
            } else {
                gap.max(0)
            };
            entry.unflushed += charge;
            let mut batches = Vec::new();
            if flush_seconds > 0 {
                batches.push((flush_day, flush_seconds));
            }
            if entry.unflushed >= FLUSH_SECONDS {
                batches.push((day.clone(), entry.unflushed));
                entry.unflushed = 0;
            }
            batches
        };
        for (day, seconds) in flush {
            if let Err(error) = self.usage.add_seconds(user_id, &day, seconds).await {
                tracing::warn!(%user_id, %error, "failed to persist household usage");
            }
        }
    }

    /// Cached tags for a work (30 s), so per-segment checks do not hit the
    /// database every request.
    async fn work_tags(&self, state: &AppState, work_id: Uuid) -> Result<Vec<String>, ApiError> {
        if let Some(hit) = self.tags.get(&work_id) {
            if hit.0.elapsed() < WORK_TAG_CACHE_TTL {
                return Ok(hit.1.clone());
            }
        }
        let tags = state
            .catalog
            .work(work_id)
            .await?
            .map(|w| w.tags)
            .unwrap_or_default();
        self.tags.insert(work_id, (Instant::now(), tags.clone()));
        Ok(tags)
    }

    async fn content_grants(&self, user_id: Uuid) -> HashSet<Uuid> {
        self.approvals
            .active_grants(user_id, ApprovalKind::Content, self.clock.now())
            .await
            .unwrap_or_default()
            .into_iter()
            .filter_map(|a| a.subject.parse().ok())
            .collect()
    }

    /// A catalog gate for this profile, `None` when nothing restricts
    /// content (admin, or no rating/tag rules), so the common case costs
    /// nothing.
    pub async fn gate_for(&self, policy: &Policy, user_id: Uuid) -> Option<Arc<HouseholdGate>> {
        if !has_content_rules(policy) {
            return None;
        }
        let granted = self.content_grants(user_id).await;
        Some(Arc::new(HouseholdGate::new(policy.clone(), granted)))
    }

    /// Err(403 `household_blocked`) if the profile may not receive this
    /// media file: blocked folder, rating above the ceiling, unrated, or a
    /// blocked tag, unless a guardian content approval covers the work.
    pub async fn ensure_media_file_allowed(
        &self,
        state: &AppState,
        policy: &Policy,
        user_id: Uuid,
        media_file: &MediaFile,
    ) -> Result<(), ApiError> {
        if policy.is_admin {
            return Ok(());
        }
        if policy
            .blocked_folders
            .iter()
            .any(|folder| media_file.path.starts_with(folder))
        {
            return Err(content_blocked("folder_blocked"));
        }
        if !has_content_rules(policy) {
            return Ok(());
        }
        let tags = self.work_tags(state, media_file.work_id).await?;
        match content_decision(policy, &tags) {
            ContentDecision::Allow => Ok(()),
            blocked => {
                if self
                    .content_grants(user_id)
                    .await
                    .contains(&media_file.work_id)
                {
                    Ok(())
                } else {
                    Err(content_blocked(decision_reason(blocked)))
                }
            }
        }
    }

    fn pin_lock_seconds(failures: u32, threshold: u32) -> Option<i64> {
        (failures >= threshold).then(|| {
            let doublings = (failures - threshold).min(10);
            (60_i64 << doublings).min(PIN_MAX_LOCK_SECONDS)
        })
    }

    /// Err(429 `pin_locked`) while either the (caller, target) pair or the
    /// target as a whole is locked out.
    pub async fn ensure_pin_not_locked(&self, caller: Uuid, target: Uuid) -> Result<(), ApiError> {
        let now = self.clock.now();
        for key in [caller, Uuid::nil()] {
            if let Some(state) = self
                .pins
                .find(key, target)
                .await
                .map_err(|e| ApiError::internal(format!("pin attempt lookup failed: {e}")))?
            {
                if let Some(until) = state.locked_until.filter(|until| *until > now) {
                    return Err(pin_locked(until, now));
                }
            }
        }
        Ok(())
    }

    pub async fn record_pin_failure(&self, caller: Uuid, target: Uuid) {
        let now = self.clock.now();
        for (key, threshold) in [
            (caller, PIN_PAIR_THRESHOLD),
            (Uuid::nil(), PIN_TARGET_THRESHOLD),
        ] {
            let lock = move |failures: u32| {
                Self::pin_lock_seconds(failures, threshold).map(|s| now + Duration::seconds(s))
            };
            if let Err(error) = self.pins.record_failure(key, target, now, &lock).await {
                tracing::warn!(%error, "failed to record PIN failure");
            }
        }
    }

    pub async fn reset_pin_failures(&self, caller: Uuid, target: Uuid) {
        if let Err(error) = self.pins.reset(caller, target).await {
            tracing::warn!(%error, "failed to reset PIN failures");
        }
    }
}

fn pin_locked(until: DateTime<Utc>, now: DateTime<Utc>) -> ApiError {
    let retry = (until - now).num_seconds().max(1);
    ApiError::new(
        StatusCode::TOO_MANY_REQUESTS,
        "pin_locked",
        "too many incorrect PIN attempts; try again later",
    )
    .with_details(serde_json::json!({ "retry_after_seconds": retry, "locked_until": until }))
}

fn content_blocked(reason: &str) -> ApiError {
    ApiError::new(
        StatusCode::FORBIDDEN,
        "household_blocked",
        "this content is not available for this profile",
    )
    .with_details(serde_json::json!({ "reason": reason }))
}

fn decision_reason(decision: ContentDecision) -> &'static str {
    match decision {
        ContentDecision::Allow => "allowed",
        ContentDecision::RatingTooHigh => "rating_too_high",
        ContentDecision::Unrated => "unrated",
        ContentDecision::TagBlocked => "tag_blocked",
    }
}

/// `Ok(())` for an allowed decision, else the `household_blocked` error.
fn blocked_error(decision: TimeDecision) -> Result<(), ApiError> {
    match decision {
        TimeDecision::Unrestricted | TimeDecision::Allowed { .. } => Ok(()),
        TimeDecision::OutsideSchedule { next_start_at } => Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "household_blocked",
            "this profile cannot watch right now",
        )
        .with_details(
            serde_json::json!({ "reason": "outside_schedule", "next_start_at": next_start_at }),
        )),
        TimeDecision::BudgetExhausted { resets_at } => Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "household_blocked",
            "this profile has used today's watch time",
        )
        .with_details(serde_json::json!({ "reason": "budget_exhausted", "resets_at": resets_at }))),
    }
}

/// Whether the policy has any rule that gates individual works.
pub fn has_content_rules(policy: &Policy) -> bool {
    !policy.is_admin
        && (policy.max_rating.is_some()
            || !policy.blocked_tags.is_empty()
            || !policy.allowed_tags.is_empty())
}

/// Whether a profile carries any household restriction at all (used to stop
/// a restricted profile switching into a less restricted, PIN-less one).
pub fn is_restricted(policy: &Policy) -> bool {
    !policy.is_admin
        && (has_content_rules(policy)
            || policy.access_schedule.is_some()
            || policy.household.daily_budget_minutes.is_some()
            || !policy.household.guardian_user_ids.is_empty())
}

/// [`WorkGate`] for one profile: its policy's rating/tag rules, minus works
/// a guardian has approved.
pub struct HouseholdGate {
    policy: Policy,
    granted: HashSet<Uuid>,
    key: String,
}

impl HouseholdGate {
    pub fn new(policy: Policy, granted: HashSet<Uuid>) -> Self {
        let mut grants: Vec<String> = granted.iter().map(|id| id.to_string()).collect();
        grants.sort();
        let key = format!(
            "hg:{:?}:{:?}:{:?}:{:?}:{}",
            policy.max_rating,
            policy.household.unrated,
            policy.blocked_tags,
            policy.allowed_tags,
            grants.join(",")
        );
        Self {
            policy,
            granted,
            key,
        }
    }
}

impl WorkGate for HouseholdGate {
    fn permits(&self, work: &Work) -> bool {
        self.granted.contains(&work.id) || content_decision(&self.policy, &work.tags).is_allowed()
    }

    fn cache_key(&self) -> String {
        self.key.clone()
    }
}

// ---------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------

#[derive(Debug, Serialize, ToSchema)]
pub struct HouseholdStatusResponse {
    /// Whether any household restriction applies to this profile.
    pub restricted: bool,
    /// `unrestricted`, `allowed`, `outside_schedule` or `budget_exhausted`.
    pub state: String,
    pub remaining_seconds: Option<i64>,
    /// End of the current schedule window.
    pub window_ends_at: Option<DateTime<Utc>>,
    /// Start of the next schedule window while outside it.
    pub next_start_at: Option<DateTime<Utc>>,
    /// When the daily budget resets, once exhausted.
    pub resets_at: Option<DateTime<Utc>>,
    pub daily_budget_minutes: Option<u32>,
    pub timezone: Option<String>,
    pub max_rating: Option<String>,
    /// Server time, so clients can show remaining time without trusting
    /// their own clock.
    pub server_time: DateTime<Utc>,
    /// Cached authorisation on a client is valid until this instant.
    pub offline_valid_until: DateTime<Utc>,
    /// Profiles this user may approve requests for.
    pub guardian_for: Vec<Uuid>,
}

pub fn status_from(
    policy: &Policy,
    time: TimeState,
    guardian_for: Vec<Uuid>,
) -> HouseholdStatusResponse {
    let mut response = HouseholdStatusResponse {
        restricted: is_restricted(policy),
        state: "unrestricted".to_string(),
        remaining_seconds: None,
        window_ends_at: None,
        next_start_at: None,
        resets_at: None,
        daily_budget_minutes: policy.household.daily_budget_minutes,
        timezone: policy.household.timezone.clone(),
        max_rating: policy.max_rating.clone(),
        server_time: time.now,
        offline_valid_until: time.now
            + Duration::hours(policy.household.offline_ttl_hours().into()),
        guardian_for,
    };
    match time.decision {
        TimeDecision::Unrestricted => {}
        TimeDecision::Allowed {
            remaining_seconds,
            window_ends_at,
        } => {
            response.state = "allowed".to_string();
            response.remaining_seconds = remaining_seconds;
            response.window_ends_at = window_ends_at;
        }
        TimeDecision::OutsideSchedule { next_start_at } => {
            response.state = "outside_schedule".to_string();
            response.next_start_at = next_start_at;
        }
        TimeDecision::BudgetExhausted { resets_at } => {
            response.state = "budget_exhausted".to_string();
            response.remaining_seconds = Some(0);
            response.resets_at = Some(resets_at);
        }
    }
    response
}

/// Profiles whose policy lists `guardian` as a guardian.
async fn guarded_profiles(state: &AppState, guardian: Uuid) -> Result<Vec<Uuid>, ApiError> {
    let users = state
        .user_repo
        .list_all()
        .await
        .map_err(|e| ApiError::internal(format!("failed to list users: {e}")))?;
    let mut out = Vec::new();
    for user in users {
        if user.disabled || user.id == guardian {
            continue;
        }
        if let Ok(Some(policy)) = state.policy_repo.find_by_id(user.policy_id).await {
            if policy.household.guardian_user_ids.contains(&guardian) {
                out.push(user.id);
            }
        }
    }
    Ok(out)
}

#[utoipa::path(
    get,
    path = "/api/v1/household/status",
    tag = "household",
    responses(
        (status = 200, description = "The signed-in profile's household state: schedule, remaining time and offline validity", body = HouseholdStatusResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr streaming access")
    )
)]
pub async fn household_status_handler(
    State(state): State<AppState>,
    streaming: AnytimeStreamingUser,
) -> Result<Json<HouseholdStatusResponse>, ApiError> {
    let guardian_for = guarded_profiles(&state, streaming.user_id).await?;
    let time = state
        .household
        .time_state(&streaming.policy, streaming.user_id)
        .await;
    Ok(Json(status_from(&streaming.policy, time, guardian_for)))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateApprovalRequest {
    pub kind: ApprovalKind,
    /// `content`: a work id. `time`: `schedule` or `budget`.
    pub subject: String,
    #[serde(default)]
    pub note: Option<String>,
}

#[utoipa::path(
    post,
    path = "/api/v1/household/approvals",
    tag = "household",
    request_body = CreateApprovalRequest,
    responses(
        (status = 200, description = "Approval request created (pending)", body = Approval),
        (status = 400, description = "Invalid subject for this kind"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr streaming access"),
        (status = 409, description = "Too many pending requests")
    )
)]
pub async fn create_approval_handler(
    State(state): State<AppState>,
    streaming: AnytimeStreamingUser,
    Json(body): Json<CreateApprovalRequest>,
) -> Result<Json<Approval>, ApiError> {
    let subject = body.subject.trim();
    if subject.is_empty() || subject.len() > 200 {
        return Err(ApiError::bad_request("subject must be 1-200 characters"));
    }
    match body.kind {
        ApprovalKind::Content => {
            let work_id: Uuid = subject
                .parse()
                .map_err(|_| ApiError::bad_request("content subject must be a work id"))?;
            if state.catalog.work(work_id).await?.is_none() {
                return Err(ApiError::bad_request("unknown work"));
            }
        }
        ApprovalKind::Time if subject != "schedule" && subject != "budget" => {
            return Err(ApiError::bad_request(
                "time subject must be `schedule` or `budget`",
            ));
        }
        _ => {}
    }
    let existing = state
        .household
        .approvals()
        .list_for_profiles(&[streaming.user_id], 100)
        .await?;
    let now = state.household.now();
    let pending = existing
        .iter()
        .filter(|a| a.status == ApprovalStatus::Pending && a.request_expires_at > now)
        .count();
    if pending >= MAX_PENDING_APPROVALS {
        return Err(ApiError::conflict("too many pending approval requests"));
    }
    let approval = Approval {
        id: Uuid::new_v4(),
        profile_user_id: streaming.user_id,
        kind: body.kind,
        subject: subject.to_string(),
        note: body
            .note
            .map(|n| n.chars().take(200).collect::<String>())
            .filter(|n| !n.trim().is_empty()),
        status: ApprovalStatus::Pending,
        requested_at: now,
        request_expires_at: now + Duration::minutes(REQUEST_TTL_MINUTES),
        decided_by: None,
        decided_at: None,
        grant_expires_at: None,
        max_uses: None,
        uses: 0,
        bonus_seconds: 0,
    };
    state.household.approvals().insert(&approval).await?;
    // The requesting profile and its guardians see the pending request live.
    let recipients = std::iter::once(streaming.user_id)
        .chain(streaming.policy.household.guardian_user_ids.iter().copied());
    crate::events::publish_to_users(
        &state,
        recipients,
        playarr_db::live_event_kind::HOUSEHOLD,
        "profile",
        streaming.user_id,
        &["approval"],
    )
    .await;
    Ok(Json(approval))
}

#[utoipa::path(
    get,
    path = "/api/v1/household/approvals",
    tag = "household",
    responses(
        (status = 200, description = "The caller's own requests and requests from profiles the caller guards, newest first", body = Vec<Approval>),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr streaming access")
    )
)]
pub async fn list_approvals_handler(
    State(state): State<AppState>,
    streaming: AnytimeStreamingUser,
) -> Result<Json<Vec<Approval>>, ApiError> {
    let mut profiles = vec![streaming.user_id];
    profiles.extend(guarded_profiles(&state, streaming.user_id).await?);
    let items = state
        .household
        .approvals()
        .list_for_profiles(&profiles, 50)
        .await?;
    Ok(Json(items))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DecideApprovalRequest {
    pub approve: bool,
    /// The guardian's own profile PIN (required to approve).
    #[serde(default)]
    pub pin: Option<String>,
    /// How long an approval stays usable. Default 60 minutes
    /// for content and time; at most 240.
    #[serde(default)]
    pub duration_minutes: Option<u32>,
    /// `time`/`budget` only: extra watch minutes granted.
    #[serde(default)]
    pub bonus_minutes: Option<u32>,
}

#[utoipa::path(
    post,
    path = "/api/v1/household/approvals/{id}/decision",
    tag = "household",
    params(("id" = Uuid, Path, description = "Approval id")),
    request_body = DecideApprovalRequest,
    responses(
        (status = 200, description = "Decision recorded", body = Approval),
        (status = 401, description = "Missing or invalid access token, or wrong guardian PIN"),
        (status = 403, description = "Caller is the requester (`self_approval_forbidden`), is not a guardian of this profile (`not_guardian`), has no profile PIN (`guardian_pin_not_set`), or is a restricted profile (`forbidden`)"),
        (status = 404, description = "Unknown approval"),
        (status = 409, description = "Already decided or expired"),
        (status = 429, description = "PIN locked out")
    )
)]
pub async fn decide_approval_handler(
    State(state): State<AppState>,
    guardian: AnytimeStreamingUser,
    Path(id): Path<Uuid>,
    Json(body): Json<DecideApprovalRequest>,
) -> Result<Json<Approval>, ApiError> {
    let approval = state
        .household
        .approvals()
        .get(id)
        .await?
        .ok_or_else(|| ApiError::not_found("unknown approval"))?;

    // A profile can never decide its own request, whatever its policy says.
    if approval.profile_user_id == guardian.user_id {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "self_approval_forbidden",
            "a profile cannot approve its own request",
        ));
    }
    let profile_policy = resolve_policy(
        &state,
        approval.profile_user_id,
        "approval",
        forbidden("unknown profile"),
    )
    .await?;
    if !profile_policy
        .household
        .guardian_user_ids
        .contains(&guardian.user_id)
    {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "not_guardian",
            "caller is not a guardian of this profile",
        ));
    }
    if is_restricted(&guardian.policy) && !guardian.policy.is_admin {
        // A restricted profile (a sibling) cannot be a guardian even if
        // someone mis-configured the list.
        return Err(forbidden("a restricted profile cannot approve requests"));
    }

    let now = state.household.now();
    if !body.approve {
        let changed = state
            .household
            .approvals()
            .decide(
                id,
                ApprovalStatus::Denied,
                guardian.user_id,
                now,
                None,
                None,
                0,
            )
            .await?;
        if !changed {
            return Err(ApiError::conflict("approval already decided or expired"));
        }
        return load(&state, id).await;
    }

    // Step-up: approving needs the guardian's own PIN, with lockout.
    let pin_hash = state
        .profile_pin_repo
        .find_hash(guardian.user_id)
        .await?
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::FORBIDDEN,
                "guardian_pin_not_set",
                "set a profile PIN before approving requests",
            )
        })?;
    state
        .household
        .ensure_pin_not_locked(guardian.user_id, guardian.user_id)
        .await?;
    let verified = body
        .pin
        .as_deref()
        .is_some_and(|pin| playarr_auth::Argon2PasswordVerifier.verify(pin, &pin_hash));
    if !verified {
        state
            .household
            .record_pin_failure(guardian.user_id, guardian.user_id)
            .await;
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "invalid_pin",
            "invalid profile PIN",
        ));
    }
    state
        .household
        .reset_pin_failures(guardian.user_id, guardian.user_id)
        .await;

    let minutes = body
        .duration_minutes
        .unwrap_or(DEFAULT_GRANT_MINUTES)
        .clamp(1, MAX_GRANT_MINUTES);
    let grant_expires_at = now + Duration::minutes(minutes.into());
    let (max_uses, bonus_seconds) = match approval.kind {
        ApprovalKind::Content => (None, 0),
        ApprovalKind::Time => {
            let bonus = if approval.subject == "budget" {
                i64::from(body.bonus_minutes.unwrap_or(30).min(MAX_GRANT_MINUTES)) * 60
            } else {
                0
            };
            (None, bonus)
        }
    };
    let changed = state
        .household
        .approvals()
        .decide(
            id,
            ApprovalStatus::Approved,
            guardian.user_id,
            now,
            Some(grant_expires_at),
            max_uses,
            bonus_seconds,
        )
        .await?;
    if !changed {
        return Err(ApiError::conflict("approval already decided or expired"));
    }
    crate::events::publish_to_users(
        &state,
        [approval.profile_user_id, guardian.user_id],
        playarr_db::live_event_kind::HOUSEHOLD,
        "profile",
        approval.profile_user_id,
        &["approval", "status"],
    )
    .await;
    load(&state, id).await
}

async fn load(state: &AppState, id: Uuid) -> Result<Json<Approval>, ApiError> {
    state
        .household
        .approvals()
        .get(id)
        .await?
        .map(Json)
        .ok_or_else(|| ApiError::not_found("unknown approval"))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ConsumeApprovalResponse {
    pub consumed: bool,
}

#[utoipa::path(
    post,
    path = "/api/v1/household/approvals/{id}/consume",
    tag = "household",
    params(("id" = Uuid, Path, description = "Approval id")),
    responses(
        (status = 200, description = "One use of the approval was consumed", body = ConsumeApprovalResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Approval is not approved, expired, exhausted or belongs to another profile")
    )
)]
pub async fn consume_approval_handler(
    State(state): State<AppState>,
    streaming: AnytimeStreamingUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ConsumeApprovalResponse>, ApiError> {
    let now = state.household.now();
    let consumed = state
        .household
        .approvals()
        .consume(id, streaming.user_id, now)
        .await?;
    if !consumed {
        return Err(forbidden("approval is not usable"));
    }
    crate::events::publish_to_users(
        &state,
        [streaming.user_id],
        playarr_db::live_event_kind::HOUSEHOLD,
        "profile",
        streaming.user_id,
        &["approval", "status"],
    )
    .await;
    Ok(Json(ConsumeApprovalResponse { consumed: true }))
}

/// Library access plus the profile's household gate, for the catalog's
/// `*_with` reads.
pub fn access<'a>(
    allowed: Option<&'a [Uuid]>,
    gate: Option<&'a HouseholdGate>,
) -> playarr_catalog::Access<'a> {
    playarr_catalog::Access::new(allowed, gate.map(|g| g as &dyn WorkGate))
}

// ---------------------------------------------------------------------
// Admin: per-account household settings
// ---------------------------------------------------------------------

/// The household-relevant slice of an account's [`Policy`], edited as one
/// unit by `PUT /api/v1/admin/users/{id}/household`.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct HouseholdSettings {
    /// Rating ceiling such as `PG-13`; `null` = no rating gate.
    pub max_rating: Option<String>,
    #[serde(default)]
    pub blocked_tags: Vec<String>,
    #[serde(default)]
    pub allowed_tags: Vec<String>,
    #[serde(default)]
    pub blocked_folders: Vec<String>,
    /// Allowed windows in the profile's time zone; `null` = no schedule,
    /// an empty list = locked out.
    pub access_schedule: Option<Vec<playarr_model::AccessWindow>>,
    #[serde(default)]
    pub household: playarr_model::HouseholdControls,
}

impl HouseholdSettings {
    fn from_policy(policy: &Policy) -> Self {
        Self {
            max_rating: policy.max_rating.clone(),
            blocked_tags: policy.blocked_tags.clone(),
            allowed_tags: policy.allowed_tags.clone(),
            blocked_folders: policy.blocked_folders.clone(),
            access_schedule: policy.access_schedule.clone(),
            household: policy.household.clone(),
        }
    }
}

async fn validate_settings(
    state: &AppState,
    target: Uuid,
    settings: &HouseholdSettings,
) -> Result<(), ApiError> {
    if let Some(rating) = settings.max_rating.as_deref() {
        if playarr_auth::policy::rating_rank(rating).is_none() {
            return Err(ApiError::bad_request(
                "max_rating must be one of G, PG, PG-13, R, NC-17, TV-Y, TV-Y7, TV-G, TV-PG, TV-14, TV-MA",
            ));
        }
    }
    let controls = &settings.household;
    if let Some(zone) = controls.timezone.as_deref() {
        if playarr_auth::household::parse_timezone(zone).is_none() {
            return Err(ApiError::bad_request("timezone must be an IANA zone name"));
        }
    }
    if controls
        .daily_budget_minutes
        .is_some_and(|m| m == 0 || m > 1440)
    {
        return Err(ApiError::bad_request(
            "daily_budget_minutes must be between 1 and 1440",
        ));
    }
    if controls.offline_ttl_hours.is_some_and(|h| h == 0 || h > 72) {
        return Err(ApiError::bad_request(
            "offline_ttl_hours must be between 1 and 72",
        ));
    }
    for window in settings.access_schedule.iter().flatten() {
        let range = window.time_range;
        if range.start_minute_of_day >= range.end_minute_of_day || range.end_minute_of_day > 1440 {
            return Err(ApiError::bad_request(
                "schedule windows need start < end <= 1440 minutes",
            ));
        }
    }
    for guardian in &controls.guardian_user_ids {
        if *guardian == target {
            return Err(ApiError::bad_request(
                "a profile cannot be its own guardian",
            ));
        }
        let user = state
            .user_repo
            .find_by_id(*guardian)
            .await?
            .ok_or_else(|| ApiError::bad_request("unknown guardian user"))?;
        let policy = state.policy_repo.find_by_id(user.policy_id).await?;
        if policy.as_ref().is_some_and(is_restricted) {
            return Err(ApiError::bad_request(
                "a restricted profile cannot be a guardian",
            ));
        }
    }
    Ok(())
}

async fn target_policy(state: &AppState, user_id: Uuid) -> Result<Policy, ApiError> {
    let user = state
        .user_repo
        .find_by_id(user_id)
        .await?
        .ok_or_else(|| ApiError::not_found("unknown user"))?;
    state
        .policy_repo
        .find_by_id(user.policy_id)
        .await?
        .ok_or_else(|| ApiError::not_found("unknown policy"))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/users/{id}/household",
    tag = "household",
    params(("id" = Uuid, Path, description = "User id")),
    responses(
        (status = 200, description = "The account's household settings", body = HouseholdSettings),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is not an admin"),
        (status = 404, description = "Unknown user")
    )
)]
pub async fn get_user_household_handler(
    State(state): State<AppState>,
    _admin: crate::auth_extractor::AdminUser,
    Path(id): Path<Uuid>,
) -> Result<Json<HouseholdSettings>, ApiError> {
    let policy = target_policy(&state, id).await?;
    Ok(Json(HouseholdSettings::from_policy(&policy)))
}

#[utoipa::path(
    put,
    path = "/api/v1/admin/users/{id}/household",
    tag = "household",
    params(("id" = Uuid, Path, description = "User id")),
    request_body = HouseholdSettings,
    responses(
        (status = 200, description = "Settings saved", body = HouseholdSettings),
        (status = 400, description = "Invalid rating, time zone, schedule, budget or guardian"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is not an admin"),
        (status = 404, description = "Unknown user")
    )
)]
pub async fn put_user_household_handler(
    State(state): State<AppState>,
    _admin: crate::auth_extractor::AdminUser,
    Path(id): Path<Uuid>,
    Json(settings): Json<HouseholdSettings>,
) -> Result<Json<HouseholdSettings>, ApiError> {
    let mut policy = target_policy(&state, id).await?;
    validate_settings(&state, id, &settings).await?;
    policy.max_rating = settings.max_rating.clone();
    policy.blocked_tags = settings.blocked_tags.clone();
    policy.allowed_tags = settings.allowed_tags.clone();
    policy.blocked_folders = settings.blocked_folders.clone();
    policy.access_schedule = settings.access_schedule.clone();
    policy.household = settings.household.clone();
    state.policy_repo.upsert(&policy).await?;
    // The profile itself and its guardians re-read status, schedule and gates.
    let recipients =
        std::iter::once(id).chain(settings.household.guardian_user_ids.iter().copied());
    crate::events::publish_to_users(
        &state,
        recipients,
        playarr_db::live_event_kind::HOUSEHOLD,
        "profile",
        id,
        &["policy", "status"],
    )
    .await;
    Ok(Json(HouseholdSettings::from_policy(&policy)))
}
