//! `streamarr-api` — the Axum HTTP server. Wires the OpenAPI-annotated
//! system routes ([`health`], [`readiness`], [`version`]) plus the real
//! catalog/oauth/webhooks/playback routes through
//! `utoipa-axum`'s [`utoipa_axum::router::OpenApiRouter`] (so the route
//! table and the OpenAPI spec can never drift apart — every
//! `#[utoipa::path]`-annotated handler mounted via `routes!` contributes
//! its documented shape to the spec automatically), and layers the
//! [`version_gate`] middleware over the whole router.
//!
//! ## Regenerating `backend/openapi/streamarr.yaml`
//!
//! The OpenAPI spec is generated from the `#[utoipa::path]` annotations on
//! each handler, not hand-maintained. [`openapi_spec`] returns the live
//! `utoipa::openapi::OpenApi` value; `tests::openapi_spec_matches_checked_in_file`
//! is both the regeneration script and the drift check: run
//!
//! ```text
//! UPDATE_OPENAPI_SPEC=1 cargo test -p streamarr-api openapi_spec_matches_checked_in_file
//! ```
//!
//! to (re)write `backend/openapi/streamarr.yaml` from the live spec after
//! changing any route; run the same test without the env var (as CI does)
//! to confirm the checked-in file still matches.

pub mod admin;
pub mod admin_peer;
pub mod admin_playback;
pub mod artwork;
pub mod auth_extractor;
pub mod catalog;
pub mod credits;
pub mod downloads;
pub mod error;
pub mod health;
pub mod login;
pub mod media;
pub mod notifications;
pub mod oauth;
pub mod openapi_docs;
pub mod peer;
pub mod peer_extractor;
pub mod playback;
pub mod playlists;
pub mod readiness;
pub mod refresh;
pub mod routing;
pub mod source_registry;
pub mod system_settings;
pub mod tdarr;
pub mod user_directory;
pub mod users;
pub mod version;
pub mod version_gate;
pub mod views;
pub mod webhooks;

#[cfg(test)]
mod peer_group_e2e_test;
#[cfg(test)]
mod routing_e2e_test;
#[cfg(test)]
pub mod test_support;

use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::FromRef;
use axum::Router;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityRequirement, SecurityScheme};
use utoipa::{Modify, OpenApi};
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

pub use auth_extractor::{AdminUser, AuthUser};
pub use error::{ApiError, ErrorBody};
pub use playback::{InMemoryMediaFileLookup, MediaFileLookup, RepoBackedMediaFileLookup};
pub use readiness::ReadinessState;
pub use source_registry::{SourceInstanceRegistry, SyncTriggerError};
pub use version::VersionState;
pub use version_gate::{ClientCompatibilityTable, VersionGateLayer};

/// Registers the `bearer_auth` HTTP bearer (JWT) security scheme every
/// [`auth_extractor::AuthUser`]/[`AdminUser`]-family extractor implies, and
/// marks every operation in the generated spec as requiring it *except*
/// the genuinely public, no-token endpoints: the login, signup, and
/// refresh handlers; the two unauthenticated legs of the RFC 8628
/// device-flow (`/api/v1/oauth/device/code` and `/api/v1/oauth/token` --
/// *not* `/api/v1/oauth/device/authorize`, which itself requires a
/// [`auth_extractor::StreamingUser`]); the `*arr` webhook receiver; and the
/// process health/readiness/version probes, none of which take an auth
/// extractor at all (a container orchestrator's liveness check can't
/// attach a JWT). Every other handler in this crate takes at least
/// [`auth_extractor::AuthUser`] (directly, or via `AdminUser`/
/// `StreamingUser`/`CatalogViewer`/`OptionalStreamingUser`, each of which
/// require a valid bearer token to construct even when the caller may end
/// up further rejected on authorization grounds), so this stays a blanket
/// exclusion list rather than an inclusion list that would silently miss
/// newly added routes.
struct SecurityAddon;

/// `path = "..."` strings (see each handler's `#[utoipa::path]`) for the
/// operations excluded from the blanket `bearer_auth` requirement --
/// see [`SecurityAddon`]'s doc comment for why each one is here.
const PUBLIC_OPENAPI_PATHS: &[&str] = &[
    "/api/system/health",
    "/api/system/ready",
    "/api/system/version",
    "/api/v1/auth/login",
    "/api/v1/auth/signup",
    "/api/v1/auth/refresh",
    "/api/v1/oauth/device/code",
    "/api/v1/oauth/token",
    "/webhooks/{instance_id}",
    // Bearer-authed by the one-shot join token carried in the request
    // body itself (`peer::EnrollRequest::join_token`), not a JWT -- see
    // `peer.rs`'s module doc comment.
    "/api/v1/peer/enroll",
];

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        openapi
            .components
            .get_or_insert_with(Default::default)
            .add_security_scheme(
                "bearer_auth",
                SecurityScheme::Http(
                    HttpBuilder::new()
                        .scheme(HttpAuthScheme::Bearer)
                        .bearer_format("JWT")
                        .build(),
                ),
            );

        for (path, item) in openapi.paths.paths.iter_mut() {
            if PUBLIC_OPENAPI_PATHS.contains(&path.as_str()) {
                continue;
            }
            for operation in [
                item.get.as_mut(),
                item.put.as_mut(),
                item.post.as_mut(),
                item.delete.as_mut(),
                item.options.as_mut(),
                item.head.as_mut(),
                item.patch.as_mut(),
                item.trace.as_mut(),
            ]
            .into_iter()
            .flatten()
            {
                operation.security = Some(vec![SecurityRequirement::new(
                    "bearer_auth",
                    Vec::<String>::new(),
                )]);
            }
        }
    }
}

