//! Bearer-JWT authentication: [`AuthUser`] verifies `Authorization: Bearer
//! <token>` against `AppState::jwt` (the same `playarr_auth::JwtIssuer`
//! the RFC 8628 device flow, and `POST /api/v1/auth/login`, already issue
//! tokens through) and exposes the verified claims to any handler that
//! takes it as a parameter; [`AdminUser`] additionally requires the
//! caller's `sub` to resolve, via `AppState::user_repo` and
//! `AppState::policy_repo`, to a real, persisted `User` whose `Policy` has
//! `is_admin` set. This is the permanent replacement for the old
//! `AppState::admin_registry` id-list check -- `playarr_auth::admin`'s
//! doc comment used to describe that mechanism as "a deliberately interim
//! mechanism, not a permanent design", and this is exactly that
//! replacement landing: `AdminUser` no longer reads `admin_registry` at
//! all. Any lookup miss (unknown user id, or a user whose `Policy` id
//! doesn't resolve) and `is_admin == false` both fail closed with a 403 --
//! never a 500 -- so a database hiccup during the admin check denies admin
//! rather than silently granting it.
//!
//! [`StreamingUser`] is the Playarr-side counterpart: it requires the same
//! kind of resolved `Policy`, but checks `can_stream` instead of
//! `is_admin`, and deliberately does **not** let `is_admin` bypass that
//! check -- see `playarr_model::Policy::can_stream`'s doc comment for why
//! an admin account isn't automatically a Playarr viewer account. Gates the
//! catalog/playback handlers, the actual Playarr-facing surface.
//!
//! [`StreamingUser`] and [`CatalogViewer`] both retain the full resolved
//! `Policy` (not just the one field each extractor's own admission check
//! reads) as a named `policy` field, and expose
//! [`StreamingUser::allowed_libraries`]/[`CatalogViewer::allowed_libraries`]
//! over it -- the per-user library access control gate every catalog/
//! playback/playlist read path enforces via `Policy::library_allow`. This
//! is zero extra database work versus before: the `Policy` was already
//! being fetched by `resolve_policy` for the admission check itself, just
//! discarded afterwards; keeping it around only changes what the handler
//! does with a value it already paid to load.
//!
//! All three are real Axum extractors (`FromRequestParts`), not middleware
//! -- any handler opts in simply by taking one as a parameter, the same way
//! it already takes `State`/`Path`/`Query`. A missing/malformed/invalid/
//! expired token rejects with a real 401 before the handler body ever
//! runs; a valid token from a caller lacking the required grant rejects
//! `AdminUser`/`StreamingUser` (but not `AuthUser`) with a real 403.

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::{header, StatusCode};
use playarr_auth::AccessTokenClaims;
use playarr_model::Policy;
use uuid::Uuid;

use crate::error::ApiError;
use crate::AppState;

fn unauthorized(message: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::UNAUTHORIZED, "unauthorized", message)
}

fn bearer_token(parts: &Parts) -> Result<&str, ApiError> {
    let header_value = parts
        .headers
        .get(header::AUTHORIZATION)
        .ok_or_else(|| unauthorized("missing Authorization header"))?;
    let raw = header_value
        .to_str()
        .map_err(|_| unauthorized("Authorization header is not valid UTF-8"))?;
    raw.strip_prefix("Bearer ")
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| unauthorized("Authorization header must be `Bearer <token>`"))
}

/// A request whose `Authorization: Bearer <token>` header verified
/// successfully. `user_id` is `claims.sub` pulled out to a named field
/// since that's what every handler that uses this extractor actually
/// wants; the full `claims` are still available for handlers that need
/// `device_id`/`session_id` too.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub claims: AccessTokenClaims,
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = bearer_token(parts)?;
        let claims = state
            .jwt
            .verify_access_token(token)
            .await
            .map_err(|_| unauthorized("invalid or expired access token"))?;
        Ok(AuthUser {
            user_id: claims.sub,
            claims,
        })
    }
}

