//! Syncs `users`/`policies` (via `GET /api/v1/peer/accounts`),
//! `user_invites`/`user_invite_requests` (via `GET /api/v1/peer/invites`),
//! and `group_libraries` (via `GET /api/v1/peer/libraries`) --
//! `docs/architecture/peer-groups.md` §3.5/§3.6.
//!
//! **Conflict model** (§3.5): `users`/`policies`/`group_libraries` resolve
//! by plain last-writer-wins on `updated_at`. `policies` additionally gate
//! its privilege-bearing fields (`is_admin`/`can_stream`/`can_download`/
//! `can_delete`/`can_share_public`/`library_allow`/`group_library_allow`/
//! `device_allow`/`access_schedule`) behind an `origin_peer_id` match -- see
//! [`resolve_policy`]'s doc comment.
//!
//! **`user_invites`/`user_invite_requests` are not plain LWW** (§2.5,
//! Phase 4) -- `sync_invites` below applies `UserInviteRepo::upsert`/
//! `UserInviteRequestRepo::upsert`, neither of which compares `updated_at`
//! the way `resolve_user`/`resolve_policy`/`sync_libraries` do. `user_
//! invites` now has `updated_at` (creation *or* consumption bump it) and
//! `upsert` uses it for a narrower, one-way rule instead: a pre-existing
//! row only ever moves from unconsumed toward consumed, never back -- see
//! `UserInviteRepo::upsert`'s own doc comment for the full rationale and
//! its known gap (a genuine double-redemption -- two different accounts,
//! each already consumed independently on two different peers -- silently
//! keeps each peer's own record rather than reconciling). `user_invite_
//! requests` still has no `updated_at` at all, so its `upsert` always
//! applies the incoming row wholesale (see that trait's own doc comment).
//! Neither ever writes to `sync_conflict_log` (that table's own
//! `entity_type` enumeration doesn't include an invite variant -- see
//! `SyncConflictLog`'s own doc comment) -- full double-redemption
//! reconciliation (disabling the losing side's account, §3.5) is left for
//! future work.
//!
//! **Every resolved conflict is logged, never silently dropped** (§3.5): a
//! rejected write's full JSON value is written to `sync_conflict_log`
//! before this module moves on. A caveat worth stating plainly rather than
//! leaving implicit: because this crate re-fetches and re-applies every
//! page it hasn't already advanced its cursor past, an already-losing write
//! that a peer keeps re-reporting (it hasn't itself learned it lost) logs a
//! new conflict row on every sync pass until either side's state changes --
//! the design doc specifies "every LWW resolution writes a row," not a
//! deduplicated one, so this is a faithful implementation of what's
//! written, not an oversight.
//!
//! **A single bad row must never stall a peer's sync forever** -- `sync_
//! accounts` isolates a row that fails to *apply* (as opposed to one
//! `resolve_user`/`resolve_policy` already decided should lose an LWW
//! comparison, handled above) with a genuine database constraint violation.
//! The motivating case: two peers each independently create a `users` row
//! with the same `username`. Different `id`s, so `UserRepo::apply_synced`'s
//! `ON CONFLICT (id)` upsert can't catch it -- the failing constraint is
//! `users.username`'s own `UNIQUE` index, a different column entirely --
//! and without this handling the raw constraint-violation error would
//! propagate out of `sync_accounts`, and because the cursor only ever
//! advances on a page's full success (§3.6), the exact same colliding row
//! would be re-fetched and re-fail on every single retry, forever, taking
//! every *other* row on that page (and every later phase in `poller.rs`'s
//! membership -> accounts -> invites -> libraries -> availability ->
//! routing_rules sequence, since it short-circuits on the first `?`) down
//! with it. Instead
//! (`DbError::is_constraint_violation` draws the line): a constraint
//! violation on one row's apply is caught, logged to `sync_conflict_log`
//! (`requires_admin_review = true` -- this needs a human, since resolving
//! it is a deferred product decision, not something this pass invents a
//! policy for) with the incoming row's JSON *and* the error attached, and
//! that one row is skipped -- the rest of the page still applies, and the
//! cursor still advances past it, exactly like the "always log then
//! continue" precedent above rather than a new one. A genuinely transient
//! error (a network blip, pool exhaustion, ...) is not a constraint
//! violation and still propagates, aborting/retrying the whole pass as
//! before -- see `DbError::is_constraint_violation`'s own doc comment.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use streamarr_db::{
    GroupLibraryRepo, PolicyRepo, SyncConflictLog, SyncConflictLogRepo, SyncMetadata,
    UserInviteRepo, UserInviteRequestRepo, UserRepo,
};
use streamarr_model::{GroupLibrary, Policy, User, UserInvite, UserInviteRequest};
use uuid::Uuid;

use crate::peer_client::{PeerClient, PeerClientError};

#[derive(Debug, thiserror::Error)]
pub enum AccountSyncError {
    #[error(transparent)]
    PeerClient(#[from] PeerClientError),
    #[error(transparent)]
    Db(#[from] streamarr_db::DbError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

// ---------------------------------------------------------------------
// Wire DTOs
// ---------------------------------------------------------------------

/// One `users` row on the wire: the domain `User` plus the three sync-only
/// columns `streamarr_model::User` deliberately doesn't carry (see
/// `streamarr_db::repo::user`'s own doc comment).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSyncRow {
    #[serde(flatten)]
    pub user: User,
    pub updated_at: DateTime<Utc>,
    pub origin_peer_id: Option<Uuid>,
    pub deleted_at: Option<DateTime<Utc>>,
}

/// One `policies` row on the wire -- same shape as [`UserSyncRow`], for
/// `Policy`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicySyncRow {
    #[serde(flatten)]
    pub policy: Policy,
    pub updated_at: DateTime<Utc>,
    pub origin_peer_id: Option<Uuid>,
    pub deleted_at: Option<DateTime<Utc>>,
}

/// Wire shape of `GET /api/v1/peer/accounts?since=`'s response body.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountsResponse {
    pub users: Vec<UserSyncRow>,
    pub policies: Vec<PolicySyncRow>,
    /// Opaque cursor for the next `since=` request -- persisted into
    /// `peer_sync_state.cursor` on success only (§3.6).
    pub server_time: String,
}

/// Wire shape of `GET /api/v1/peer/invites?since=`'s response body.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvitesResponse {
    pub invites: Vec<UserInvite>,
    pub invite_requests: Vec<UserInviteRequest>,
    pub server_time: String,
}

/// Wire shape of `GET /api/v1/peer/libraries?since=`'s response body.
/// `source_instances` identity rows are deliberately not part of this DTO:
/// there is no local sink table for another peer's `SourceInstance`
/// identity today (`GroupLibrary` -- via `SourceInstance.group_library_id`,
/// resolved *locally* -- is what actually makes cross-node library grants
/// portable, per §5.1; a peer's own `SourceInstance` list is informational,
/// not something this node's own `source_instances` table should ever
/// contain rows for). Adding a dedicated peer-library-identity cache table
/// is left for whichever future pass builds the admin UI that would
/// consume it, rather than speculatively persisting unused data now.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibrariesResponse {
    pub group_libraries: Vec<GroupLibrary>,
    pub server_time: String,
}