#[derive(OpenApi)]
#[openapi(
    info(title = "Streamarr API", version = "0.1.0"),
    modifiers(&SecurityAddon),
    components(schemas(streamarr_model::PlaybackSession)),
    tags(
        (name = "system", description = "Process health, readiness, and version endpoints"),
        (name = "auth", description = "Session login and access-token issuance"),
        (name = "oauth", description = "RFC 8628 OAuth 2.0 device authorization endpoints"),
        (name = "webhooks", description = "*arr webhook receiver"),
        (name = "catalog", description = "Catalog browse/search/detail"),
        (name = "playback", description = "Playback negotiation: direct-play vs. transcode decision"),
        (name = "admin", description = "Admin-only configuration: registering *arr source instances"),
        (name = "users", description = "User account management and signed-in player preferences"),
        (name = "views", description = "Saved catalog filter presets ('Views') -- admin-managed, surfaced to Playarr as browsable shelves"),
        (name = "playlists", description = "User + System playlists -- named, ordered, optionally-nested lists of video works or audio tracks"),
        (name = "credits", description = "Cast/crew for a work, and every work a given person is credited on"),
        (name = "downloads", description = "Server-staged, quality-selectable, resumable downloads of media the caller already has playback access to"),
        (name = "peer-groups", description = "Multi-node peer group identity, founding, and join flow (see docs/architecture/peer-groups.md)")
    )
)]
pub struct ApiDoc;