/// [`AuthUser`] plus proof the caller is an admin -- see the module doc
/// comment. Exposes `AuthUser`'s fields via [`std::ops::Deref`] so a
/// handler that took `AdminUser` can still just write `admin.user_id`.
#[derive(Debug, Clone)]
pub struct AdminUser(pub AuthUser);

impl std::ops::Deref for AdminUser {
    type Target = AuthUser;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

/// `pub(crate)`: also used by `login.rs`'s `login_handler`, which needs the
/// exact same "authenticated but lacking a specific grant" 403 shape for
/// its own pre-token-issuance `can_stream` check -- see that handler's doc
/// comment.
pub(crate) fn forbidden(message: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::FORBIDDEN, "forbidden", message)
}

/// The shared per-user library access control gate for
/// `playback.rs`/`media.rs`: a resolved [`playarr_model::MediaFile`]
/// already carries its own `source_instance_id` directly (unlike a `Work`,
/// which needs an extra `MediaFileRepo::list_by_work_id` lookup to
/// determine one -- see `playarr_catalog::BrowseQuery::
/// allowed_source_instance_ids`'s doc comment), so this needs no repository
/// call of its own at all: it's a pure comparison against the caller's
/// already-resolved [`StreamingUser::allowed_libraries`]/
/// [`CatalogViewer::allowed_libraries`]. `allowed: None` (an unrestricted
/// caller) always passes. This is the cheapest and most security-critical
/// enforcement point in the whole read path, since it gates actual content
/// delivery rather than just metadata visibility.
///
/// Per `docs/architecture/peer-groups.md` §5.1, `allowed` here is already
/// `policy.library_allow` unioned with `policy.group_library_allow` resolved
/// to local `SourceInstance` ids -- see [`StreamingUser::allowed_libraries`]/
/// [`CatalogViewer::allowed_libraries`], the only producers of this
/// parameter, both of which do that resolution once at extraction time
/// (`SourceInstanceRegistry::source_instance_ids_for_group_libraries`
/// needs `AppState`, which this free function deliberately doesn't take, to
/// keep this comparison itself a pure, zero-I/O check). The comparison
/// below is therefore unchanged by that addition: it only ever needed to
/// know the caller's *final* allowed set, not how that set was assembled.
pub(crate) fn ensure_library_allowed(
    source_instance_id: Uuid,
    allowed: Option<&[Uuid]>,
) -> Result<(), ApiError> {
    match allowed {
        Some(allowed) if !allowed.contains(&source_instance_id) => Err(forbidden(
            "this account does not have access to this library",
        )),
        _ => Ok(()),
    }
}

/// `a` deduplicated against `b`'s ids appended -- the shared union
/// [`StreamingUser::allowed_libraries`]/[`CatalogViewer::allowed_libraries`]
/// both use to combine `Policy::library_allow` with `Policy::
/// group_library_allow` resolved to local `SourceInstance` ids (§5.1). Not
/// `HashSet`-based: these lists are always small (a handful of libraries per
/// policy), and preserving `a`'s original order keeps `allowed_libraries()`
/// deterministic for callers/tests that compare the returned `Vec` directly.
fn union_library_ids(a: &[Uuid], b: &[Uuid]) -> Vec<Uuid> {
    let mut ids = a.to_vec();
    for id in b {
        if !ids.contains(id) {
            ids.push(*id);
        }
    }
    ids
}

/// Mirrors the `if !streaming.policy.can_transcode` inline check in
/// playback.rs's `playback_info_handler` -- factored out because
/// downloads.rs needs the identical check at multiple call sites.
pub(crate) fn ensure_can_download(policy: &Policy) -> Result<(), ApiError> {
    if policy.can_download {
        Ok(())
    } else {
        Err(forbidden("this account does not have download access"))
    }
}