// ---------------------------------------------------------------------
// Pure conflict-resolution logic (unit-tested independent of any DB/HTTP)
// ---------------------------------------------------------------------

/// What to do with one incoming `User` row, decided purely from timestamps
/// -- `streamarr_model::User` carries no privilege-bearing field this
/// design's origin-gating rule applies to (every field the design doc names
/// as privilege-bearing, §3.5, lives on `Policy`), so `User` sync is plain
/// LWW with no per-field gating.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserResolution {
    /// No local row exists yet -- apply unconditionally, nothing to log.
    Insert,
    /// A local row exists and the incoming write is strictly newer --
    /// apply, nothing to log (ordinary forward progress, not a conflict).
    Apply,
    /// A local row exists and is at least as new -- the incoming write
    /// loses; log it, do not apply.
    Reject,
}

pub fn resolve_user(local: Option<SyncMetadata>, incoming_updated_at: DateTime<Utc>) -> UserResolution {
    match local {
        None => UserResolution::Insert,
        Some(local_meta) if incoming_updated_at > local_meta.updated_at => UserResolution::Apply,
        Some(_) => UserResolution::Reject,
    }
}

/// What to do with one incoming `Policy` row -- see this module's own doc
/// comment for the full origin-gating rationale (§3.5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyResolution {
    /// No local row exists yet -- apply the whole incoming row.
    Insert,
    /// Incoming is newer, and either the local row has no known origin yet
    /// or the incoming write's claimed origin matches it -- apply the whole
    /// row.
    ApplyWhole,
    /// Incoming is newer, but its claimed `origin_peer_id` does not match
    /// the local row's already-known origin -- apply only the
    /// non-privileged fields (see [`merge_non_privileged_policy_fields`]),
    /// keep every privileged field and the local `origin_peer_id`
    /// unchanged, and log the incoming row's privileged values for admin
    /// review (`requires_admin_review = true`).
    ApplyNonPrivilegedOnly,
    /// The local row is at least as new -- the incoming write loses
    /// entirely; log it (`requires_admin_review = false`, plain LWW), do
    /// not apply.
    Reject,
}

pub fn resolve_policy(
    local: Option<SyncMetadata>,
    incoming_updated_at: DateTime<Utc>,
    incoming_origin_peer_id: Option<Uuid>,
) -> PolicyResolution {
    let Some(local_meta) = local else {
        return PolicyResolution::Insert;
    };
    if incoming_updated_at <= local_meta.updated_at {
        return PolicyResolution::Reject;
    }
    let origin_ok = match local_meta.origin_peer_id {
        None => true,
        Some(local_origin) => Some(local_origin) == incoming_origin_peer_id,
    };
    if origin_ok {
        PolicyResolution::ApplyWhole
    } else {
        PolicyResolution::ApplyNonPrivilegedOnly
    }
}

/// Builds the merged `Policy` for [`PolicyResolution::ApplyNonPrivilegedOnly`]:
/// every privilege-bearing field (§3.5's list) stays `local`'s; everything
/// else takes `incoming`'s value.
pub fn merge_non_privileged_policy_fields(local: &Policy, incoming: &Policy) -> Policy {
    Policy {
        id: local.id,
        name: incoming.name.clone(),
        library_allow: local.library_allow.clone(),
        // Portable sibling of `library_allow` (§5.1) -- gated the same way:
        // it grants library access just as directly, so a non-origin peer
        // must not be able to widen it any more than `library_allow` itself.
        group_library_allow: local.group_library_allow.clone(),
        blocked_folders: incoming.blocked_folders.clone(),
        max_rating: incoming.max_rating.clone(),
        blocked_tags: incoming.blocked_tags.clone(),
        allowed_tags: incoming.allowed_tags.clone(),
        can_transcode: incoming.can_transcode,
        can_download: local.can_download,
        can_delete: local.can_delete,
        can_share_public: local.can_share_public,
        device_allow: local.device_allow.clone(),
        max_concurrent_sessions: incoming.max_concurrent_sessions,
        access_schedule: local.access_schedule.clone(),
        can_stream: local.can_stream,
        is_admin: local.is_admin,
    }
}

/// Logs one incoming row's failed *apply* attempt to `sync_conflict_log`
/// and bumps `outcome.conflicts_logged` -- the "isolate one bad row"
/// counterpart to [`conflict_log`] (which handles a row `resolve_user`/
/// `resolve_policy` already decided should lose an LWW comparison; this
/// handles a row that was supposed to win but then hit a genuine database
/// constraint on write). See this module's own doc comment for the full
/// motivating scenario.
///
/// Unlike every other `conflict_log_repo.create` call in this module,
/// `losing_value_json` here is a small JSON envelope (`{"row": ..., "apply_
/// error": ...}`), not just the row -- there's no dedicated column for the
/// error, and an admin reviewing this row needs to know *why* it was
/// skipped, not only what it was.
#[allow(clippy::too_many_arguments)]
async fn log_apply_failure<T: Serialize>(
    conflict_log_repo: &Arc<dyn SyncConflictLogRepo>,
    outcome: &mut AccountsSyncOutcome,
    entity_type: &str,
    entity_id: Uuid,
    winning_peer_id: Uuid,
    losing_peer_id: Uuid,
    row: &T,
    err: &streamarr_db::DbError,
) -> Result<(), AccountSyncError> {
    tracing::warn!(
        entity_type,
        entity_id = %entity_id,
        losing_peer_id = %losing_peer_id,
        error = %err,
        "skipping one synced row that failed a database constraint on apply (e.g. a username \
         collision with a different local row) and logging it to sync_conflict_log for admin \
         review instead of aborting the whole sync pass"
    );
    let losing_value_json = serde_json::to_string(&serde_json::json!({
        "row": row,
        "apply_error": err.to_string(),
    }))?;
    conflict_log_repo
        .create(&conflict_log(
            entity_type,
            entity_id,
            winning_peer_id,
            losing_peer_id,
            losing_value_json,
            true,
        ))
        .await?;
    outcome.conflicts_logged += 1;
    Ok(())
}

fn conflict_log(
    entity_type: &str,
    entity_id: Uuid,
    winning_peer_id: Uuid,
    losing_peer_id: Uuid,
    losing_value_json: String,
    requires_admin_review: bool,
) -> SyncConflictLog {
    SyncConflictLog {
        id: Uuid::new_v4(),
        entity_type: entity_type.to_string(),
        entity_id,
        winning_peer_id,
        losing_peer_id,
        losing_value_json,
        detected_at: Utc::now(),
        requires_admin_review,
    }
}

// ---------------------------------------------------------------------
// Async sync entrypoints
// ---------------------------------------------------------------------

/// Outcome counters -- for the poller's own tracing, not surfaced further.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct AccountsSyncOutcome {
    pub users_applied: usize,
    pub policies_applied: usize,
    pub conflicts_logged: usize,
}