/// The shared route table both [`openapi_spec`] and [`build_router`] build
/// from, so the two can never drift: `openapi_spec` calls
/// `split_for_parts` and keeps only the `OpenApi` half (for spec
/// regeneration/tests that don't want to boot a real, stateful router);
/// `build_router` keeps both halves after attaching real state and the
/// version-gate layer.
fn api_router() -> OpenApiRouter<AppState> {
    OpenApiRouter::with_openapi(ApiDoc::openapi())
        .routes(routes!(health::health_handler))
        .routes(routes!(readiness::readiness_handler))
        .routes(routes!(version::version_handler))
        .routes(routes!(openapi_docs::openapi_json_handler))
        .routes(routes!(
            system_settings::get_system_settings_handler,
            system_settings::update_system_settings_handler
        ))
        .routes(routes!(oauth::device_code_handler))
        .routes(routes!(oauth::authorize_device_handler))
        .routes(routes!(oauth::device_token_handler))
        .routes(routes!(login::login_handler))
        .routes(routes!(users::signup_handler))
        .routes(routes!(refresh::refresh_handler))
        .routes(routes!(webhooks::arr_webhook_handler))
        .routes(routes!(catalog::browse_catalog_handler))
        .routes(routes!(catalog::catalog_kinds_handler))
        .routes(routes!(catalog::get_work_handler))
        .routes(routes!(catalog::search_catalog_handler))
        .routes(routes!(catalog::similar_works_handler))
        .routes(routes!(artwork::work_artwork_handler))
        .routes(routes!(artwork::album_artwork_handler))
        .routes(routes!(playback::playback_info_handler))
        .routes(routes!(playback::by_external_ref_playback_info_handler))
        .routes(routes!(playback::peer_playback_info_handler))
        .routes(routes!(playback::record_playback_event_handler))
        .routes(routes!(playback::list_watch_progress_handler))
        .routes(routes!(
            playback::get_watch_progress_handler,
            playback::update_watch_progress_handler
        ))
        .routes(routes!(admin_playback::list_active_sessions_handler))
        .routes(routes!(admin_playback::list_session_history_handler))
        .routes(routes!(admin_playback::stop_session_handler))
        .routes(routes!(media::stream_media_handler))
        .routes(routes!(media::proxy_stream_media_handler))
        .routes(routes!(media::peer_stream_media_handler))
        .routes(routes!(media::media_metadata_handler))
        .routes(routes!(
            media::media_playback_options_handler,
            media::update_media_playback_options_handler
        ))
        .routes(routes!(media::media_chapters_handler))
        .routes(routes!(media::media_subtitle_handler))
        .routes(routes!(media::media_thumbnail_handler))
        .routes(routes!(media::serve_rendition_file_handler))
        .routes(routes!(media::serve_session_file_handler))
        .routes(routes!(media::media_download_options_handler))
        .routes(routes!(
            downloads::create_download_ticket_handler,
            downloads::list_download_tickets_handler
        ))
        .routes(routes!(
            downloads::get_download_ticket_handler,
            downloads::cancel_download_ticket_handler
        ))
        .routes(routes!(downloads::download_ticket_file_handler))
        .routes(routes!(
            admin::create_source_instance_handler,
            admin::list_source_instances_handler
        ))
        .routes(routes!(admin::delete_source_instance_handler))
        .routes(routes!(admin::sync_source_instance_handler))
        .routes(routes!(admin::sync_status_handler))
        .routes(routes!(
            tdarr::create_tdarr_connection_handler,
            tdarr::get_tdarr_connection_handler,
            tdarr::delete_tdarr_connection_handler
        ))
        .routes(routes!(
            users::create_user_handler,
            users::list_users_handler
        ))
        .routes(routes!(users::create_user_invite_handler))
        .routes(routes!(
            users::create_user_invite_request_handler,
            users::get_my_user_invite_request_handler
        ))
        .routes(routes!(users::generate_user_invite_handler))
        .routes(routes!(users::list_user_invite_requests_handler))
        .routes(routes!(users::review_user_invite_request_handler))
        .routes(routes!(notifications::push_config_handler))
        .routes(routes!(notifications::register_push_handler))
        .routes(routes!(
            users::update_user_handler,
            users::delete_user_handler
        ))
        .routes(routes!(admin::impersonate_user_handler))
        .routes(routes!(
            users::get_player_preferences_handler,
            users::update_player_preferences_handler
        ))
        .routes(routes!(users::get_self_capabilities_handler))
        .routes(routes!(
            users::get_profile_pin_setting_handler,
            users::update_profile_pin_setting_handler
        ))
        .routes(routes!(
            users::get_profile_avatar_handler,
            users::update_profile_avatar_handler
        ))
        .routes(routes!(users::list_available_profiles_handler))
        .routes(routes!(users::verify_profile_pin_handler))
        .routes(routes!(
            views::create_view_handler,
            views::list_admin_views_handler
        ))
        .routes(routes!(
            views::update_view_handler,
            views::delete_view_handler
        ))
        .routes(routes!(views::list_views_handler))
        .routes(routes!(views::resolve_view_handler))
        .routes(routes!(
            playlists::list_playlists_handler,
            playlists::create_playlist_handler
        ))
        .routes(routes!(playlists::list_admin_playlists_handler))
        .routes(routes!(
            playlists::get_playlist_handler,
            playlists::update_playlist_handler,
            playlists::delete_playlist_handler
        ))
        .routes(routes!(
            playlists::list_playlist_items_handler,
            playlists::add_playlist_item_handler
        ))
        .routes(routes!(playlists::remove_playlist_item_handler))
        .routes(routes!(playlists::reorder_playlist_items_handler))
        .routes(routes!(credits::work_credits_handler))
        .routes(routes!(credits::get_person_handler))
        .routes(routes!(credits::person_works_handler))
        .routes(routes!(admin_peer::update_self_peer_node_handler))
        .routes(routes!(admin_peer::found_peer_group_handler))
        .routes(routes!(admin_peer::create_peer_join_token_handler))
        .routes(routes!(admin_peer::join_peer_group_handler))
        .routes(routes!(admin_peer::leave_peer_group_handler))
        .routes(routes!(admin_peer::list_peer_nodes_handler))
        .routes(routes!(admin_peer::peer_node_sync_status_handler))
        .routes(routes!(admin_peer::address_bundle_handler))
        .routes(routes!(peer::enroll_handler))
        .routes(routes!(peer::nodes_handler))
        .routes(routes!(peer::leave_notification_handler))
        .routes(routes!(peer::accounts_handler))
        .routes(routes!(peer::invites_handler))
        .routes(routes!(peer::libraries_handler))
        .routes(routes!(peer::availability_handler))
        .routes(routes!(peer::routing_rules_handler))
}

pub fn openapi_spec() -> utoipa::openapi::OpenApi {
    let (_router, mut api) = api_router().split_for_parts();
    // `ApiDoc`'s `modifiers(&SecurityAddon)` already ran once inside
    // `ApiDoc::openapi()` -- but at that point `openapi.paths` is still
    // empty (this crate has no `paths(...)` in its `#[openapi(...)]`
    // attribute; every route is merged in afterwards, incrementally, by
    // each `.routes(routes!(...))` call above). Re-running the modifier
    // here, after `split_for_parts` has merged every handler's path into
    // `api`, is what actually gets `security` set on each operation; the
    // `components.security_schemes` write it also does is a harmless
    // no-op repeat (`Components::add_security_scheme` is a plain map
    // insert).
    SecurityAddon.modify(&mut api);
    api
}