/// Resolves `user_id`'s persisted `Policy` for a gated extractor, failing
/// closed on every branch: an unknown user, an unknown/missing policy, and
/// a real backend error all reject with the same caller-supplied `deny`
/// error -- none of them are a 500, and none of them accidentally grant
/// whatever the caller is checking for. Shared by [`AdminUser`] and
/// [`StreamingUser`] (and, via `pub(crate)`, `login.rs`'s pre-token-
/// issuance check) so the lookup/fail-closed logic lives in exactly one
/// place; only the final grant check (and the denial message) differs
/// between callers.
pub(crate) async fn resolve_policy(
    state: &AppState,
    user_id: Uuid,
    check_name: &str,
    deny: ApiError,
) -> Result<Policy, ApiError> {
    let record = state
        .user_repo
        .find_by_id(user_id)
        .await
        .map_err(|err| {
            tracing::warn!(
                %user_id,
                error = %err,
                "{check_name} check: user lookup failed; denying"
            );
            deny.clone()
        })?
        .ok_or_else(|| deny.clone())?;

    state
        .policy_repo
        .find_by_id(record.policy_id)
        .await
        .map_err(|err| {
            tracing::warn!(
                %user_id,
                policy_id = %record.policy_id,
                error = %err,
                "{check_name} check: policy lookup failed; denying"
            );
            deny.clone()
        })?
        .ok_or(deny)
}

/// Resolves `user_id`'s `Policy` and effective `allowed_libraries()` set
/// (same shape [`StreamingUser::allowed_libraries`] returns), independent
/// of any bearer token. Factored out of [`StreamingUser::from_request_parts`]
/// so a peer-forwarded playback negotiation
/// (`playback::peer_playback_info_handler`) can independently re-derive the
/// *same* grant from this node's own synced `Policy`/`User` state rather
/// than trusting the forwarding peer's assertion of what its caller is
/// allowed -- see `docs/architecture/peer-groups.md` §5.3's "defense in
/// depth" paragraph. `StreamingUser` itself is deliberately left untouched
/// by this addition (it still resolves everything inline) to avoid any risk
/// of changing its already-tested bearer-token behavior.
pub(crate) async fn resolve_streaming_access(
    state: &AppState,
    user_id: Uuid,
) -> Result<(Policy, Option<Vec<Uuid>>), ApiError> {
    let policy = resolve_policy(
        state,
        user_id,
        "streaming",
        forbidden("this account does not have Playarr streaming access"),
    )
    .await?;

    if !policy.can_stream {
        return Err(forbidden(
            "this account does not have Playarr streaming access",
        ));
    }

    let resolved_group_library_allow = state
        .source_instances
        .source_instance_ids_for_group_libraries(&policy.group_library_allow);
    let allowed_libraries = (!policy.is_admin)
        .then(|| union_library_ids(&policy.library_allow, &resolved_group_library_allow));
    Ok((policy, allowed_libraries))
}

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let user = AuthUser::from_request_parts(parts, state).await?;
        let policy = resolve_policy(
            state,
            user.user_id,
            "admin",
            forbidden("caller is not an admin"),
        )
        .await?;

        if policy.is_admin {
            Ok(AdminUser(user))
        } else {
            Err(forbidden("caller is not an admin"))
        }
    }
}

/// [`AuthUser`] plus proof the caller is permitted to use Playarr -- see the
/// module doc comment. Exposes `AuthUser`'s fields via [`std::ops::Deref`]
/// so a handler that took `StreamingUser` can still just write
/// `streaming.user_id`. Also carries the caller's full resolved `Policy`
/// (see [`Self::allowed_libraries`]) -- gates playback/media delivery to
/// exactly the library(ies) this account is allowed to see.
#[derive(Debug, Clone)]
pub struct StreamingUser {
    pub user: AuthUser,
    pub policy: Policy,
    /// `policy.group_library_allow` (portable, group-wide `GroupLibrary`
    /// ids, `docs/architecture/peer-groups.md` §5.1) resolved down to this
    /// node's own local `SourceInstance` ids via
    /// `SourceInstanceRegistry::source_instance_ids_for_group_libraries`, at
    /// extraction time -- resolved exactly once here rather than on every
    /// [`Self::allowed_libraries`] call, since that resolution needs the
    /// registry `AppState` holds and this type no longer has access to
    /// after construction. [`Self::allowed_libraries`] unions this into
    /// `policy.library_allow`, the same currency `ensure_library_allowed`
    /// already compares a `MediaFile::source_instance_id` against.
    resolved_group_library_allow: Vec<Uuid>,
}