/// Syncs `users`/`policies` from `base_url`'s `GET /api/v1/peer/accounts`,
/// resuming from this `peer_node_id`'s persisted cursor (`entity =
/// "accounts"`) and advancing it on success.
#[allow(clippy::too_many_arguments)]
pub async fn sync_accounts(
    peer_client: &PeerClient,
    base_url: &str,
    peer_node_id: Uuid,
    self_peer_id: Uuid,
    user_repo: &Arc<dyn UserRepo>,
    policy_repo: &Arc<dyn PolicyRepo>,
    sync_state_repo: &Arc<dyn streamarr_db::PeerSyncStateRepo>,
    conflict_log_repo: &Arc<dyn SyncConflictLogRepo>,
) -> Result<AccountsSyncOutcome, AccountSyncError> {
    const ENTITY: &str = "accounts";
    let cursor = sync_state_repo
        .get(peer_node_id, ENTITY)
        .await?
        .and_then(|state| state.cursor);
    let path = match &cursor {
        Some(cursor) => format!("/api/v1/peer/accounts?since={cursor}"),
        None => "/api/v1/peer/accounts".to_string(),
    };
    let response: AccountsResponse = peer_client.signed_get(base_url, &path).await?;

    let mut outcome = AccountsSyncOutcome::default();

    // Policies are applied *before* users, deliberately: `users.policy_id`
    // is a real `REFERENCES policies (id)` foreign key (see
    // `migrations/{postgres,sqlite}/0007_users_policies.sql`'s own
    // "policies is created first... because a user can't be inserted until
    // the policy it points at exists" comment), and Postgres enforces that
    // immediately, not deferred. A single `since=` page commonly carries a
    // brand-new user *and* the brand-new policy it was just assigned (an
    // admin creating both together in one session, then one poll interval
    // later syncing both in the same response) -- applying users first
    // would FK-violate on Postgres, fail the whole page before the cursor
    // ever advances, and then fail identically forever on every later
    // retry of that same unadvanced page. SQLite masks this locally (this
    // codebase never sets `PRAGMA foreign_keys = ON`), which is exactly
    // why it went unnoticed until traced end to end against a real second
    // node.
    for row in &response.policies {
        let local_meta = policy_repo.get_sync_metadata(row.policy.id).await?;
        match resolve_policy(local_meta, row.updated_at, row.origin_peer_id) {
            PolicyResolution::Insert | PolicyResolution::ApplyWhole => {
                let apply_result = policy_repo
                    .apply_synced(
                        &row.policy,
                        SyncMetadata {
                            updated_at: row.updated_at,
                            origin_peer_id: row.origin_peer_id,
                            deleted_at: row.deleted_at,
                        },
                    )
                    .await;
                match apply_result {
                    Ok(()) => outcome.policies_applied += 1,
                    Err(err) if err.is_constraint_violation() => {
                        log_apply_failure(
                            conflict_log_repo,
                            &mut outcome,
                            "policy",
                            row.policy.id,
                            self_peer_id,
                            row.origin_peer_id.unwrap_or(peer_node_id),
                            row,
                            &err,
                        )
                        .await?;
                    }
                    Err(err) => return Err(err.into()),
                }
            }
            PolicyResolution::ApplyNonPrivilegedOnly => {
                let local_meta = local_meta.expect("this arm only returned when a local row exists");
                let local_policy = policy_repo
                    .find_by_id(row.policy.id)
                    .await?
                    .expect("get_sync_metadata found a row, so find_by_id must too");
                let merged = merge_non_privileged_policy_fields(&local_policy, &row.policy);
                let apply_result = policy_repo
                    .apply_synced(
                        &merged,
                        SyncMetadata {
                            updated_at: row.updated_at,
                            // Privileged fields didn't move -- the local
                            // origin claim is unchanged.
                            origin_peer_id: local_meta.origin_peer_id,
                            deleted_at: row.deleted_at,
                        },
                    )
                    .await;
                match apply_result {
                    Ok(()) => {
                        outcome.policies_applied += 1;
                        conflict_log_repo
                            .create(&conflict_log(
                                "policy",
                                row.policy.id,
                                local_meta.origin_peer_id.unwrap_or(self_peer_id),
                                row.origin_peer_id.unwrap_or(peer_node_id),
                                serde_json::to_string(row)?,
                                true,
                            ))
                            .await?;
                        outcome.conflicts_logged += 1;
                    }
                    Err(err) if err.is_constraint_violation() => {
                        // The apply itself never happened, so logging the
                        // usual origin-mismatch conflict on top would claim
                        // something was applied that wasn't -- log only the
                        // apply failure.
                        log_apply_failure(
                            conflict_log_repo,
                            &mut outcome,
                            "policy",
                            row.policy.id,
                            local_meta.origin_peer_id.unwrap_or(self_peer_id),
                            row.origin_peer_id.unwrap_or(peer_node_id),
                            row,
                            &err,
                        )
                        .await?;
                    }
                    Err(err) => return Err(err.into()),
                }
            }
            PolicyResolution::Reject => {
                let local_meta = local_meta.expect("Reject only returned when a local row exists");
                conflict_log_repo
                    .create(&conflict_log(
                        "policy",
                        row.policy.id,
                        local_meta.origin_peer_id.unwrap_or(self_peer_id),
                        row.origin_peer_id.unwrap_or(peer_node_id),
                        serde_json::to_string(row)?,
                        false,
                    ))
                    .await?;
                outcome.conflicts_logged += 1;
            }
        }
    }

    for row in &response.users {
        let local_meta = user_repo.get_sync_metadata(row.user.id).await?;
        match resolve_user(local_meta, row.updated_at) {
            UserResolution::Insert | UserResolution::Apply => {
                let apply_result = user_repo
                    .apply_synced(
                        &row.user,
                        SyncMetadata {
                            updated_at: row.updated_at,
                            origin_peer_id: row.origin_peer_id,
                            deleted_at: row.deleted_at,
                        },
                    )
                    .await;
                match apply_result {
                    Ok(()) => outcome.users_applied += 1,
                    Err(err) if err.is_constraint_violation() => {
                        // E.g. two peers each independently created a user
                        // with the same `username` -- a different `id`, so
                        // `ON CONFLICT (id)` never sees it; the real
                        // failure is `users.username`'s own `UNIQUE` index.
                        // Isolate this one row rather than letting it stall
                        // every other row (and every later phase) forever.
                        log_apply_failure(
                            conflict_log_repo,
                            &mut outcome,
                            "user",
                            row.user.id,
                            self_peer_id,
                            row.origin_peer_id.unwrap_or(peer_node_id),
                            row,
                            &err,
                        )
                        .await?;
                    }
                    Err(err) => return Err(err.into()),
                }
            }
            UserResolution::Reject => {
                let local_meta = local_meta.expect("Reject only returned when a local row exists");
                conflict_log_repo
                    .create(&conflict_log(
                        "user",
                        row.user.id,
                        local_meta.origin_peer_id.unwrap_or(self_peer_id),
                        row.origin_peer_id.unwrap_or(peer_node_id),
                        serde_json::to_string(row)?,
                        false,
                    ))
                    .await?;
                outcome.conflicts_logged += 1;
            }
        }
    }

    sync_state_repo
        .upsert(&streamarr_db::PeerSyncState {
            peer_node_id,
            entity: ENTITY.to_string(),
            cursor: Some(response.server_time),
            last_synced_at: Some(Utc::now()),
        })
        .await?;

    Ok(outcome)
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct InvitesSyncOutcome {
    pub invites_applied: usize,
    pub invite_requests_applied: usize,
}

/// Syncs `user_invites`/`user_invite_requests` from `base_url`'s `GET
/// /api/v1/peer/invites`. Neither is plain last-writer-wins -- see this
/// module's own doc comment for `UserInviteRepo::upsert`'s narrower
/// consumption ratchet and `UserInviteRequestRepo::upsert`'s unconditional
/// apply.
pub async fn sync_invites(
    peer_client: &PeerClient,
    base_url: &str,
    peer_node_id: Uuid,
    invite_repo: &Arc<dyn UserInviteRepo>,
    invite_request_repo: &Arc<dyn UserInviteRequestRepo>,
    sync_state_repo: &Arc<dyn streamarr_db::PeerSyncStateRepo>,
) -> Result<InvitesSyncOutcome, AccountSyncError> {
    const ENTITY: &str = "invites";
    let cursor = sync_state_repo
        .get(peer_node_id, ENTITY)
        .await?
        .and_then(|state| state.cursor);
    let path = match &cursor {
        Some(cursor) => format!("/api/v1/peer/invites?since={cursor}"),
        None => "/api/v1/peer/invites".to_string(),
    };
    let response: InvitesResponse = peer_client.signed_get(base_url, &path).await?;

    let mut outcome = InvitesSyncOutcome::default();
    for invite in &response.invites {
        invite_repo.upsert(invite).await?;
        outcome.invites_applied += 1;
    }
    for request in &response.invite_requests {
        invite_request_repo.upsert(request).await?;
        outcome.invite_requests_applied += 1;
    }

    sync_state_repo
        .upsert(&streamarr_db::PeerSyncState {
            peer_node_id,
            entity: ENTITY.to_string(),
            cursor: Some(response.server_time),
            last_synced_at: Some(Utc::now()),
        })
        .await?;

    Ok(outcome)
}

/// Syncs `group_libraries` from `base_url`'s `GET /api/v1/peer/libraries`.
/// Plain LWW by `updated_at` -- `GroupLibrary` has no privilege-bearing
/// field, so no origin gating applies (§3.5's gating rule is scoped to
/// `User`/`Policy` only).
pub async fn sync_libraries(
    peer_client: &PeerClient,
    base_url: &str,
    peer_node_id: Uuid,
    self_peer_id: Uuid,
    group_library_repo: &Arc<dyn GroupLibraryRepo>,
    sync_state_repo: &Arc<dyn streamarr_db::PeerSyncStateRepo>,
    conflict_log_repo: &Arc<dyn SyncConflictLogRepo>,
) -> Result<usize, AccountSyncError> {
    const ENTITY: &str = "libraries";
    let cursor = sync_state_repo
        .get(peer_node_id, ENTITY)
        .await?
        .and_then(|state| state.cursor);
    let path = match &cursor {
        Some(cursor) => format!("/api/v1/peer/libraries?since={cursor}"),
        None => "/api/v1/peer/libraries".to_string(),
    };
    let response: LibrariesResponse = peer_client.signed_get(base_url, &path).await?;

    let mut applied = 0usize;
    for library in &response.group_libraries {
        let existing = group_library_repo.get(library.id).await?;
        match &existing {
            None => {
                group_library_repo.upsert(library).await?;
                applied += 1;
            }
            Some(existing_row) if library.updated_at > existing_row.updated_at => {
                group_library_repo.upsert(library).await?;
                applied += 1;
            }
            Some(_) => {
                conflict_log_repo
                    .create(&conflict_log(
                        "group_library",
                        library.id,
                        self_peer_id,
                        peer_node_id,
                        serde_json::to_string(library)?,
                        false,
                    ))
                    .await?;
            }
        }
    }

    sync_state_repo
        .upsert(&streamarr_db::PeerSyncState {
            peer_node_id,
            entity: ENTITY.to_string(),
            cursor: Some(response.server_time),
            last_synced_at: Some(Utc::now()),
        })
        .await?;

    Ok(applied)
}

#[cfg(test)]
mod tests {
    use base64::Engine;
    use chrono::Duration;
    use serde_json::json;
    use streamarr_model::{ClientPlatform, Sensitive};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::signing::PeerIdentity;

    fn sample_user(id: Uuid, policy_id: Uuid) -> User {
        User {
            id,
            username: format!("user-{id}"),
            display_name: "Display Name".to_string(),
            email: None,
            password_hash: Sensitive::new("hash".to_string()),
            policy_id,
            created_at: Utc::now(),
            disabled: false,
            preferred_audio_language: "en".to_string(),
        }
    }

    /// `users.policy_id` is a real `REFERENCES policies (id)` foreign key --
    /// every test that writes a `User` row through a real repo (not just a
    /// pure in-memory `resolve_*` check) needs a persisted `Policy` row to
    /// point at first, same as `streamarr-db::repo::user`'s own tests.
    async fn seed_policy(pool: &streamarr_db::DbPool) -> Uuid {
        let policy = sample_policy(Uuid::new_v4());
        streamarr_db::repo::SqlxPolicyRepo::new(pool.clone())
            .upsert(&policy)
            .await
            .unwrap();
        policy.id
    }

    fn sample_policy(id: Uuid) -> Policy {
        Policy {
            id,
            name: "Policy".to_string(),
            library_allow: vec![],
            group_library_allow: vec![],
            blocked_folders: vec![],
            max_rating: None,
            blocked_tags: vec![],
            allowed_tags: vec![],
            can_transcode: true,
            can_download: false,
            can_delete: false,
            can_share_public: false,
            device_allow: vec![ClientPlatform::Web],
            max_concurrent_sessions: None,
            access_schedule: None,
            can_stream: true,
            is_admin: false,
        }
    }

    // ---- resolve_user ----

    #[test]
    fn resolve_user_inserts_when_no_local_row_exists() {
        assert_eq!(resolve_user(None, Utc::now()), UserResolution::Insert);
    }

    #[test]
    fn resolve_user_applies_a_strictly_newer_incoming_write() {
        let now = Utc::now();
        let local = SyncMetadata {
            updated_at: now - Duration::minutes(5),
            origin_peer_id: None,
            deleted_at: None,
        };
        assert_eq!(resolve_user(Some(local), now), UserResolution::Apply);
    }

    #[test]
    fn resolve_user_rejects_a_stale_or_equal_incoming_write() {
        let now = Utc::now();
        let local = SyncMetadata {
            updated_at: now,
            origin_peer_id: None,
            deleted_at: None,
        };
        assert_eq!(resolve_user(Some(local), now), UserResolution::Reject);
        assert_eq!(
            resolve_user(Some(local), now - Duration::seconds(1)),
            UserResolution::Reject
        );
    }

    // ---- resolve_policy ----

    #[test]
    fn resolve_policy_inserts_when_no_local_row_exists() {
        assert_eq!(
            resolve_policy(None, Utc::now(), Some(Uuid::new_v4())),
            PolicyResolution::Insert
        );
    }

    #[test]
    fn resolve_policy_rejects_a_stale_incoming_write_regardless_of_origin() {
        let now = Utc::now();
        let local = SyncMetadata {
            updated_at: now,
            origin_peer_id: Some(Uuid::new_v4()),
            deleted_at: None,
        };
        assert_eq!(
            resolve_policy(Some(local), now - Duration::seconds(1), local.origin_peer_id),
            PolicyResolution::Reject
        );
    }

    #[test]
    fn resolve_policy_applies_whole_row_when_origin_matches() {
        let now = Utc::now();
        let origin = Uuid::new_v4();
        let local = SyncMetadata {
            updated_at: now - Duration::minutes(1),
            origin_peer_id: Some(origin),
            deleted_at: None,
        };
        assert_eq!(
            resolve_policy(Some(local), now, Some(origin)),
            PolicyResolution::ApplyWhole
        );
    }

    #[test]
    fn resolve_policy_applies_whole_row_when_local_has_no_known_origin_yet() {
        let now = Utc::now();
        let local = SyncMetadata {
            updated_at: now - Duration::minutes(1),
            origin_peer_id: None,
            deleted_at: None,
        };
        assert_eq!(
            resolve_policy(Some(local), now, Some(Uuid::new_v4())),
            PolicyResolution::ApplyWhole
        );
    }

    #[test]
    fn resolve_policy_gates_privileged_fields_on_an_origin_mismatch() {
        let now = Utc::now();
        let local = SyncMetadata {
            updated_at: now - Duration::minutes(1),
            origin_peer_id: Some(Uuid::new_v4()),
            deleted_at: None,
        };
        // A different, non-origin peer's write is newer but must not
        // auto-apply its privileged fields -- the core §3.5 defense.
        assert_eq!(
            resolve_policy(Some(local), now, Some(Uuid::new_v4())),
            PolicyResolution::ApplyNonPrivilegedOnly
        );
    }

    // ---- merge_non_privileged_policy_fields ----

    #[test]
    fn merge_keeps_every_privileged_field_from_local() {
        let id = Uuid::new_v4();
        let mut local = sample_policy(id);
        local.is_admin = true;
        local.can_download = true;
        local.can_delete = true;
        local.can_share_public = true;
        local.can_stream = true;
        local.library_allow = vec![Uuid::new_v4()];
        local.group_library_allow = vec![Uuid::new_v4()];
        local.device_allow = vec![ClientPlatform::Web];

        let mut incoming = sample_policy(id);
        incoming.is_admin = false;
        incoming.can_download = false;
        incoming.can_delete = false;
        incoming.can_share_public = false;
        incoming.can_stream = false;
        incoming.library_allow = vec![Uuid::new_v4(), Uuid::new_v4()];
        incoming.group_library_allow = vec![Uuid::new_v4(), Uuid::new_v4()];
        incoming.device_allow = vec![];
        incoming.name = "Escalation Attempt".to_string();

        let merged = merge_non_privileged_policy_fields(&local, &incoming);

        assert!(merged.is_admin, "is_admin must not move from a non-origin peer");
        assert!(merged.can_download);
        assert!(merged.can_delete);
        assert!(merged.can_share_public);
        assert!(merged.can_stream);
        assert_eq!(merged.library_allow, local.library_allow);
        assert_eq!(
            merged.group_library_allow, local.group_library_allow,
            "group_library_allow must not move from a non-origin peer either"
        );
        assert_eq!(merged.device_allow, local.device_allow);
        // Non-privileged fields do move.
        assert_eq!(merged.name, "Escalation Attempt");
    }

    #[test]
    fn merge_takes_non_privileged_fields_from_incoming() {
        let id = Uuid::new_v4();
        let local = sample_policy(id);
        let mut incoming = sample_policy(id);
        incoming.name = "Renamed".to_string();
        incoming.blocked_folders = vec!["/data/staging".to_string()];
        incoming.max_rating = Some("PG-13".to_string());
        incoming.can_transcode = !local.can_transcode;
        incoming.max_concurrent_sessions = Some(2);

        let merged = merge_non_privileged_policy_fields(&local, &incoming);

        assert_eq!(merged.name, "Renamed");
        assert_eq!(merged.blocked_folders, incoming.blocked_folders);
        assert_eq!(merged.max_rating, incoming.max_rating);
        assert_eq!(merged.can_transcode, incoming.can_transcode);
        assert_eq!(merged.max_concurrent_sessions, incoming.max_concurrent_sessions);
    }

    // ---- wire DTO round trip ----

    #[test]
    fn user_sync_row_serializes_flattened() {
        let row = UserSyncRow {
            user: sample_user(Uuid::new_v4(), Uuid::new_v4()),
            updated_at: Utc::now(),
            origin_peer_id: Some(Uuid::new_v4()),
            deleted_at: None,
        };
        let json = serde_json::to_value(&row).unwrap();
        // `#[serde(flatten)]` puts `User`'s own fields directly on the
        // object, alongside the sync-only ones, rather than nesting under a
        // `"user"` key -- assert the shape a real `peer.rs` handler would
        // need to produce/consume.
        assert_eq!(json["username"], serde_json::json!(row.user.username));
        assert!(json.get("user").is_none());
        assert!(json.get("updated_at").is_some());

        let round_tripped: UserSyncRow = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped.user.id, row.user.id);
        assert_eq!(round_tripped.origin_peer_id, row.origin_peer_id);
    }

    // ---- end-to-end: sync_accounts / sync_libraries / sync_invites against a real DB + mock peer ----

    struct Harness {
        pool: streamarr_db::DbPool,
        user_repo: Arc<dyn UserRepo>,
        policy_repo: Arc<dyn PolicyRepo>,
        group_library_repo: Arc<dyn GroupLibraryRepo>,
        invite_repo: Arc<dyn UserInviteRepo>,
        invite_request_repo: Arc<dyn UserInviteRequestRepo>,
        sync_state_repo: Arc<dyn streamarr_db::PeerSyncStateRepo>,
        conflict_log_repo: Arc<dyn SyncConflictLogRepo>,
    }

    async fn harness() -> Harness {
        sqlx::any::install_default_drivers();
        let pool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        streamarr_db::run_migrations(&pool, false).await.unwrap();
        Harness {
            pool: pool.clone(),
            user_repo: Arc::new(streamarr_db::repo::SqlxUserRepo::new(pool.clone())),
            policy_repo: Arc::new(streamarr_db::repo::SqlxPolicyRepo::new(pool.clone())),
            group_library_repo: Arc::new(streamarr_db::repo::SqlxGroupLibraryRepo::new(pool.clone())),
            invite_repo: Arc::new(streamarr_db::repo::SqlxUserInviteRepo::new(pool.clone())),
            invite_request_repo: Arc::new(streamarr_db::repo::SqlxUserInviteRequestRepo::new(pool.clone())),
            sync_state_repo: Arc::new(streamarr_db::repo::SqlxPeerSyncStateRepo::new(pool.clone())),
            conflict_log_repo: Arc::new(streamarr_db::repo::SqlxSyncConflictLogRepo::new(pool)),
        }
    }

    /// Same as [`harness`], but with SQLite's foreign-key enforcement
    /// turned on for this connection. SQLite defaults it OFF (this
    /// codebase's real pool never issues `PRAGMA foreign_keys = ON`
    /// either, see `streamarr_db::pool`), which is exactly why an
    /// application-order bug against `users.policy_id REFERENCES policies
    /// (id)` can hide in every other test in this file: Postgres (the tier
    /// every real multi-node peer group actually runs on, since a Tier-1
    /// single node has no peer to sync with in the first place) enforces
    /// that foreign key immediately, not deferred. Turning the pragma on
    /// here gives this crate's own test suite an equivalent, fast,
    /// no-Postgres-required way to catch that class of ordering bug
    /// locally instead of only in a real multi-node deployment.
    async fn harness_with_fk_enforcement() -> Harness {
        let harness = harness().await;
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&harness.pool)
            .await
            .unwrap();
        harness
    }

    fn client() -> PeerClient {
        let seed_b64 = base64::engine::general_purpose::STANDARD.encode([9u8; 32]);
        let identity = PeerIdentity::from_seed_b64(Uuid::new_v4(), &seed_b64).unwrap();
        PeerClient::new(reqwest::Client::new(), identity)
    }

    #[tokio::test]
    async fn sync_accounts_inserts_a_new_user_then_applies_a_strictly_newer_update() {
        let mock = MockServer::start().await;
        let harness = harness().await;
        let peer_node_id = Uuid::new_v4();
        let self_peer_id = Uuid::new_v4();
        let policy_id = seed_policy(&harness.pool).await;
        let user = sample_user(Uuid::new_v4(), policy_id);
        let origin = Uuid::new_v4();
        let first_updated_at = Utc::now();

        Mock::given(method("GET"))
            .and(path("/api/v1/peer/accounts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "users": [{
                    "id": user.id, "username": user.username, "display_name": user.display_name,
                    "email": user.email, "password_hash": "hash", "policy_id": user.policy_id,
                    "created_at": user.created_at, "disabled": user.disabled,
                    "preferred_audio_language": user.preferred_audio_language,
                    "updated_at": first_updated_at, "origin_peer_id": origin, "deleted_at": null,
                }],
                "policies": [],
                "server_time": "cursor-1",
            })))
            .up_to_n_times(1)
            .mount(&mock)
            .await;

        let outcome = sync_accounts(
            &client(),
            &mock.uri(),
            peer_node_id,
            self_peer_id,
            &harness.user_repo,
            &harness.policy_repo,
            &harness.sync_state_repo,
            &harness.conflict_log_repo,
        )
        .await
        .expect("first sync succeeds");
        assert_eq!(outcome.users_applied, 1);
        assert_eq!(outcome.conflicts_logged, 0);
        assert!(harness.user_repo.find_by_id(user.id).await.unwrap().is_some());

        let cursor = harness
            .sync_state_repo
            .get(peer_node_id, "accounts")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(cursor.cursor.as_deref(), Some("cursor-1"));

        // A second pass reporting the same row with a strictly newer
        // `updated_at` must apply (plain LWW `Apply`, not `Reject`).
        let later_updated_at = first_updated_at + Duration::minutes(10);
        Mock::given(method("GET"))
            .and(path("/api/v1/peer/accounts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "users": [{
                    "id": user.id, "username": "renamed", "display_name": user.display_name,
                    "email": user.email, "password_hash": "hash", "policy_id": user.policy_id,
                    "created_at": user.created_at, "disabled": user.disabled,
                    "preferred_audio_language": user.preferred_audio_language,
                    "updated_at": later_updated_at, "origin_peer_id": origin, "deleted_at": null,
                }],
                "policies": [],
                "server_time": "cursor-2",
            })))
            .mount(&mock)
            .await;

        let outcome = sync_accounts(
            &client(),
            &mock.uri(),
            peer_node_id,
            self_peer_id,
            &harness.user_repo,
            &harness.policy_repo,
            &harness.sync_state_repo,
            &harness.conflict_log_repo,
        )
        .await
        .expect("second sync succeeds");
        assert_eq!(outcome.users_applied, 1);
        assert_eq!(outcome.conflicts_logged, 0);
        let fetched = harness.user_repo.find_by_id(user.id).await.unwrap().unwrap();
        assert_eq!(fetched.username, "renamed");
    }

    #[tokio::test]
    async fn sync_accounts_rejects_a_stale_write_and_logs_it_for_review_free_visibility() {
        let mock = MockServer::start().await;
        let harness = harness().await;
        let peer_node_id = Uuid::new_v4();
        let self_peer_id = Uuid::new_v4();
        let policy_id = seed_policy(&harness.pool).await;
        let user = sample_user(Uuid::new_v4(), policy_id);
        let local_origin = Uuid::new_v4();

        // Seed a local row via `apply_synced` with a recent `updated_at`.
        let now = Utc::now();
        harness
            .user_repo
            .apply_synced(
                &user,
                SyncMetadata {
                    updated_at: now,
                    origin_peer_id: Some(local_origin),
                    deleted_at: None,
                },
            )
            .await
            .unwrap();

        // A peer reports an older write for the same user.
        let stale_updated_at = now - Duration::hours(1);
        Mock::given(method("GET"))
            .and(path("/api/v1/peer/accounts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "users": [{
                    "id": user.id, "username": "stale-name", "display_name": user.display_name,
                    "email": user.email, "password_hash": "hash", "policy_id": user.policy_id,
                    "created_at": user.created_at, "disabled": user.disabled,
                    "preferred_audio_language": user.preferred_audio_language,
                    "updated_at": stale_updated_at, "origin_peer_id": Uuid::new_v4(), "deleted_at": null,
                }],
                "policies": [],
                "server_time": "cursor-1",
            })))
            .mount(&mock)
            .await;

        let outcome = sync_accounts(
            &client(),
            &mock.uri(),
            peer_node_id,
            self_peer_id,
            &harness.user_repo,
            &harness.policy_repo,
            &harness.sync_state_repo,
            &harness.conflict_log_repo,
        )
        .await
        .unwrap();
        assert_eq!(outcome.users_applied, 0);
        assert_eq!(outcome.conflicts_logged, 1);

        // The local row must be untouched by the losing write.
        let fetched = harness.user_repo.find_by_id(user.id).await.unwrap().unwrap();
        assert_eq!(fetched.username, user.username);

        let pending = harness.conflict_log_repo.list_requiring_review().await.unwrap();
        // Plain LWW loss is informational, not review-required.
        assert!(pending.is_empty());
    }

    #[tokio::test]
    async fn sync_accounts_gates_privileged_policy_fields_on_origin_mismatch_and_flags_for_review() {
        let mock = MockServer::start().await;
        let harness = harness().await;
        let peer_node_id = Uuid::new_v4();
        let self_peer_id = Uuid::new_v4();
        let policy_id = Uuid::new_v4();
        let local_origin = Uuid::new_v4();
        let mut local_policy = sample_policy(policy_id);
        local_policy.is_admin = true;

        harness
            .policy_repo
            .apply_synced(
                &local_policy,
                SyncMetadata {
                    updated_at: Utc::now() - Duration::minutes(30),
                    origin_peer_id: Some(local_origin),
                    deleted_at: None,
                },
            )
            .await
            .unwrap();

        // A *different*, non-origin peer reports a newer write that also
        // tries to flip `is_admin` off.
        let attacker_origin = Uuid::new_v4();
        let incoming_updated_at = Utc::now();
        Mock::given(method("GET"))
            .and(path("/api/v1/peer/accounts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "users": [],
                "policies": [{
                    "id": policy_id, "name": "Renamed By Attacker", "library_allow": [],
                    "group_library_allow": [],
                    "blocked_folders": [], "max_rating": null, "blocked_tags": [], "allowed_tags": [],
                    "can_transcode": true, "can_download": false, "can_delete": false,
                    "can_share_public": false, "device_allow": [], "max_concurrent_sessions": null,
                    "access_schedule": null, "can_stream": true, "is_admin": false,
                    "updated_at": incoming_updated_at, "origin_peer_id": attacker_origin, "deleted_at": null,
                }],
                "server_time": "cursor-1",
            })))
            .mount(&mock)
            .await;

        let outcome = sync_accounts(
            &client(),
            &mock.uri(),
            peer_node_id,
            self_peer_id,
            &harness.user_repo,
            &harness.policy_repo,
            &harness.sync_state_repo,
            &harness.conflict_log_repo,
        )
        .await
        .unwrap();
        assert_eq!(outcome.policies_applied, 1);
        assert_eq!(outcome.conflicts_logged, 1);

        let fetched = harness.policy_repo.find_by_id(policy_id).await.unwrap().unwrap();
        assert!(fetched.is_admin, "is_admin must survive an origin-mismatched write");
        assert_eq!(
            fetched.name, "Renamed By Attacker",
            "non-privileged fields still apply from the newer write"
        );

        let pending = harness.conflict_log_repo.list_requiring_review().await.unwrap();
        assert_eq!(pending.len(), 1, "a privilege-gated conflict requires admin review");
        assert_eq!(pending[0].entity_type, "policy");
    }

    /// Regression test for the exact bug a real second-node sync pass
    /// surfaces that no other test in this file does: every other test
    /// here pre-seeds the `Policy` a synced `User` points at, so none of
    /// them exercise a page where *both* rows are new at once -- the
    /// ordinary shape of an admin creating a `Policy` and immediately
    /// assigning a new `User` to it, then one poll interval later
    /// syncing both together in the same `since=` response.
    /// `users.policy_id REFERENCES policies (id)` means applying the user
    /// before its policy exists 404s the whole page on Postgres (enforced
    /// immediately, not deferred); `sync_accounts` must apply `policies`
    /// before `users` for exactly this reason.
    #[tokio::test]
    async fn sync_accounts_applies_a_brand_new_policy_and_its_brand_new_user_in_the_same_page() {
        let mock = MockServer::start().await;
        let harness = harness_with_fk_enforcement().await;
        let peer_node_id = Uuid::new_v4();
        let self_peer_id = Uuid::new_v4();

        let policy = sample_policy(Uuid::new_v4());
        let user = sample_user(Uuid::new_v4(), policy.id);
        let now = Utc::now();
        let origin = Uuid::new_v4();

        let user_row = UserSyncRow {
            user: user.clone(),
            updated_at: now,
            origin_peer_id: Some(origin),
            deleted_at: None,
        };
        let policy_row = PolicySyncRow {
            policy: policy.clone(),
            updated_at: now,
            origin_peer_id: Some(origin),
            deleted_at: None,
        };

        Mock::given(method("GET"))
            .and(path("/api/v1/peer/accounts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "users": [user_row],
                "policies": [policy_row],
                "server_time": "cursor-1",
            })))
            .mount(&mock)
            .await;

        let outcome = sync_accounts(
            &client(),
            &mock.uri(),
            peer_node_id,
            self_peer_id,
            &harness.user_repo,
            &harness.policy_repo,
            &harness.sync_state_repo,
            &harness.conflict_log_repo,
        )
        .await
        .expect(
            "a brand-new user and its brand-new policy arriving in the same page must both \
             apply -- this fails with a foreign key violation if users are ever applied \
             before policies",
        );
        assert_eq!(outcome.users_applied, 1);
        assert_eq!(outcome.policies_applied, 1);
        assert!(harness.policy_repo.find_by_id(policy.id).await.unwrap().is_some());
        assert!(harness.user_repo.find_by_id(user.id).await.unwrap().is_some());

        let cursor = harness
            .sync_state_repo
            .get(peer_node_id, "accounts")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            cursor.cursor.as_deref(),
            Some("cursor-1"),
            "the cursor must advance -- a page that fails part-way never persists one, which \
             would otherwise re-fetch and re-fail this exact page forever"
        );
    }

    /// Regression test for the exact bug `peer_group_e2e_test.rs`'s own
    /// two-node E2E test found *by accident* (see that module's own doc
    /// comment): two peers each create a genuinely different `User` that
    /// happens to share a `username`. Different `id`s, so `apply_synced`'s
    /// `ON CONFLICT (id)` upsert never sees the collision -- the real
    /// failure is `users.username`'s own `UNIQUE` index, on a different
    /// column entirely -- and before this fix the raw constraint-violation
    /// error propagated straight out of `sync_accounts`, aborting the page
    /// before the cursor ever advanced. Because the cursor only advances on
    /// full success, every later retry re-fetched and re-failed on the
    /// exact same colliding row, forever, taking every other row on the
    /// page (and, in `poller.rs`, every later phase) down with it.
    ///
    /// Unlike the FK-ordering regression test above, this one doesn't need
    /// `harness_with_fk_enforcement()`: `users.username`'s `UNIQUE` index is
    /// enforced by SQLite unconditionally, independent of the `PRAGMA
    /// foreign_keys` toggle that only guards *foreign key* checks.
    #[tokio::test]
    async fn sync_accounts_isolates_a_username_collision_and_still_applies_the_rest_of_the_page() {
        let mock = MockServer::start().await;
        let harness = harness().await;
        let peer_node_id = Uuid::new_v4();
        let self_peer_id = Uuid::new_v4();

        // This node already has its own local "admin" user (created before
        // ever joining a group, or synced in from a third peer earlier) --
        // exactly the shape that makes two peers' usernames collide without
        // either side having done anything wrong.
        let local_policy_id = seed_policy(&harness.pool).await;
        let mut local_admin = sample_user(Uuid::new_v4(), local_policy_id);
        local_admin.username = "admin".to_string();
        harness
            .user_repo
            .apply_synced(
                &local_admin,
                SyncMetadata {
                    updated_at: Utc::now() - Duration::hours(1),
                    origin_peer_id: None,
                    deleted_at: None,
                },
            )
            .await
            .unwrap();

        // The peer reports two brand-new users in the same page: one whose
        // username genuinely collides with the local "admin" (a different
        // `id` -- two independently-created accounts, not the same account
        // synced twice) and one that doesn't.
        let colliding_policy = sample_policy(Uuid::new_v4());
        let good_policy = sample_policy(Uuid::new_v4());
        let mut colliding_user = sample_user(Uuid::new_v4(), colliding_policy.id);
        colliding_user.username = "admin".to_string();
        let mut good_user = sample_user(Uuid::new_v4(), good_policy.id);
        good_user.username = "someone-else".to_string();
        let now = Utc::now();
        let origin = Uuid::new_v4();

        let colliding_user_row = UserSyncRow {
            user: colliding_user.clone(),
            updated_at: now,
            origin_peer_id: Some(origin),
            deleted_at: None,
        };
        let good_user_row = UserSyncRow {
            user: good_user.clone(),
            updated_at: now,
            origin_peer_id: Some(origin),
            deleted_at: None,
        };
        let colliding_policy_row = PolicySyncRow {
            policy: colliding_policy.clone(),
            updated_at: now,
            origin_peer_id: Some(origin),
            deleted_at: None,
        };
        let good_policy_row = PolicySyncRow {
            policy: good_policy.clone(),
            updated_at: now,
            origin_peer_id: Some(origin),
            deleted_at: None,
        };

        Mock::given(method("GET"))
            .and(path("/api/v1/peer/accounts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "users": [colliding_user_row, good_user_row],
                "policies": [colliding_policy_row, good_policy_row],
                "server_time": "cursor-1",
            })))
            .mount(&mock)
            .await;

        let outcome = sync_accounts(
            &client(),
            &mock.uri(),
            peer_node_id,
            self_peer_id,
            &harness.user_repo,
            &harness.policy_repo,
            &harness.sync_state_repo,
            &harness.conflict_log_repo,
        )
        .await
        .expect(
            "a username collision on one row must not abort the whole sync pass -- it should be \
             isolated and logged, not propagated as an error",
        );

        // Both policies applied fine -- `policies` carries no `UNIQUE`
        // constraint besides `id`, so neither collides.
        assert_eq!(outcome.policies_applied, 2);
        // Only the non-colliding user applied.
        assert_eq!(outcome.users_applied, 1);
        // Exactly the colliding row was logged.
        assert_eq!(outcome.conflicts_logged, 1);

        assert!(
            harness.user_repo.find_by_id(colliding_user.id).await.unwrap().is_none(),
            "the colliding row must never have been inserted"
        );
        assert!(
            harness.user_repo.find_by_id(good_user.id).await.unwrap().is_some(),
            "the other row on the same page must still apply despite the earlier row's failure"
        );
        let existing_admin = harness.user_repo.find_by_id(local_admin.id).await.unwrap().unwrap();
        assert_eq!(
            existing_admin.username, "admin",
            "the pre-existing local row that owns the contested username must be untouched"
        );

        let pending = harness.conflict_log_repo.list_requiring_review().await.unwrap();
        assert_eq!(pending.len(), 1, "the collision needs a human decision, not a silent drop");
        assert_eq!(pending[0].entity_type, "user");
        assert_eq!(pending[0].entity_id, colliding_user.id);
        assert!(pending[0].requires_admin_review);
        assert!(
            pending[0].losing_value_json.contains("apply_error"),
            "the logged row must capture *why* it was skipped, not just its contents"
        );
        assert!(pending[0].losing_value_json.contains("admin"));

        // The cursor must still have advanced -- the whole point of this
        // fix: a skipped-and-logged row must not be retried forever on
        // every subsequent cycle.
        let cursor = harness
            .sync_state_repo
            .get(peer_node_id, "accounts")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(cursor.cursor.as_deref(), Some("cursor-1"));
    }

    #[tokio::test]
    async fn sync_libraries_applies_a_newer_row_and_rejects_a_stale_one() {
        let mock = MockServer::start().await;
        let harness = harness().await;
        let peer_node_id = Uuid::new_v4();
        let self_peer_id = Uuid::new_v4();
        let group_id = Uuid::new_v4();
        // `group_libraries.group_id` is a real `REFERENCES peer_groups (id)`
        // foreign key -- seeded with a raw insert the same way `streamarr-db`'s
        // own `group_library.rs`/`peer_node.rs` tests do for the identical
        // constraint (this crate can't call their `pub(crate)`
        // `codec::format_datetime`, but the FK only cares that the row
        // exists, not the exact textual shape of `created_at`).
        sqlx::query("INSERT INTO peer_groups (id, name, created_at) VALUES (?, ?, ?)")
            .bind(group_id.to_string())
            .bind("test group")
            .bind(Utc::now().to_rfc3339())
            .execute(&harness.pool)
            .await
            .unwrap();

        let new_library_id = Uuid::new_v4();
        let stale_library_id = Uuid::new_v4();
        let now = Utc::now();

        // Seed a local row that a peer's stale report will lose against.
        harness
            .group_library_repo
            .upsert(&GroupLibrary {
                id: stale_library_id,
                group_id,
                name: "Local Name".to_string(),
                created_at: now,
                updated_at: now,
            })
            .await
            .unwrap();

        Mock::given(method("GET"))
            .and(path("/api/v1/peer/libraries"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "group_libraries": [
                    {
                        "id": new_library_id, "group_id": group_id, "name": "Movies",
                        "created_at": now, "updated_at": now,
                    },
                    {
                        "id": stale_library_id, "group_id": group_id, "name": "Stale Rename",
                        "created_at": now, "updated_at": now - Duration::hours(1),
                    },
                ],
                "server_time": "cursor-1",
            })))
            .mount(&mock)
            .await;

        let applied = sync_libraries(
            &client(),
            &mock.uri(),
            peer_node_id,
            self_peer_id,
            &harness.group_library_repo,
            &harness.sync_state_repo,
            &harness.conflict_log_repo,
        )
        .await
        .unwrap();
        assert_eq!(applied, 1);

        assert!(harness.group_library_repo.get(new_library_id).await.unwrap().is_some());
        let stale = harness.group_library_repo.get(stale_library_id).await.unwrap().unwrap();
        assert_eq!(stale.name, "Local Name", "the stale incoming rename must not apply");

        let pending = harness.conflict_log_repo.list_requiring_review().await.unwrap();
        assert!(pending.is_empty(), "group_library conflicts are plain LWW, not review-required");
    }

    #[tokio::test]
    async fn sync_invites_gossips_new_invites_and_requests_forward() {
        let mock = MockServer::start().await;
        let harness = harness().await;
        let peer_node_id = Uuid::new_v4();

        let policy = sample_policy(Uuid::new_v4());
        streamarr_db::repo::SqlxPolicyRepo::new(harness.pool.clone())
            .upsert(&policy)
            .await
            .unwrap();
        let admin = sample_user(Uuid::new_v4(), policy.id);
        harness.user_repo.upsert(&admin).await.unwrap();

        let invite = UserInvite {
            token_hash: "gossiped-hash".to_string(),
            created_by: admin.id,
            created_at: Utc::now(),
            expires_at: Utc::now() + Duration::hours(24),
            can_stream: true,
            library_allow: vec![],
            group_library_allow: vec![],
            consumed_at: None,
            consumed_by_user_id: None,
            consumed_by_peer_id: None,
        };
        let request = UserInviteRequest {
            id: Uuid::new_v4(),
            user_id: admin.id,
            message: None,
            status: streamarr_model::UserInviteRequestStatus::Pending,
            requested_at: Utc::now(),
            reviewed_by: None,
            reviewed_at: None,
            generated_at: None,
            can_stream: false,
            library_allow: vec![],
            group_library_allow: vec![],
        };

        Mock::given(method("GET"))
            .and(path("/api/v1/peer/invites"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "invites": [invite],
                "invite_requests": [request],
                "server_time": "cursor-1",
            })))
            .mount(&mock)
            .await;

        let outcome = sync_invites(
            &client(),
            &mock.uri(),
            peer_node_id,
            &harness.invite_repo,
            &harness.invite_request_repo,
            &harness.sync_state_repo,
        )
        .await
        .unwrap();
        assert_eq!(outcome.invites_applied, 1);
        assert_eq!(outcome.invite_requests_applied, 1);

        let fetched_request = harness
            .invite_request_repo
            .find_by_id(request.id)
            .await
            .unwrap();
        assert!(fetched_request.is_some());
    }
}