/// Every service/repository handle the real routes in this crate depend
/// on. `streamarr-bin`'s `boot_api` is the composition root that
/// constructs one of these from `streamarr_config::Config`; every field
/// here is either `Arc<dyn Trait>` (when the owning crate defines a real
/// trait boundary — `DeviceFlowHandler`, `MediaFileLookup`,
/// `UserDirectory`, `SourceInstanceRepo`, real in production via
/// `RepoBackedMediaFileLookup`/`SqlxSourceInstanceRepo`,
/// real-but-in-memory in tests via `InMemoryMediaFileLookup`) or
/// `Arc<ConcreteType>` (when it only exposes a concrete service struct —
/// `CatalogService`, `TranscodeOrchestrator`,
/// `WebhookReceiver`, `JwtIssuer`, `RefreshTokenService` — or is a
/// composition-root-owned type with no sibling implementation to abstract
/// over yet — `SourceInstanceRegistry`, `InMemoryAdminRegistry`).
#[derive(Clone)]
pub struct AppState {
    pub readiness: ReadinessState,
    pub version: VersionState,
    pub catalog: Arc<streamarr_catalog::CatalogService>,
    pub transcode: Arc<streamarr_transcode::TranscodeOrchestrator>,
    pub device_flow: Arc<dyn streamarr_auth::DeviceFlowHandler>,
    pub webhook: Arc<streamarr_arr_sync::WebhookReceiver>,
    pub source_instances: Arc<SourceInstanceRegistry>,
    /// The real, durable persistence layer behind `source_instances`'
    /// in-memory cache. `source_instances` stays the fast in-memory read
    /// path for every request-hot lookup, and still exclusively owns the
    /// per-poller trigger-sender bookkeeping (`SyncTriggerError`/
    /// `trigger_sync`/`register_trigger`) -- that's inherently
    /// runtime-only state (a live `mpsc::Sender` into a currently-running
    /// `ReconciliationPoller`) that can never be persisted. Every write
    /// (`admin.rs`'s create/delete handlers) goes through this repo
    /// *first* and `source_instances` second, so a failed write never
    /// leaves the in-memory registry claiming something that isn't
    /// actually durable; `streamarr-bin`'s `boot_api` also uses this to
    /// hydrate `source_instances` from the database on every boot, which
    /// is the actual fix for registered `*arr` connections not surviving
    /// a restart.
    pub source_instance_repo: Arc<dyn streamarr_db::SourceInstanceRepo>,
    /// The real, durable persistence layer for `streamarr_model::LibraryView`
    /// ("Views" -- saved catalog filter+sort presets, see that type's doc
    /// comment) -- backs `views.rs`'s admin CRUD and public list/resolve
    /// endpoints. Unlike `source_instances`, there is no separate in-memory
    /// cache in front of this: views are read far less often (an admin
    /// screen, and Playarr's Home shelf list on load) than the catalog
    /// itself, so a direct repo read per request is fine.
    pub library_view_repo: Arc<dyn streamarr_db::LibraryViewRepo>,
    /// The real, durable persistence layer for `streamarr_model::Playlist`/
    /// `PlaylistItem` -- backs `playlists.rs`'s user + System playlist CRUD
    /// and item-membership endpoints.
    pub playlist_repo: Arc<dyn streamarr_db::repo::PlaylistRepo>,
    /// The real, durable persistence layer for `streamarr_model::Work` --
    /// `credits.rs`'s `person_works_handler` uses this for a cheap
    /// `Work`-only fetch per credited work id, rather than going through
    /// `catalog` (which additionally hydrates each work's full
    /// season/episode/album/track/book child tree, unneeded here).
    pub work_repo: Arc<dyn streamarr_db::WorkRepo>,
    /// The real, durable persistence layer for `streamarr_model::Person`/
    /// `Credit` -- backs `credits.rs`'s cast/crew and "find all content
    /// for this person" endpoints. See `streamarr_model::person`'s module
    /// doc comment for why this is populated only for Radarr-sourced
    /// movies today.
    pub credit_repo: Arc<dyn streamarr_db::CreditRepo>,
    /// The real, durable persistence layer for
    /// `streamarr_model::TdarrConnection` -- backs `tdarr.rs`'s admin
    /// registration endpoints. See that type's doc comment for why this
    /// is a singleton, unlike `source_instance_repo`.
    pub tdarr_connection_repo: Arc<dyn streamarr_db::TdarrConnectionRepo>,
    /// Singleton, administrator-editable settings for this Streamarr
    /// installation. The public version endpoint reads this repository too,
    /// so clients see a changed instance name immediately.
    pub system_settings_repo: Arc<dyn streamarr_db::SystemSettingsRepo>,
    pub media_files: Arc<dyn MediaFileLookup>,
    /// Per-user durable resume positions and watched state.
    pub watch_progress: Arc<dyn streamarr_db::WatchProgressRepo>,
    /// Per-user server-staged download tickets -- backs `downloads.rs`'s
    /// create/list/get/cancel/file-serve endpoints and
    /// `media.rs`'s `media_download_options_handler`. See
    /// `streamarr_model::DownloadTicket`'s doc comment for how this differs
    /// from `rendition_repo` (that one backs shared, playback-oriented HLS
    /// renditions; this one backs per-user, single-file download grants).
    pub download_tickets: Arc<dyn streamarr_db::DownloadTicketRepo>,
    /// Verifies the `Authorization: Bearer <token>` header every
    /// [`auth_extractor::AuthUser`]/[`auth_extractor::AdminUser`]
    /// extraction depends on -- the same issuer instance
    /// `POST /api/v1/auth/login` and the RFC 8628 device flow issue tokens
    /// through, so a token from either path verifies here identically.
    pub jwt: Arc<streamarr_auth::JwtIssuer>,
    /// Superseded id-list admin check -- [`auth_extractor::AdminUser`] no
    /// longer reads this at all (it does a real `Policy::is_admin` check via
    /// `user_repo`/`policy_repo` below instead; see that extractor's doc
    /// comment for the permanent replacement this field used to stand in
    /// for). Left in `AppState` for now since nothing downstream of
    /// `streamarr-bin`'s `boot_api` construction depends on it being gone --
    /// a later cleanup pass can drop the field and its construction once
    /// nothing else references it either.
    pub admin_registry: Arc<streamarr_auth::InMemoryAdminRegistry>,
    /// The operator's configured login trust tier for `POST
    /// /api/v1/auth/login` -- see `streamarr_auth::AuthMode`'s doc comment
    /// for what each tier requires, and `streamarr-bin`'s `boot_api` for
    /// how this pass resolves it (and the security implications of its
    /// default) from `STREAMARR_AUTH_MODE`.
    pub auth_mode: Arc<streamarr_auth::AuthMode>,
    /// Resolves the `User`s participating in login. Real in production --
    /// `streamarr-bin`'s `boot_api` wires in
    /// [`user_directory::RepoBackedUserDirectory`], backed by `user_repo`
    /// below, now that real `User` persistence exists (replacing
    /// `streamarr_auth::login::InMemoryUserDirectory`'s old in-memory
    /// stand-in).
    pub user_directory: Arc<dyn streamarr_auth::UserDirectory>,
    /// The real, durable persistence layer for `streamarr_model::User`
    /// accounts -- backs [`user_directory::RepoBackedUserDirectory`] above,
    /// the real `Policy`-backed check in [`auth_extractor::AdminUser`], and
    /// `users.rs`'s admin user-management endpoints.
    pub user_repo: Arc<dyn streamarr_db::UserRepo>,
    /// Expiring, one-use account invitations issued by administrators and
    /// redeemed by the unauthenticated Playarr sign-up endpoint.
    pub user_invite_repo: Arc<dyn streamarr_db::UserInviteRepo>,
    /// Approval workflow for ordinary Playarr users asking permission to
    /// generate one friend-invite QR code.
    pub user_invite_request_repo: Arc<dyn streamarr_db::UserInviteRequestRepo>,
    /// FCM device/browser registrations for approval notifications.
    pub push_registration_repo: Arc<dyn streamarr_db::PushRegistrationRepo>,
    pub push_notifier: Arc<dyn notifications::PushNotifier>,
    pub firebase_web_config: Option<notifications::FirebaseWebConfig>,
    /// Optional profile-lock PIN hashes. Kept behind a distinct repository
    /// so they cannot be confused with or overwrite account passwords.
    pub profile_pin_repo: Arc<dyn streamarr_db::ProfilePinRepo>,
    /// The real, durable persistence layer for `streamarr_model::Policy`
    /// (permission/role) records -- looked up by a user's `policy_id` to
    /// decide `Policy::is_admin` (see [`auth_extractor::AdminUser`]) and by
    /// `users.rs`'s admin user-management endpoints.
    pub policy_repo: Arc<dyn streamarr_db::PolicyRepo>,
    /// Issues/rotates refresh-token families for `POST /api/v1/auth/login`
    /// -- shared with the RFC 8628 device flow's own token issuance
    /// (`device_flow` above wraps a clone of the same underlying service),
    /// so both paths agree on `Device`/`Session` bookkeeping.
    pub sessions: Arc<streamarr_auth::RefreshTokenService>,
    /// Absolute lifetime of a refresh-token family minted by
    /// `POST /api/v1/auth/login` -- see
    /// `streamarr_auth::refresh::RefreshTokenRecord::expires_at`'s doc
    /// comment for why this is fixed at issuance rather than sliding.
    pub refresh_ttl: chrono::Duration,
    /// Stable-for-process-lifetime identifier for this node, threaded into
    /// `TranscodeSession::owning_node_id` so a segment request in a
    /// multi-node deployment can be routed back to whichever node actually
    /// holds the ffmpeg process.
    pub node_id: String,
    /// Durable playback-analytics store (session/event writes, `stats_daily`
    /// reads) -- backs both the write path in `playback.rs` and the admin
    /// session-history endpoint (`admin_playback.rs`). The same `Arc`
    /// `analytics` below also holds.
    pub analytics_store: Arc<dyn streamarr_db::analytics::AnalyticsStore>,
    /// In-process "what's happening right now" cache -- backs
    /// `record_playback_event_handler`'s ownership check, the admin live-
    /// sessions endpoint, and (later) `Policy::max_concurrent_sessions`
    /// enforcement. The same `Arc` `analytics` below also holds.
    pub session_registry: Arc<dyn streamarr_telemetry::analytics::SessionRegistry>,
    /// Single fan-out point for session/event writes -- see
    /// `streamarr_telemetry::analytics::collector`'s doc comment for the
    /// synchronous-registry / batched-durable-write split this owns.
    pub analytics: Arc<streamarr_telemetry::analytics::AnalyticsCollector>,
    /// This installation's own durable Ed25519 identity -- singleton,
    /// minted (if it doesn't already exist) at process boot by
    /// `backend/src/main.rs::boot_api` via `admin_peer::ensure_node_identity`,
    /// so a row always exists by the time this repo is ever read. Byte-for-
    /// byte inert for a single, ungrouped node: nothing reads this outside
    /// `admin_peer.rs`/`peer_extractor.rs`. See
    /// `docs/architecture/peer-groups.md` §2.1/§3.3.
    pub node_identity_repo: Arc<dyn streamarr_db::NodeIdentityRepo>,
    /// The peer group this node has founded or joined, if any -- in
    /// practice at most one row (`node_identity.group_id`), but keyed on
    /// `PeerGroup::id` rather than assumed-singleton (see that repo
    /// trait's own doc comment).
    pub peer_group_repo: Arc<dyn streamarr_db::PeerGroupRepo>,
    /// Every known member of this node's peer group, including a row for
    /// this node itself (`is_self = true`) -- backs `admin_peer.rs`'s
    /// list/self-profile endpoints and `peer_extractor.rs`'s signature
    /// verification (looks up the claimed signer's `public_key` here).
    pub peer_node_repo: Arc<dyn streamarr_db::PeerNodeRepo>,
    /// Single-use, short-TTL, admin-issued group join tokens -- backs
    /// `admin_peer.rs`'s `POST .../join-tokens` and `peer.rs`'s
    /// `POST /api/v1/peer/enroll`.
    pub peer_join_token_repo: Arc<dyn streamarr_db::PeerJoinTokenRepo>,
    /// In-memory staging area for `PUT /api/v1/admin/peer-nodes/self`,
    /// consulted by `admin_peer::found_peer_group_handler`/
    /// `join_peer_group_handler` while this node has no persisted self
    /// `PeerNode` row yet to write through to -- see
    /// `admin_peer::PendingSelfPeerProfile`'s doc comment for why this is
    /// deliberately not a new migration column. `boot_api` optionally seeds
    /// this from `STREAMARR_NODE_NAME` at boot (ungrouped nodes only) as a
    /// pure UX convenience -- see that function's own comment; it never
    /// substitutes for actually calling this route.
    pub pending_self_peer_profile:
        Arc<std::sync::Mutex<Option<admin_peer::PendingSelfPeerProfile>>>,
    /// Group-wide library registry (`docs/architecture/peer-groups.md`
    /// §2.3) -- backs `peer::libraries_handler`'s `group_libraries` half.
    pub group_library_repo: Arc<dyn streamarr_db::GroupLibraryRepo>,
    /// The real, durable persistence layer for `streamarr_model::MediaFile`
    /// -- backs `peer::availability_handler`'s live derivation of this
    /// node's own leaf availability (`list_work_ids`/`get_by_id`), joined
    /// to `source_instance_repo` for `group_library_id`. Distinct from
    /// `media_files` above (`Arc<dyn MediaFileLookup>`, a single-id lookup
    /// only): this field is the full repository surface, the same one
    /// `AppState::catalog` is itself built against.
    pub media_file_repo: Arc<dyn streamarr_db::MediaFileRepo>,
    /// Operator-configured routing policy (`docs/architecture/
    /// peer-groups.md` §2.4) -- backs `peer::routing_rules_handler`.
    pub routing_rule_repo: Arc<dyn streamarr_db::RoutingRuleRepo>,
    /// Read-only, per-peer leaf availability cache (`docs/architecture/
    /// peer-groups.md` §2.3/§4) -- `availability_sync.rs`
    /// (`streamarr-peer-sync`) is its only writer; this crate only ever
    /// reads it, both for `CatalogService`'s browse/get_by_id hydration
    /// (wired separately, straight into `catalog` at construction) and for
    /// Phase 3's routing-context gathering (`playback::
    /// resolve_route_for_local_media_file`), which needs the raw rows
    /// `CatalogService` doesn't expose back out.
    pub peer_leaf_availability_repo: Arc<dyn streamarr_db::PeerLeafAvailabilityRepo>,
    /// Shared `reqwest::Client` (its own internal connection pool) for
    /// every Phase 3 outbound node-to-node call this crate's request
    /// handlers make directly -- `playback::forward_negotiation_to_peer`'s
    /// signed negotiation forward and `media::proxy_stream_media_handler`'s
    /// signed `Range`-preserving byte stream (`docs/architecture/
    /// peer-groups.md` §5.2/§5.3). Constructed once in `backend/src/
    /// main.rs`'s `boot_api` and reused across every request, the same
    /// "construct once, clone (cheaply, it's `Arc`-backed internally)
    /// everywhere" treatment `boot_worker`'s own `peer_http_client` already
    /// gets for its background `PeerSyncPoller`s -- this is a *separate*
    /// instance from that one (a different role/process in a split Tier-2/3
    /// deployment), not a duplicate of the same resource.
    pub peer_http: reqwest::Client,
}