impl std::ops::Deref for StreamingUser {
    type Target = AuthUser;

    fn deref(&self) -> &Self::Target {
        &self.user
    }
}

impl StreamingUser {
    /// `None` = unrestricted (an admin caller may stream from every
    /// library); `Some(ids)`, including an empty `Vec`, restricts playback
    /// to exactly the source-instance ids in that set -- mirrors
    /// `Policy::library_allow`'s own empty-means-deny-all semantics and
    /// `Policy::is_admin`'s bypass-everything-except-`can_stream` semantics
    /// (an admin account that also has `can_stream` -- unusual, since
    /// `is_admin` doesn't imply `can_stream` -- still sees every library
    /// once past that gate, same as every other `Policy` check `is_admin`
    /// bypasses). The returned set is `policy.library_allow` unioned with
    /// [`Self::resolved_group_library_allow`] (§5.1) -- a caller granted
    /// access via either mechanism is allowed.
    pub fn allowed_libraries(&self) -> Option<Vec<Uuid>> {
        (!self.policy.is_admin).then(|| {
            union_library_ids(
                &self.policy.library_allow,
                &self.resolved_group_library_allow,
            )
        })
    }
}

impl FromRequestParts<AppState> for StreamingUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let user = AuthUser::from_request_parts(parts, state).await?;
        let policy = resolve_policy(
            state,
            user.user_id,
            "streaming",
            forbidden("this account does not have Playarr streaming access"),
        )
        .await?;

        // Deliberately `policy.can_stream` alone -- `is_admin` does not
        // bypass this, unlike every other gate on `Policy`. See
        // `playarr_model::Policy::can_stream`'s doc comment.
        if policy.can_stream {
            let resolved_group_library_allow = state
                .source_instances
                .source_instance_ids_for_group_libraries(&policy.group_library_allow);
            Ok(StreamingUser {
                user,
                policy,
                resolved_group_library_allow,
            })
        } else {
            Err(forbidden(
                "this account does not have Playarr streaming access",
            ))
        }
    }
}

/// Optional [`StreamingUser`] authentication for endpoints that also accept
/// a narrowly-scoped playback capability. A missing bearer header produces
/// `None`; a present but invalid bearer header still fails closed.
#[derive(Debug, Clone)]
pub struct OptionalStreamingUser(pub Option<StreamingUser>);

impl FromRequestParts<AppState> for OptionalStreamingUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if !parts.headers.contains_key(header::AUTHORIZATION) {
            return Ok(Self(None));
        }

        StreamingUser::from_request_parts(parts, state)
            .await
            .map(|streaming| Self(Some(streaming)))
    }
}

/// [`AuthUser`] plus proof the caller may *view* the catalog -- either a
/// real Playarr streaming grant (`can_stream`) or an admin account. This is
/// deliberately more permissive than [`StreamingUser`]: an admin needs to
/// browse the catalog to verify their `*arr` sources actually synced
/// (Playarr Server Admin's own "Library" screen), without that implying they
/// can *play* anything -- [`crate::playback::playback_info_handler`] stays
/// gated by [`StreamingUser`] alone, not this type, so an admin-only
/// account can see title/metadata but never obtains a playback URL. Exposes
/// `AuthUser`'s fields via [`std::ops::Deref`], same as the other two
/// gated extractors. Also carries the caller's full resolved `Policy` (see
/// [`Self::allowed_libraries`]) -- gates catalog browse/search/get-by-id and
/// playlist-item visibility to exactly the library(ies) this account is
/// allowed to see.
#[derive(Debug, Clone)]
pub struct CatalogViewer {
    pub user: AuthUser,
    pub policy: Policy,
    /// See `StreamingUser::resolved_group_library_allow`'s doc comment --
    /// identical purpose and resolution point, for the catalog-viewing
    /// gate rather than the streaming one.
    resolved_group_library_allow: Vec<Uuid>,
}

impl std::ops::Deref for CatalogViewer {
    type Target = AuthUser;