impl FromRef<AppState> for ReadinessState {
    fn from_ref(state: &AppState) -> Self {
        state.readiness.clone()
    }
}

/// Builds the full Axum router: every system route, the version-gate
/// middleware layered over the whole thing, and the OpenAPI spec those
/// routes contributed to. `streamarr-bin` mounts the returned `Router`
/// directly; the `OpenApi` value is what [`openapi_spec`] also exposes
/// standalone for spec regeneration/tests that don't want to boot a real
/// router.
///
/// Also mounts bare `/healthz` and `/readyz` aliases for
/// [`health::health_handler`]/[`readiness::readiness_handler`], outside the
/// OpenAPI-tracked route table (they're container/orchestrator liveness
/// probe conventions, not public API surface) — `infra/docker/backend.Dockerfile`'s
/// `HEALTHCHECK` curls `/healthz` regardless of role, so the full API
/// router needs to answer it too, not just the worker-only minimal
/// listener `streamarr-bin` serves when it isn't running this router at
/// all. `/api/system/health` and `/api/system/ready` are unaffected by
/// this — both keep working exactly as before.
///
/// CORS is wide open (`CorsLayer::permissive` -- any origin/method/header,
/// no credentials) by design, not an oversight: this API is Bearer-token
/// authenticated, never cookie/session-authenticated, so there is no CSRF
/// surface a stricter origin allow-list would actually protect (the token
/// itself is the access control; a browser page on an unrelated origin
/// still can't produce a valid one). It also still matters even now that
/// the standalone Web app is co-hosted (see `web_assets_dir` below): the
/// packaged TV-web shells (webOS/Tizen/VIDAA) run from their own app/webview
/// origin and always call the API cross-origin, and a split reverse-proxy
/// deployment (UI on one host, API on another) is still a legitimate setup
/// this must keep working for. Layered outermost (after `version_gate` in
/// this builder chain, which axum applies innermost-first) so a preflight
/// `OPTIONS` request is answered before it ever reaches auth/version-gate
/// logic that would otherwise reject it for having no `Authorization`
/// header.
///
/// `web_assets_dir`, when `Some`, mounts Streamarr Admin's built static
/// assets (`clients/tv-web/admin/dist`) as this router's fallback —
/// any request that doesn't match an `/api/*` route, `/healthz`, or
/// `/readyz` is served a static file from that directory, falling back to
/// `index.html` for anything not found on disk (React Router's
/// client-side routes, e.g. `/library/{id}`, aren't real files). This is
/// what lets the API and the Web UI live on one origin, one port, one
/// `docker run` — the same story every `*arr` app ships, rather than
/// requiring a separately-hosted web client pointed at this API via CORS.
/// `streamarr-bin` resolves the directory (env override or a path next to
/// the binary) and passes `None` when it can't find a built `index.html`
/// there, in which case this router serves API-only, exactly as before.
pub fn build_router(
    state: AppState,
    version_gate: VersionGateLayer,
    web_assets_dir: Option<PathBuf>,
) -> (Router, utoipa::openapi::OpenApi) {
    let readiness_for_alias = state.readiness.clone();
    let (router, mut api) = api_router().with_state(state).split_for_parts();
    // See `openapi_spec`'s doc comment: paths only exist after
    // `split_for_parts`, so `SecurityAddon` has to run again here to
    // actually tag operations, not just rely on the `modifiers(...)` pass
    // baked into `ApiDoc::openapi()`.
    SecurityAddon.modify(&mut api);
    let router = router
        .route("/healthz", axum::routing::get(health::health_handler))
        .route(
            "/readyz",
            axum::routing::get(move || {
                let readiness = readiness_for_alias.clone();
                async move { readiness::readiness_handler(axum::extract::State(readiness)).await }
            }),
        );

    let router = router.layer(version_gate).layer(CorsLayer::permissive());

    let router = match web_assets_dir {
        Some(dir) => {
            // Deliberately `.fallback(...)`, not `.not_found_service(...)`:
            // the latter is tower-http's helper for a real "not found" page
            // and always forces a 404 status onto whatever it serves
            // (`SetStatus::new(fallback, StatusCode::NOT_FOUND)` -- see its
            // own doc comment). React Router's client-side routes (e.g.
            // `/library/{id}`) are not 404s -- they're real pages the SPA
            // shell renders once loaded -- so this needs `index.html`
            // served with its own natural 200, which plain `.fallback(...)`
            // preserves.
            let index_html = ServeFile::new(dir.join("index.html"));
            router.fallback_service(ServeDir::new(dir).fallback(index_html))
        }
        None => router,
    };

    (router, api)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use streamarr_model::VersionEnvelope;
    use tower::ServiceExt;

    #[tokio::test]
    async fn health_endpoint_returns_200() {
        let (router, _state) = test_support::test_state().await;
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/system/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn healthz_alias_returns_200() {
        let (router, _state) = test_support::test_state().await;
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn readyz_alias_reflects_state() {
        let (router, state) = test_support::test_state().await;
        let not_ready = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/readyz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(not_ready.status(), StatusCode::SERVICE_UNAVAILABLE);

        state.app.readiness.set_ready(true);
        let ready = router
            .oneshot(
                Request::builder()
                    .uri("/readyz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ready.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn readiness_endpoint_reflects_state() {
        let (router, state) = test_support::test_state().await;
        state.app.readiness.set_ready(true);
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/system/ready")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn version_endpoint_returns_envelope_json() {
        let (router, _state) = test_support::test_state().await;
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/system/version")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let envelope: VersionEnvelope = serde_json::from_slice(&body).unwrap();
        assert_eq!(envelope.instance_name, "Streamarr");
        assert_eq!(envelope.server_version, "0.1.0");
    }

    #[test]
    fn openapi_spec_includes_every_route_group() {
        let spec = openapi_spec();
        let json = serde_json::to_string(&spec).unwrap();
        assert!(json.contains("/api/system/health"));
        assert!(json.contains("/api/system/version"));
        assert!(json.contains("/api/v1/oauth/device/code"));
        assert!(json.contains("/api/v1/oauth/device/authorize"));
        assert!(json.contains("/api/v1/oauth/token"));
        assert!(json.contains("/api/v1/auth/login"));
        assert!(json.contains("/webhooks/{instance_id}"));
        assert!(json.contains("/api/v1/catalog"));
        assert!(json.contains("/api/v1/catalog/{id}"));
        assert!(json.contains("/api/v1/catalog/search"));
        assert!(json.contains("/api/v1/artwork/work/{work_id}/{kind}"));
        assert!(json.contains("/api/v1/artwork/album/{artist_work_id}/{album_id}/{kind}"));
        assert!(json.contains("/api/v1/playback/{media_file_id}"));
        assert!(json.contains("/api/v1/admin/source-instances"));
        assert!(json.contains("/api/v1/admin/system-settings"));
        assert!(json.contains("/api/v1/admin/views"));
        assert!(json.contains("/api/v1/views"));
        assert!(json.contains("/api/v1/views/{id}/resolve"));
        assert!(json.contains("/api/v1/users/me/profile-avatar"));
    }

    /// Regenerates (with `UPDATE_OPENAPI_SPEC=1`) or verifies (without it)
    /// `backend/openapi/streamarr.yaml` against the live utoipa spec. This
    /// is the "small #[test]" the crate doc comment describes as the
    /// regeneration mechanism.
    #[test]
    fn openapi_spec_matches_checked_in_file() {
        let yaml = openapi_spec().to_yaml().expect("serialize OpenAPI to YAML");
        let path =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../openapi/streamarr.yaml");

        if std::env::var("UPDATE_OPENAPI_SPEC").is_ok() {
            std::fs::write(&path, &yaml).expect("write backend/openapi/streamarr.yaml");
            return;
        }

        let checked_in = std::fs::read_to_string(&path).unwrap_or_default();
        assert_eq!(
            checked_in, yaml,
            "backend/openapi/streamarr.yaml is out of date with the live utoipa spec; \
             regenerate with `UPDATE_OPENAPI_SPEC=1 cargo test -p streamarr-api openapi_spec_matches_checked_in_file`"
        );
    }
}