    fn deref(&self) -> &Self::Target {
        &self.user
    }
}

impl CatalogViewer {
    /// `None` = unrestricted (an admin/system caller sees every library);
    /// `Some(ids)`, including an empty `Vec`, restricts the caller to
    /// exactly the source-instance ids in that set -- mirrors
    /// `Policy::library_allow`'s own empty-means-deny-all semantics and
    /// `Policy::is_admin`'s bypass-everything-except-`can_stream` semantics.
    /// See [`StreamingUser::allowed_libraries`], which this mirrors exactly,
    /// including unioning in `policy.group_library_allow` resolved to local
    /// `SourceInstance` ids (§5.1).
    pub fn allowed_libraries(&self) -> Option<Vec<Uuid>> {
        (!self.policy.is_admin).then(|| {
            union_library_ids(
                &self.policy.library_allow,
                &self.resolved_group_library_allow,
            )
        })
    }
}

impl FromRequestParts<AppState> for CatalogViewer {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let user = AuthUser::from_request_parts(parts, state).await?;
        let policy = resolve_policy(
            state,
            user.user_id,
            "catalog",
            forbidden("this account may not view the catalog"),
        )
        .await?;

        if policy.can_stream || policy.is_admin {
            let resolved_group_library_allow = state
                .source_instances
                .source_instance_ids_for_group_libraries(&policy.group_library_allow);
            Ok(CatalogViewer {
                user,
                policy,
                resolved_group_library_allow,
            })
        } else {
            Err(forbidden("this account may not view the catalog"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn parts_with_auth_header(value: Option<&str>) -> Parts {
        let mut request = axum::http::Request::builder().uri("/").body(()).unwrap();
        if let Some(value) = value {
            request
                .headers_mut()
                .insert(header::AUTHORIZATION, HeaderValue::from_str(value).unwrap());
        }
        let (parts, _) = request.into_parts();
        parts
    }

    #[test]
    fn bearer_token_rejects_missing_header() {
        let parts = parts_with_auth_header(None);
        assert!(bearer_token(&parts).is_err());
    }

    #[test]
    fn bearer_token_rejects_non_bearer_scheme() {
        let parts = parts_with_auth_header(Some("Basic dXNlcjpwYXNz"));
        assert!(bearer_token(&parts).is_err());
    }

    #[test]
    fn bearer_token_rejects_empty_token() {
        let parts = parts_with_auth_header(Some("Bearer "));
        assert!(bearer_token(&parts).is_err());
    }

    #[test]
    fn bearer_token_extracts_the_token() {
        let parts = parts_with_auth_header(Some("Bearer abc.def.ghi"));
        assert_eq!(bearer_token(&parts).unwrap(), "abc.def.ghi");
    }

    /// Minimal `Policy` fixture -- every field this module's tests don't
    /// care about is set to its least-privileged/empty value, mirroring
    /// `playarr-api::test_support`'s own seed helpers.
    fn test_policy(is_admin: bool, library_allow: Vec<Uuid>) -> Policy {
        Policy {
            id: Uuid::new_v4(),
            name: "test-policy".to_string(),
            library_allow,
            group_library_allow: Vec::new(),
            blocked_folders: Vec::new(),
            max_rating: None,
            blocked_tags: Vec::new(),
            allowed_tags: Vec::new(),
            can_transcode: true,
            can_download: true,
            can_delete: false,
            can_share_public: false,
            device_allow: Vec::new(),
            max_concurrent_sessions: None,
            access_schedule: None,
            can_stream: true,
            is_admin,
        }
    }

    fn test_auth_user() -> AuthUser {
        let user_id = Uuid::new_v4();
        AuthUser {
            user_id,
            claims: AccessTokenClaims {
                sub: user_id,
                device_id: Uuid::new_v4(),
                session_id: Uuid::new_v4(),
                iss: "test".to_string(),
                iat: 0,
                exp: 0,
                impersonated_by: None,
            },
        }
    }

    #[test]
    fn allowed_libraries_is_none_for_an_admin_regardless_of_library_allow() {
        let viewer = CatalogViewer {
            user: test_auth_user(),
            policy: test_policy(true, vec![Uuid::new_v4()]),
            resolved_group_library_allow: Vec::new(),
        };
        assert_eq!(viewer.allowed_libraries(), None);
    }

    #[test]
    fn allowed_libraries_returns_the_policys_library_allow_for_a_non_admin() {
        let library_id = Uuid::new_v4();
        let streaming = StreamingUser {
            user: test_auth_user(),
            policy: test_policy(false, vec![library_id]),
            resolved_group_library_allow: Vec::new(),
        };
        assert_eq!(streaming.allowed_libraries(), Some(vec![library_id]));
    }

    #[test]
    fn allowed_libraries_is_deny_all_not_all_allow_when_empty() {
        let streaming = StreamingUser {
            user: test_auth_user(),
            policy: test_policy(false, Vec::new()),
            resolved_group_library_allow: Vec::new(),
        };
        assert_eq!(streaming.allowed_libraries(), Some(Vec::new()));
    }

    /// Per §5.1: a `Policy::group_library_allow` grant, already resolved to
    /// local `SourceInstance` ids at extraction time, is unioned into
    /// `allowed_libraries()` alongside `library_allow` -- a caller with only
    /// a group-library grant (empty `library_allow`) still sees the
    /// resolved instance, and a duplicate between the two lists doesn't
    /// produce a repeated entry.
    #[test]
    fn allowed_libraries_unions_resolved_group_library_allow() {
        let library_id = Uuid::new_v4();
        let group_resolved_id = Uuid::new_v4();
        let streaming = StreamingUser {
            user: test_auth_user(),
            policy: test_policy(false, vec![library_id]),
            resolved_group_library_allow: vec![group_resolved_id, library_id],
        };
        let mut allowed = streaming.allowed_libraries().unwrap();
        allowed.sort();
        let mut expected = vec![library_id, group_resolved_id];
        expected.sort();
        assert_eq!(allowed, expected);
    }

    /// Same union behavior as `allowed_libraries_unions_resolved_group_library_allow`,
    /// through `CatalogViewer` instead of `StreamingUser`.
    #[test]
    fn catalog_viewer_allowed_libraries_unions_resolved_group_library_allow() {
        let group_resolved_id = Uuid::new_v4();
        let viewer = CatalogViewer {
            user: test_auth_user(),
            policy: test_policy(false, Vec::new()),
            resolved_group_library_allow: vec![group_resolved_id],
        };
        assert_eq!(viewer.allowed_libraries(), Some(vec![group_resolved_id]));
    }

    #[test]
    fn ensure_library_allowed_passes_unrestricted_callers() {
        assert!(ensure_library_allowed(Uuid::new_v4(), None).is_ok());
    }

    #[test]
    fn ensure_library_allowed_passes_a_matching_source_instance() {
        let instance = Uuid::new_v4();
        assert!(ensure_library_allowed(instance, Some(&[instance])).is_ok());
    }

    #[test]
    fn ensure_library_allowed_rejects_a_non_matching_source_instance() {
        let instance = Uuid::new_v4();
        let other = Uuid::new_v4();
        let err = ensure_library_allowed(instance, Some(&[other])).unwrap_err();
        assert_eq!(err.status, StatusCode::FORBIDDEN);
    }

    #[test]
    fn ensure_library_allowed_rejects_everything_for_an_empty_allow_list() {
        let err = ensure_library_allowed(Uuid::new_v4(), Some(&[])).unwrap_err();
        assert_eq!(err.status, StatusCode::FORBIDDEN);
    }

    #[test]
    fn ensure_can_download_passes_when_the_policy_grants_it() {
        let policy = test_policy(false, Vec::new());
        assert!(ensure_can_download(&policy).is_ok());
    }

    #[test]
    fn ensure_can_download_rejects_when_the_policy_denies_it() {
        let mut policy = test_policy(false, Vec::new());
        policy.can_download = false;
        let err = ensure_can_download(&policy).unwrap_err();
        assert_eq!(err.status, StatusCode::FORBIDDEN);
    }
}
