//! `playarr-api` — the Axum HTTP server. Wires the OpenAPI-annotated
//! system routes ([`health`], [`readiness`], [`version`]) plus the real
//! catalog/oauth/webhooks/playback routes through
//! `utoipa-axum`'s [`utoipa_axum::router::OpenApiRouter`] (so the route
//! table and the OpenAPI spec can never drift apart — every
//! `#[utoipa::path]`-annotated handler mounted via `routes!` contributes
//! its documented shape to the spec automatically), and layers the
//! [`version_gate`] middleware over the whole router.
//!
//! ## Regenerating `backend/openapi/playarr.yaml`
//!
//! The OpenAPI spec is generated from the `#[utoipa::path]` annotations on
//! each handler, not hand-maintained. [`openapi_spec`] returns the live
//! `utoipa::openapi::OpenApi` value; `tests::openapi_spec_matches_checked_in_file`
//! is both the regeneration script and the drift check: run
//!
//! ```text
//! UPDATE_OPENAPI_SPEC=1 cargo test -p playarr-api openapi_spec_matches_checked_in_file
//! ```
//!
//! to (re)write `backend/openapi/playarr.yaml` from the live spec after
//! changing any route; run the same test without the env var (as CI does)
//! to confirm the checked-in file still matches.
// `async_trait` expansions trip clippy::double_must_use on current stable.
#![allow(clippy::double_must_use)]

pub mod admin;
pub mod admin_backups;
pub mod admin_peer;
pub mod admin_playback;
pub mod admin_routing;
pub mod artwork;
pub mod auth_extractor;
pub mod calendar;
pub mod calendar_cache;
pub mod catalog;
pub mod credits;
pub mod discovery;
pub mod downloads;
pub mod dubarr_audio;
pub mod error;
pub mod events;
pub mod folder_scan;
pub mod folders;
pub mod health;
pub mod home_rails;
pub mod household;
pub mod http_cache;
pub mod ics;
pub mod language_index;
pub mod login;
pub mod media;
pub mod notifications;
pub mod oauth;
pub mod openapi_docs;
pub mod own_availability;
pub mod peer;
pub mod peer_extractor;
mod physical_path;
pub mod playback;
pub mod playback_health;
pub mod playlists;
pub mod portability;
pub mod readiness;
pub mod refresh;
pub mod remote;
pub mod request_sync;
pub mod request_timing_middleware;
pub mod requests;
pub mod resume;
pub mod routing;
mod sidecar_subtitles;
mod source_cache;
pub mod source_registry;
pub mod system_capabilities;
pub mod system_settings;
pub mod tdarr;
pub mod user_directory;
pub mod users;
pub mod version;
pub mod version_gate;
pub mod views;
pub mod webhooks;

#[cfg(test)]
mod admin_routing_tests;
#[cfg(test)]
mod folders_tests;
#[cfg(test)]
mod household_tests;
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
use tower_http::cors::{AllowHeaders, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use utoipa::openapi::security::{
    ApiKey, ApiKeyValue, HttpAuthScheme, HttpBuilder, SecurityRequirement, SecurityScheme,
};
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

/// Registers the JWT bearer scheme used by user/admin routes and the four
/// headers required together by [`peer_extractor::PeerSignedRequest`].
///
/// Every non-public operation receives bearer auth except `/api/v1/peer/*`,
/// which receives one four-scheme OpenAPI requirement (AND semantics). The
/// sole peer exception is `/api/v1/peer/enroll`: it authenticates with the
/// one-shot token carried in its request body because the joining node does
/// not have a known signing identity yet.
struct SecurityAddon;

const PEER_ID_SECURITY_SCHEME: &str = "peer_id_header";
const PEER_TIMESTAMP_SECURITY_SCHEME: &str = "peer_timestamp_header";
const PEER_NONCE_SECURITY_SCHEME: &str = "peer_nonce_header";
const PEER_SIGNATURE_SECURITY_SCHEME: &str = "peer_signature_header";

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
    // The refresh token plus the profile PIN are the credential here.
    "/api/v1/auth/unlock",
    // Authenticated by the revocable token embedded in the path, because
    // calendar apps cannot send an Authorization header.
    "/api/v1/calendar/feed/{file}",
    "/api/v1/oauth/device/code",
    // Authenticated by the one-time, user-bound, 15-minute token in the
    // path, because the phone or computer that opens a QR code shown on a
    // television is not signed in. See `portability/transfer.rs`.
    "/api/v1/transfer/export/{token}",
    "/api/v1/transfer/import/{token}",
    "/api/v1/oauth/token",
    "/webhooks/{instance_id}",
    // Authenticated by the per-integration webhook secret (Ombi/Seerr).
    "/api/v1/requests/webhook/{integration_id}",
    // Bearer-authed by the one-shot join token carried in the request
    // body itself (`peer::EnrollRequest::join_token`), not a JWT -- see
    // `peer.rs`'s module doc comment.
    "/api/v1/peer/enroll",
];

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer_auth",
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .bearer_format("JWT")
                    .build(),
            ),
        );
        for (scheme_name, header_name, description) in [
            (
                PEER_ID_SECURITY_SCHEME,
                "X-Playarr-Peer-Id",
                "UUID of the peer signing this request",
            ),
            (
                PEER_TIMESTAMP_SECURITY_SCHEME,
                "X-Playarr-Timestamp",
                "Unix timestamp covered by the peer signature",
            ),
            (
                PEER_NONCE_SECURITY_SCHEME,
                "X-Playarr-Nonce",
                "Unique nonce covered by the peer signature",
            ),
            (
                PEER_SIGNATURE_SECURITY_SCHEME,
                "X-Playarr-Signature",
                "Base64 Ed25519 signature over the canonical request",
            ),
        ] {
            components.add_security_scheme(
                scheme_name,
                SecurityScheme::ApiKey(ApiKey::Header(ApiKeyValue::with_description(
                    header_name,
                    description,
                ))),
            );
        }

        for (path, item) in openapi.paths.paths.iter_mut() {
            if PUBLIC_OPENAPI_PATHS.contains(&path.as_str()) {
                continue;
            }
            let security = if path.starts_with("/api/v1/peer/") {
                SecurityRequirement::new(PEER_ID_SECURITY_SCHEME, Vec::<String>::new())
                    .add(PEER_TIMESTAMP_SECURITY_SCHEME, Vec::<String>::new())
                    .add(PEER_NONCE_SECURITY_SCHEME, Vec::<String>::new())
                    .add(PEER_SIGNATURE_SECURITY_SCHEME, Vec::<String>::new())
            } else {
                SecurityRequirement::new("bearer_auth", Vec::<String>::new())
            };
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
                operation.security = Some(vec![security.clone()]);
            }
        }
    }
}

#[derive(OpenApi)]
#[openapi(
    info(title = "Playarr Server API", version = "0.1.0"),
    modifiers(&SecurityAddon),
    components(schemas(
        playarr_model::PlaybackSession,
        playarr_model::discovery::DiscoveryScope,
        playarr_model::discovery::DiscoveryKind,
        portability::ProgressConflicts,
        folders::FolderSort,
        folders::FolderOrder,
        folders::FolderEntryFilter
    )),
    tags(
        (name = "system", description = "Process health, readiness, and version endpoints"),
        (name = "auth", description = "Session login and access-token issuance"),
        (name = "oauth", description = "RFC 8628 OAuth 2.0 device authorization endpoints"),
        (name = "webhooks", description = "*arr webhook receiver"),
        (name = "catalog", description = "Catalog browse/search/detail"),
        (name = "calendar", description = "Aggregated release calendar across the connected *arr instances, and the external iCal subscription"),
        (name = "playback", description = "Playback negotiation: direct-play vs. transcode decision"),
        (name = "admin", description = "Admin-only configuration: registering *arr source instances"),
        (name = "users", description = "User account management and signed-in player preferences"),
        (name = "home", description = "Server-computed Home rails (recently added/released, top unwatched, rediscover, seasonal, custom) with admin management and per-user preferences"),
        (name = "views", description = "Saved catalog filter presets ('Views') -- admin-managed, surfaced to Playarr as browsable shelves"),
        (name = "requests", description = "Unified media requests and the Ombi/Seerr integrations"),
        (name = "discovery", description = "Unified discovery search across library, peers and request catalogues, plus the per-profile watchlist and source-aware title actions"),
        (name = "playlists", description = "User + System playlists -- named, ordered, optionally-nested lists of video works or audio tracks"),
        (name = "portability", description = "Self-service export and import of the signed-in user's own library data (watch progress, playlists, preferences)"),
        (name = "credits", description = "Cast/crew for a work, and every work a given person is credited on"),
        (name = "downloads", description = "Server-staged, quality-selectable, resumable downloads of media the caller already has playback access to"),
        (name = "events", description = "Per-user live change stream (server-sent events; see docs/architecture/live-events.md)"),
        (name = "remote", description = "Phone remote pairing, remote commands and transactional playback handoff (see docs/architecture/remote-control.md)"),
        (name = "household", description = "Household and child controls: profile status, schedules, guardian approvals"),
        (name = "folders", description = "Native folder browsing of administrator-enabled root folders (unsorted media)"),
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
        .routes(routes!(
            system_capabilities::get_system_capabilities_handler
        ))
        .routes(routes!(
            admin_backups::get_backups_handler,
            admin_backups::start_backup_handler
        ))
        .routes(routes!(admin_backups::download_backup_handler))
        .routes(routes!(admin_backups::verify_backup_handler))
        .routes(routes!(admin_backups::delete_backup_handler))
        .routes(routes!(
            admin_routing::list_group_libraries_handler,
            admin_routing::create_group_library_handler
        ))
        .routes(routes!(admin_routing::rename_group_library_handler))
        .routes(routes!(admin_routing::map_source_instance_handler))
        .routes(routes!(
            admin_routing::list_routing_rules_handler,
            admin_routing::create_routing_rule_handler
        ))
        .routes(routes!(admin_routing::update_routing_rule_handler))
        .routes(routes!(oauth::device_code_handler))
        .routes(routes!(oauth::authorize_device_handler))
        .routes(routes!(oauth::device_token_handler))
        .routes(routes!(login::login_handler))
        .routes(routes!(users::signup_handler))
        .routes(routes!(refresh::refresh_handler))
        .routes(routes!(refresh::unlock_handler))
        .routes(routes!(refresh::lock_handler))
        .routes(routes!(webhooks::arr_webhook_handler))
        .routes(routes!(calendar::calendar_handler))
        .routes(routes!(
            calendar::get_calendar_feed_handler,
            calendar::create_calendar_feed_handler,
            calendar::revoke_calendar_feed_handler
        ))
        .routes(routes!(calendar::calendar_feed_ics_handler))
        .routes(routes!(calendar::availability_lag_handler))
        .routes(routes!(catalog::browse_catalog_handler))
        .routes(routes!(catalog::catalog_kinds_handler))
        .routes(routes!(catalog::catalog_languages_handler))
        .routes(routes!(catalog::get_work_handler))
        .routes(routes!(resume::get_resume_plan_handler))
        .routes(routes!(resume::record_resume_choice_handler))
        .routes(routes!(resume::clear_resume_choices_handler))
        .routes(routes!(resume::list_resume_plans_handler))
        .routes(routes!(catalog::search_catalog_handler))
        .routes(routes!(catalog::similar_works_handler))
        .routes(routes!(artwork::work_artwork_handler))
        .routes(routes!(artwork::album_artwork_handler))
        .routes(routes!(artwork::episode_artwork_handler))
        .routes(routes!(artwork::person_artwork_handler))
        .routes(routes!(playback::playback_info_handler))
        .routes(routes!(playback::by_external_ref_playback_info_handler))
        .routes(routes!(playback::peer_playback_info_handler))
        .routes(routes!(playback::peer_playback_event_handler))
        .routes(routes!(playback::record_playback_event_handler))
        .routes(routes!(playback_health::playback_health_handler))
        .routes(routes!(playback_health::connection_test_handler))
        .routes(routes!(playback::list_watch_progress_handler))
        .routes(routes!(
            playback::get_watch_progress_handler,
            playback::update_watch_progress_handler
        ))
        .routes(routes!(admin_playback::list_active_sessions_handler))
        .routes(routes!(admin_playback::list_session_history_handler))
        .routes(routes!(admin_playback::playback_activity_active_handler))
        .routes(routes!(admin_playback::playback_activity_facets_handler))
        .routes(routes!(admin_playback::playback_activity_history_handler))
        .routes(routes!(
            admin_playback::peer_playback_activity_active_handler
        ))
        .routes(routes!(
            admin_playback::peer_playback_activity_history_handler
        ))
        .routes(routes!(admin_playback::stop_session_handler))
        .routes(routes!(media::stream_media_handler))
        .routes(routes!(media::proxy_stream_media_handler))
        .routes(routes!(media::proxy_session_hls_file_handler))
        .routes(routes!(media::proxy_rendition_hls_file_handler))
        .routes(routes!(media::peer_session_hls_file_handler))
        .routes(routes!(media::peer_rendition_hls_file_handler))
        .routes(routes!(media::peer_stream_media_handler))
        .routes(routes!(media::media_metadata_handler))
        .routes(routes!(
            media::media_playback_options_handler,
            media::update_media_playback_options_handler
        ))
        .routes(routes!(media::media_chapters_handler))
        .routes(routes!(media::media_subtitle_handler))
        .routes(routes!(media::media_thumbnail_handler))
        .routes(routes!(folders::list_folder_roots_handler))
        .routes(routes!(folders::browse_folder_handler))
        .routes(routes!(
            folders::admin_list_folder_roots_handler,
            folders::admin_create_folder_root_handler
        ))
        .routes(routes!(folders::admin_discover_folder_roots_handler))
        .routes(routes!(
            folders::admin_update_folder_root_handler,
            folders::admin_delete_folder_root_handler
        ))
        .routes(routes!(folders::admin_scan_folder_root_handler))
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
        .routes(routes!(admin::update_source_folder_mappings_handler))
        .routes(routes!(admin::sync_source_instance_handler))
        .routes(routes!(admin::sync_status_handler))
        .routes(routes!(admin::source_matrix_handler))
        .routes(routes!(admin::http_latency_handler))
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
        .routes(routes!(household::household_status_handler))
        .routes(routes!(
            household::create_approval_handler,
            household::list_approvals_handler
        ))
        .routes(routes!(household::decide_approval_handler))
        .routes(routes!(
            household::get_user_household_handler,
            household::put_user_household_handler
        ))
        .routes(routes!(
            views::create_view_handler,
            views::list_admin_views_handler
        ))
        .routes(routes!(
            views::update_view_handler,
            views::delete_view_handler
        ))
        .routes(routes!(
            home_rails::list_admin_rails_handler,
            home_rails::create_admin_rail_handler
        ))
        .routes(routes!(home_rails::reorder_admin_rails_handler))
        .routes(routes!(
            home_rails::update_admin_rail_handler,
            home_rails::delete_admin_rail_handler
        ))
        .routes(routes!(home_rails::home_rails_handler))
        .routes(routes!(
            home_rails::get_rail_preferences_handler,
            home_rails::put_rail_preferences_handler,
            home_rails::reset_rail_preferences_handler
        ))
        .routes(routes!(views::list_views_handler))
        .routes(routes!(views::resolve_view_handler))
        .routes(routes!(
            playlists::list_playlists_handler,
            playlists::create_playlist_handler
        ))
        .routes(routes!(discovery::discover_handler))
        .routes(routes!(discovery::resolve_title_handler))
        .routes(routes!(discovery::request_title_handler))
        .routes(routes!(requests::list_requests_handler))
        .routes(routes!(requests::requests_webhook_handler))
        .routes(routes!(requests::decide_request_handler))
        .routes(routes!(requests::remove_request_handler))
        .routes(routes!(
            requests::list_integrations_handler,
            requests::create_integration_handler
        ))
        .routes(routes!(
            requests::update_integration_handler,
            requests::delete_integration_handler
        ))
        .routes(routes!(requests::test_integration_handler))
        .routes(routes!(requests::integration_users_handler))
        .routes(routes!(requests::sync_integration_handler))
        .routes(routes!(
            requests::get_request_settings_handler,
            requests::put_request_settings_handler
        ))
        .routes(routes!(
            discovery::list_watchlist_handler,
            discovery::add_watchlist_handler
        ))
        .routes(routes!(discovery::remove_watchlist_handler))
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
        .routes(routes!(
            portability::create_export_handler,
            portability::list_exports_handler
        ))
        .routes(routes!(
            portability::get_export_handler,
            portability::delete_export_handler
        ))
        .routes(routes!(portability::download_export_handler))
        .routes(routes!(portability::create_transfer_link_handler))
        .routes(routes!(portability::transfer_export_download_handler))
        .routes(routes!(portability::create_import_session_handler))
        .routes(routes!(
            portability::get_import_session_handler,
            portability::delete_import_session_handler
        ))
        .routes(routes!(portability::preview_import_session_handler))
        .routes(routes!(portability::apply_import_session_handler))
        .routes(routes!(
            portability::transfer_import_page_handler,
            portability::transfer_import_upload_handler
        ))
        .routes(routes!(portability::preview_import_handler))
        .routes(routes!(portability::apply_import_handler))
        .routes(routes!(portability::unmatched_import_handler))
        .routes(routes!(credits::work_credits_handler))
        .routes(routes!(credits::get_person_handler))
        .routes(routes!(credits::person_works_handler))
        .routes(routes!(
            remote::register_target_handler,
            remote::unregister_target_handler
        ))
        .routes(routes!(remote::list_targets_handler))
        .routes(routes!(remote::report_state_handler))
        .routes(routes!(
            remote::create_pairing_handler,
            remote::list_pairings_handler
        ))
        .routes(routes!(
            remote::get_pairing_handler,
            remote::revoke_pairing_handler,
            remote::rename_pairing_handler
        ))
        .routes(routes!(remote::approve_pairing_handler))
        .routes(routes!(remote::deny_pairing_handler))
        .routes(routes!(remote::send_command_handler))
        .routes(routes!(remote::command_status_handler))
        .routes(routes!(remote::inbox_handler))
        .routes(routes!(remote::stream_handler))
        .routes(routes!(events::events_stream_handler))
        .routes(routes!(remote::ack_event_handler))
        .routes(routes!(remote::create_handoff_handler))
        .routes(routes!(remote::get_handoff_handler))
        .routes(routes!(remote::ack_handoff_handler))
        .routes(routes!(remote::cancel_handoff_handler))
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
        .routes(routes!(peer::push_sync_handler))
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

/// Session id to (peer id, user id, recorded-at) routing hints.
pub type PlaybackSessionRoutes = Arc<
    std::sync::Mutex<
        std::collections::HashMap<uuid::Uuid, (uuid::Uuid, uuid::Uuid, std::time::Instant)>,
    >,
>;

/// Every service/repository handle the real routes in this crate depend
/// on. `playarr-bin`'s `boot_api` is the composition root that
/// constructs one of these from `playarr_config::Config`; every field
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
    pub catalog: Arc<playarr_catalog::CatalogService>,
    pub transcode: Arc<playarr_transcode::TranscodeOrchestrator>,
    pub device_flow: Arc<dyn playarr_auth::DeviceFlowHandler>,
    pub webhook: Arc<playarr_arr_sync::WebhookReceiver>,
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
    /// actually durable; `playarr-bin`'s `boot_api` also uses this to
    /// hydrate `source_instances` from the database on every boot, which
    /// is the actual fix for registered `*arr` connections not surviving
    /// a restart.
    pub source_instance_repo: Arc<dyn playarr_db::SourceInstanceRepo>,
    /// The real, durable persistence layer for `playarr_model::LibraryView`
    /// ("Views" -- saved catalog filter+sort presets, see that type's doc
    /// comment) -- backs `views.rs`'s admin CRUD and public list/resolve
    /// endpoints. Unlike `source_instances`, there is no separate in-memory
    /// cache in front of this: views are read far less often (an admin
    /// screen, and Playarr's Home shelf list on load) than the catalog
    /// itself, so a direct repo read per request is fine.
    pub library_view_repo: Arc<dyn playarr_db::LibraryViewRepo>,
    /// Admin-managed Home rail definitions and per-user overrides --
    /// `home_rails.rs`.
    pub home_rail_repo: Arc<dyn playarr_db::HomeRailRepo>,
    /// Per-user computed-rails cache (see `home_rails.rs`).
    pub home_rails_cache: Arc<home_rails::HomeRailsCache>,
    /// The real, durable persistence layer for `playarr_model::Playlist`/
    /// `PlaylistItem` -- backs `playlists.rs`'s user + System playlist CRUD
    /// and item-membership endpoints.
    pub playlist_repo: Arc<dyn playarr_db::repo::PlaylistRepo>,
    /// Per-profile watchlist storage -- `discovery.rs`.
    pub watchlist_repo: Arc<dyn playarr_db::repo::WatchlistRepo>,
    /// Smart Start/Resume answers -- `resume.rs`.
    pub resume_dismissals: Arc<dyn playarr_db::repo::ResumeDismissalRepo>,
    /// Whether any signed-in user (not just admins) may request titles from
    /// Radarr/Sonarr through discovery. `PLAYARR_REQUESTS_ALLOW_ALL_USERS`.
    pub discovery_requests_allow_all_users: bool,
    /// Unified requests plus the Ombi/Seerr sync engine (TASKS 280-287).
    pub request_sync: Arc<request_sync::RequestSync>,
    /// The real, durable persistence layer for `playarr_model::Work` --
    /// `credits.rs`'s `person_works_handler` uses this for a cheap
    /// `Work`-only fetch per credited work id, rather than going through
    /// `catalog` (which additionally hydrates each work's full
    /// season/episode/album/track/book child tree, unneeded here).
    pub work_repo: Arc<dyn playarr_db::WorkRepo>,
    /// The real, durable persistence layer for `playarr_model::Person`/
    /// `Credit` -- backs `credits.rs`'s cast/crew and "find all content
    /// for this person" endpoints. See `playarr_model::person`'s module
    /// doc comment for why this is populated only for Radarr-sourced
    /// movies today.
    pub credit_repo: Arc<dyn playarr_db::CreditRepo>,
    /// The real, durable persistence layer for
    /// `playarr_model::TdarrConnection` -- backs `tdarr.rs`'s admin
    /// registration endpoints. See that type's doc comment for why this
    /// is a singleton, unlike `source_instance_repo`.
    pub tdarr_connection_repo: Arc<dyn playarr_db::TdarrConnectionRepo>,
    /// Singleton, administrator-editable settings for this Playarr Server
    /// installation. The public version endpoint reads this repository too,
    /// so clients see a changed instance name immediately.
    pub system_settings_repo: Arc<dyn playarr_db::SystemSettingsRepo>,
    /// Encrypted server backups (`docs/architecture/server-backups.md`);
    /// `None` until `PLAYARR_BACKUP_DIR` and `PLAYARR_BACKUP_RECIPIENTS` are
    /// configured.
    pub backup: Option<Arc<playarr_backup::BackupService>>,
    pub media_files: Arc<dyn MediaFileLookup>,
    /// Per-user durable resume positions and watched state.
    pub watch_progress: Arc<dyn playarr_db::WatchProgressRepo>,
    /// Per-user server-staged download tickets -- backs `downloads.rs`'s
    /// create/list/get/cancel/file-serve endpoints and
    /// `media.rs`'s `media_download_options_handler`. See
    /// `playarr_model::DownloadTicket`'s doc comment for how this differs
    /// from `rendition_repo` (that one backs shared, playback-oriented HLS
    /// renditions; this one backs per-user, single-file download grants).
    pub download_tickets: Arc<dyn playarr_db::DownloadTicketRepo>,
    /// Verifies the `Authorization: Bearer <token>` header every
    /// [`auth_extractor::AuthUser`]/[`auth_extractor::AdminUser`]
    /// extraction depends on -- the same issuer instance
    /// `POST /api/v1/auth/login` and the RFC 8628 device flow issue tokens
    /// through, so a token from either path verifies here identically.
    pub jwt: Arc<playarr_auth::JwtIssuer>,
    /// Superseded id-list admin check -- [`auth_extractor::AdminUser`] no
    /// longer reads this at all (it does a real `Policy::is_admin` check via
    /// `user_repo`/`policy_repo` below instead; see that extractor's doc
    /// comment for the permanent replacement this field used to stand in
    /// for). Left in `AppState` for now since nothing downstream of
    /// `playarr-bin`'s `boot_api` construction depends on it being gone --
    /// a later cleanup pass can drop the field and its construction once
    /// nothing else references it either.
    pub admin_registry: Arc<playarr_auth::InMemoryAdminRegistry>,
    /// The operator's configured login trust tier for `POST
    /// /api/v1/auth/login` -- see `playarr_auth::AuthMode`'s doc comment
    /// for what each tier requires, and `playarr-bin`'s `boot_api` for
    /// how this pass resolves it (and the security implications of its
    /// default) from `PLAYARR_AUTH_MODE`.
    pub auth_mode: Arc<playarr_auth::AuthMode>,
    /// Resolves the `User`s participating in login. Real in production --
    /// `playarr-bin`'s `boot_api` wires in
    /// [`user_directory::RepoBackedUserDirectory`], backed by `user_repo`
    /// below, now that real `User` persistence exists (replacing
    /// `playarr_auth::login::InMemoryUserDirectory`'s old in-memory
    /// stand-in).
    pub user_directory: Arc<dyn playarr_auth::UserDirectory>,
    /// The real, durable persistence layer for `playarr_model::User`
    /// accounts -- backs [`user_directory::RepoBackedUserDirectory`] above,
    /// the real `Policy`-backed check in [`auth_extractor::AdminUser`], and
    /// `users.rs`'s admin user-management endpoints.
    pub user_repo: Arc<dyn playarr_db::UserRepo>,
    /// Expiring, one-use account invitations issued by administrators and
    /// redeemed by the unauthenticated Playarr sign-up endpoint.
    pub user_invite_repo: Arc<dyn playarr_db::UserInviteRepo>,
    /// Approval workflow for ordinary Playarr users asking permission to
    /// generate one friend-invite QR code.
    pub user_invite_request_repo: Arc<dyn playarr_db::UserInviteRequestRepo>,
    /// FCM device/browser registrations for approval notifications.
    pub push_registration_repo: Arc<dyn playarr_db::PushRegistrationRepo>,
    pub push_notifier: Arc<dyn notifications::PushNotifier>,
    pub firebase_web_config: Option<notifications::FirebaseWebConfig>,
    /// Optional profile-lock PIN hashes. Kept behind a distinct repository
    /// so they cannot be confused with or overwrite account passwords.
    pub profile_pin_repo: Arc<dyn playarr_db::ProfilePinRepo>,
    /// Household and child controls: server-counted watch budgets, guardian
    /// approvals, PIN lockout and the content gate
    /// (`docs/architecture/household-controls.md`).
    pub household: Arc<household::HouseholdState>,
    /// The real, durable persistence layer for `playarr_model::Policy`
    /// (permission/role) records -- looked up by a user's `policy_id` to
    /// decide `Policy::is_admin` (see [`auth_extractor::AdminUser`]) and by
    /// `users.rs`'s admin user-management endpoints.
    pub policy_repo: Arc<dyn playarr_db::PolicyRepo>,
    /// Issues/rotates refresh-token families for `POST /api/v1/auth/login`
    /// -- shared with the RFC 8628 device flow's own token issuance
    /// (`device_flow` above wraps a clone of the same underlying service),
    /// so both paths agree on `Device`/`Session` bookkeeping.
    pub sessions: Arc<playarr_auth::RefreshTokenService>,
    /// Absolute lifetime of a refresh-token family minted by
    /// `POST /api/v1/auth/login` -- see
    /// `playarr_auth::refresh::RefreshTokenRecord::expires_at`'s doc
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
    pub analytics_store: Arc<dyn playarr_db::analytics::AnalyticsStore>,
    /// In-process "what's happening right now" cache -- backs
    /// `record_playback_event_handler`'s ownership check, the admin live-
    /// sessions endpoint, and (later) `Policy::max_concurrent_sessions`
    /// enforcement. The same `Arc` `analytics` below also holds.
    pub session_registry: Arc<dyn playarr_telemetry::analytics::SessionRegistry>,
    /// Entry-node routing hints for playback sessions negotiated on another
    /// peer. The client continues posting lifecycle events to the entry node,
    /// so this short-lived map identifies the signed peer call that must
    /// receive those events. The owning peer remains authoritative for the
    /// session and user checks.
    pub playback_session_routes: PlaybackSessionRoutes,
    /// Single fan-out point for session/event writes -- see
    /// `playarr_telemetry::analytics::collector`'s doc comment for the
    /// synchronous-registry / batched-durable-write split this owns.
    pub analytics: Arc<playarr_telemetry::analytics::AnalyticsCollector>,
    /// This installation's own durable Ed25519 identity -- singleton,
    /// minted (if it doesn't already exist) at process boot by
    /// `backend/src/main.rs::boot_api` via `admin_peer::ensure_node_identity`,
    /// so a row always exists by the time this repo is ever read. Byte-for-
    /// byte inert for a single, ungrouped node: nothing reads this outside
    /// `admin_peer.rs`/`peer_extractor.rs`. See
    /// `docs/architecture/peer-groups.md` §2.1/§3.3.
    pub node_identity_repo: Arc<dyn playarr_db::NodeIdentityRepo>,
    /// The peer group this node has founded or joined, if any -- in
    /// practice at most one row (`node_identity.group_id`), but keyed on
    /// `PeerGroup::id` rather than assumed-singleton (see that repo
    /// trait's own doc comment).
    pub peer_group_repo: Arc<dyn playarr_db::PeerGroupRepo>,
    /// Every known member of this node's peer group, including a row for
    /// this node itself (`is_self = true`) -- backs `admin_peer.rs`'s
    /// list/self-profile endpoints and `peer_extractor.rs`'s signature
    /// verification (looks up the claimed signer's `public_key` here).
    pub peer_node_repo: Arc<dyn playarr_db::PeerNodeRepo>,
    /// Single-use, short-TTL, admin-issued group join tokens -- backs
    /// `admin_peer.rs`'s `POST .../join-tokens` and `peer.rs`'s
    /// `POST /api/v1/peer/enroll`.
    pub peer_join_token_repo: Arc<dyn playarr_db::PeerJoinTokenRepo>,
    /// In-memory staging area for `PUT /api/v1/admin/peer-nodes/self`,
    /// consulted by `admin_peer::found_peer_group_handler`/
    /// `join_peer_group_handler` while this node has no persisted self
    /// `PeerNode` row yet to write through to -- see
    /// `admin_peer::PendingSelfPeerProfile`'s doc comment for why this is
    /// deliberately not a new migration column. `boot_api` optionally seeds
    /// this from `PLAYARR_NODE_NAME` at boot (ungrouped nodes only) as a
    /// pure UX convenience -- see that function's own comment; it never
    /// substitutes for actually calling this route.
    pub pending_self_peer_profile:
        Arc<std::sync::Mutex<Option<admin_peer::PendingSelfPeerProfile>>>,
    /// Group-wide library registry (`docs/architecture/peer-groups.md`
    /// §2.3) -- backs `peer::libraries_handler`'s `group_libraries` half.
    pub group_library_repo: Arc<dyn playarr_db::GroupLibraryRepo>,
    /// The real, durable persistence layer for `playarr_model::MediaFile`
    /// -- backs `peer::availability_handler`'s live derivation of this
    /// node's own leaf availability (`list_work_ids`/`get_by_id`), joined
    /// to `source_instance_repo` for `group_library_id`. Distinct from
    /// `media_files` above (`Arc<dyn MediaFileLookup>`, a single-id lookup
    /// only): this field is the full repository surface, the same one
    /// `AppState::catalog` is itself built against.
    pub media_file_repo: Arc<dyn playarr_db::MediaFileRepo>,
    /// Operator-configured routing policy (`docs/architecture/
    /// peer-groups.md` §2.4) -- backs `peer::routing_rules_handler`.
    pub routing_rule_repo: Arc<dyn playarr_db::RoutingRuleRepo>,
    /// Read-only, per-peer leaf availability cache (`docs/architecture/
    /// peer-groups.md` §2.3/§4) -- `availability_sync.rs`
    /// (`playarr-peer-sync`) is its only writer; this crate only ever
    /// reads it, both for `CatalogService`'s browse/get_by_id hydration
    /// (wired separately, straight into `catalog` at construction) and for
    /// Phase 3's routing-context gathering (`playback::
    /// resolve_route_for_local_media_file`), which needs the raw rows
    /// `CatalogService` doesn't expose back out.
    pub peer_leaf_availability_repo: Arc<dyn playarr_db::PeerLeafAvailabilityRepo>,
    /// Credential-free source identities learned from each peer.
    pub peer_source_instance_repo: Arc<dyn playarr_db::PeerSourceInstanceRepo>,
    /// Per-peer entity cursors shared by pull and pushed page ingestion.
    pub peer_sync_state_repo: Arc<dyn playarr_db::PeerSyncStateRepo>,
    /// Durable record of LWW conflicts discovered while accepting a push.
    pub sync_conflict_log_repo: Arc<dyn playarr_db::SyncConflictLogRepo>,
    /// Cross-replica lock provider used to elect one push loop per peer.
    pub coordinator: Arc<dyn playarr_coordination::ClusterCoordinator>,
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
    /// Per-peer internal transport overrides used only for outbound server
    /// requests; peer address records and client-facing URLs remain public.
    pub peer_transport_routes: playarr_peer_sync::peer_client::PeerTransportRoutes,
    /// In-process, per-(method, route template) HTTP request-duration
    /// recorder -- written by `request_timing_middleware::record_request_timing`
    /// (layered over the whole router in `build_router`) on every request
    /// that resolved to a real route, and read by
    /// `admin::http_latency_handler`'s aggregated p50/p95/p99 endpoint.
    /// Purely in-memory, like `session_registry`: nothing here survives a
    /// restart, and each node in a multi-node deployment reports only its
    /// own traffic.
    pub request_timing: Arc<playarr_telemetry::request_timing::RequestTimingRegistry>,
    /// Remote-control targets, pairings, per-target event queue and
    /// handoffs (`docs/architecture/remote-control.md`).
    pub remote_repo: Arc<dyn playarr_db::RemoteRepo>,
    /// Writes to the per-user live event stream (`GET /api/v1/events`,
    /// `docs/architecture/live-events.md`) and is the stream's read source.
    pub live_events: playarr_db::LiveEventPublisher,
    /// Short-lived cache of per-instance calendar answers, see `calendar`.
    pub calendar_cache: Arc<calendar::CalendarCache>,
    /// Shared snapshot of this node's own derived peer availability.
    pub own_availability:
        Arc<own_availability::OwnAvailabilityCache<Vec<peer::PeerAvailabilityRow>>>,
    /// Node-local staging area for self-service user-data export jobs.
    pub portability: Arc<portability::ExportRegistry>,
    /// Revocable tokens behind the external iCal subscription URL.
    pub calendar_feed_token_repo: Arc<dyn playarr_db::CalendarFeedTokenRepo>,
    /// Grab and import events behind the availability-lag statistic.
    pub availability_event_repo: Arc<dyn playarr_db::AvailabilityEventRepo>,
    /// Root folders and the unsorted-folder scan cache (`folders.rs`,
    /// `folder_scan.rs`).
    pub folder_repo: Arc<dyn playarr_db::FolderRepo>,
}

impl FromRef<AppState> for ReadinessState {
    fn from_ref(state: &AppState) -> Self {
        state.readiness.clone()
    }
}

/// Builds the full Axum router: every system route, the version-gate
/// middleware layered over the whole thing, and the OpenAPI spec those
/// routes contributed to. `playarr-bin` mounts the returned `Router`
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
/// listener `playarr-bin` serves when it isn't running this router at
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
/// One header-specific refinement, not a loosening of the above: allowed
/// *headers* are mirrored from each request's own
/// `Access-Control-Request-Headers` (`AllowHeaders::mirror_request`)
/// rather than wildcarded. `CorsLayer::permissive()` alone would emit the
/// literal `Access-Control-Allow-Headers: *`, and the Fetch standard
/// explicitly excludes `Authorization` from that wildcard -- Chromium
/// enforces this -- so a wildcard alone would fail preflight for any
/// cross-origin, Bearer-authenticated caller, e.g. the Playarr Cast
/// receiver served from `playarr.app` calling a self-hosted server.
///
/// `web_assets_dir`, when `Some`, mounts Playarr Server Admin's built static
/// assets (`clients/tv-web/admin/dist`) as this router's fallback —
/// any request that doesn't match an `/api/*` route, `/healthz`, or
/// `/readyz` is served a static file from that directory, falling back to
/// `index.html` for anything not found on disk (React Router's
/// client-side routes, e.g. `/library/{id}`, aren't real files). This is
/// what lets the API and the Web UI live on one origin, one port, one
/// `docker run` — the same story every `*arr` app ships, rather than
/// requiring a separately-hosted web client pointed at this API via CORS.
/// `playarr-bin` resolves the directory (env override or a path next to
/// the binary) and passes `None` when it can't find a built `index.html`
/// there, in which case this router serves API-only, exactly as before.
pub fn build_router(
    state: AppState,
    version_gate: VersionGateLayer,
    web_assets_dir: Option<PathBuf>,
) -> (Router, utoipa::openapi::OpenApi) {
    build_router_with_tv(state, version_gate, web_assets_dir, None)
}

/// [`build_router`] plus `tv_assets_dir`: when `Some`, the Playarr Web
/// client built for server hosting (`vite --mode server`, `base: "/tv/"`) is
/// served under `/tv/` over whatever scheme the operator's listener uses.
/// This is how a TV whose browser can only reach an `http://` server (VIDAA)
/// avoids mixed content: the hosted `https://` launcher cannot call an
/// `http://` API, but a page served by the server itself over `http://` can.
/// Unknown paths under `/tv/` fall back to its `index.html` (client-side
/// routes); the API routes and the Admin fallback are unaffected.
pub fn build_router_with_tv(
    state: AppState,
    version_gate: VersionGateLayer,
    web_assets_dir: Option<PathBuf>,
    tv_assets_dir: Option<PathBuf>,
) -> (Router, utoipa::openapi::OpenApi) {
    let readiness_for_alias = state.readiness.clone();
    let state_for_request_timing = state.clone();
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

    let router = router
        // The ETag layer hashes the identity bytes, so it sits inside the compression layer.
        .layer(axum::middleware::from_fn(http_cache::json_cache_middleware))
        .layer(http_cache::compression_layer())
        .layer(version_gate)
        .layer(
            // CorsLayer::permissive() emits the literal Access-Control-Allow-Headers: *, and the
            // Fetch standard explicitly excludes Authorization from that wildcard. Mirroring
            // Access-Control-Request-Headers names every header the caller actually asked for --
            // including authorization -- which is the only way a cross-origin, Bearer-authenticated
            // caller (the Playarr Cast receiver served from playarr.app) can pass preflight. Origin
            // stays * because this API is never cookie/credential-authenticated.
            CorsLayer::permissive().allow_headers(AllowHeaders::mirror_request()),
        )
        .layer(axum::middleware::from_fn_with_state(
            state_for_request_timing,
            request_timing_middleware::record_request_timing,
        ));

    let router = match tv_assets_dir {
        Some(dir) => {
            let index_html = ServeFile::new(dir.join("index.html"));
            router.nest_service("/tv", ServeDir::new(dir).fallback(index_html))
        }
        None => router,
    };

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
    use playarr_model::VersionEnvelope;
    use tower::ServiceExt;

    #[tokio::test]
    async fn tv_assets_are_served_under_tv_with_spa_fallback() {
        let dir = std::env::temp_dir().join(format!("playarr-tv-assets-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        std::fs::write(dir.join("index.html"), "<html>tv shell</html>").unwrap();
        std::fs::write(dir.join("assets/app.js"), "console.log(1)").unwrap();
        let (_unused, test) = test_support::test_state().await;
        let app = test.app.clone();
        let (router, _api) = build_router_with_tv(
            app,
            test_support::test_version_gate(),
            None,
            Some(dir.clone()),
        );
        let get = |uri: &'static str| {
            let router = router.clone();
            async move {
                let response = router
                    .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
                    .await
                    .unwrap();
                let status = response.status();
                let body = axum::body::to_bytes(response.into_body(), 1 << 20)
                    .await
                    .unwrap();
                (status, String::from_utf8_lossy(&body).to_string())
            }
        };
        assert_eq!(
            get("/tv/").await,
            (StatusCode::OK, "<html>tv shell</html>".to_string())
        );
        assert_eq!(get("/tv/assets/app.js").await.1, "console.log(1)");
        assert_eq!(
            get("/tv/library/42").await,
            (StatusCode::OK, "<html>tv shell</html>".to_string())
        );
        assert_eq!(get("/tv").await.0, StatusCode::OK);
        assert_eq!(get("/healthz").await.0, StatusCode::OK);
        let _ = std::fs::remove_dir_all(dir);
    }

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
        assert_eq!(envelope.instance_name, "Playarr Server");
        assert_eq!(envelope.server_version, "0.1.0");
    }

    /// Regression test for the Playarr Cast receiver (served cross-origin
    /// from `playarr.app`) being able to pass CORS preflight at all.
    /// `CorsLayer::permissive()` alone emits a literal
    /// `Access-Control-Allow-Headers: *`, which the Fetch standard (and
    /// Chromium) refuses to treat as covering `Authorization` -- so without
    /// `AllowHeaders::mirror_request()` this preflight would still succeed,
    /// but the browser would strip the real request's `Authorization`
    /// header on the follow-up call anyway. Mirroring
    /// `Access-Control-Request-Headers` back verbatim is what actually
    /// fixes that.
    #[tokio::test]
    async fn cors_preflight_mirrors_requested_headers_for_a_playback_route() {
        let (router, _state) = test_support::test_state().await;
        let media_file_id = uuid::Uuid::new_v4();

        let response = router
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri(format!("/api/v1/media/{media_file_id}/stream"))
                    .header(axum::http::header::ORIGIN, "https://playarr.app")
                    .header(axum::http::header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
                    .header(
                        axum::http::header::ACCESS_CONTROL_REQUEST_HEADERS,
                        "authorization",
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let allow_headers = response
            .headers()
            .get(axum::http::header::ACCESS_CONTROL_ALLOW_HEADERS)
            .expect("preflight response must carry Access-Control-Allow-Headers")
            .to_str()
            .expect("header value is ASCII");
        assert!(
            allow_headers
                .split(',')
                .any(|header| header.trim().eq_ignore_ascii_case("authorization")),
            "expected \"authorization\" in Access-Control-Allow-Headers, got {allow_headers:?}",
        );

        assert_eq!(
            response
                .headers()
                .get(axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .expect("preflight response must carry Access-Control-Allow-Origin"),
            "*",
        );
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
        assert!(json.contains("/api/v1/artwork/episode/{series_work_id}/{episode_id}/{kind}"));
        assert!(json.contains("/api/v1/playback/{media_file_id}"));
        assert!(json.contains("/api/v1/admin/playback/activity/facets"));
        assert!(json.contains("/api/v1/admin/source-instances"));
        assert!(json.contains("/api/v1/admin/system-settings"));
        assert!(json.contains("/api/v1/admin/system/capabilities"));
        assert!(json.contains("/api/v1/admin/views"));
        assert!(json.contains("/api/v1/views"));
        assert!(json.contains("/api/v1/views/{id}/resolve"));
        assert!(json.contains("/api/v1/users/me/profile-avatar"));
    }

    #[test]
    fn openapi_signed_peer_routes_require_all_signature_headers() {
        let spec = serde_json::to_value(openapi_spec()).unwrap();
        let schemes = spec["components"]["securitySchemes"]
            .as_object()
            .expect("OpenAPI security schemes");
        for (scheme, header) in [
            (PEER_ID_SECURITY_SCHEME, "X-Playarr-Peer-Id"),
            (PEER_TIMESTAMP_SECURITY_SCHEME, "X-Playarr-Timestamp"),
            (PEER_NONCE_SECURITY_SCHEME, "X-Playarr-Nonce"),
            (PEER_SIGNATURE_SECURITY_SCHEME, "X-Playarr-Signature"),
        ] {
            assert_eq!(schemes[scheme]["type"], "apiKey");
            assert_eq!(schemes[scheme]["in"], "header");
            assert_eq!(schemes[scheme]["name"], header);
        }

        let expected = serde_json::json!([{
            "peer_id_header": [],
            "peer_timestamp_header": [],
            "peer_nonce_header": [],
            "peer_signature_header": [],
        }]);
        let paths = spec["paths"].as_object().expect("OpenAPI paths");
        let mut signed_operations = 0;
        for (path, item) in paths {
            if !path.starts_with("/api/v1/peer/") || path == "/api/v1/peer/enroll" {
                continue;
            }
            for method in ["get", "put", "post", "delete", "patch"] {
                let Some(operation) = item.get(method) else {
                    continue;
                };
                signed_operations += 1;
                assert_eq!(
                    operation.get("security"),
                    Some(&expected),
                    "{method} {path} must require all peer-signature headers together"
                );
            }
        }
        assert!(
            signed_operations >= 12,
            "expected every known signed peer operation to be covered"
        );

        assert!(
            paths["/api/v1/peer/enroll"]["post"]
                .get("security")
                .is_none_or(serde_json::Value::is_null),
            "peer enrolment authenticates with its request-body join token"
        );
        assert_eq!(
            paths["/api/v1/admin/playback/activity/facets"]["get"].get("security"),
            Some(&serde_json::json!([{"bearer_auth": []}]))
        );
    }

    /// Regenerates (with `UPDATE_OPENAPI_SPEC=1`) or verifies (without it)
    /// `backend/openapi/playarr.yaml` against the live utoipa spec. This
    /// is the "small #[test]" the crate doc comment describes as the
    /// regeneration mechanism.
    #[test]
    fn openapi_spec_matches_checked_in_file() {
        let yaml = openapi_spec().to_yaml().expect("serialize OpenAPI to YAML");
        let path =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../openapi/playarr.yaml");

        if std::env::var("UPDATE_OPENAPI_SPEC").is_ok() {
            std::fs::write(&path, &yaml).expect("write backend/openapi/playarr.yaml");
            return;
        }

        let checked_in = std::fs::read_to_string(&path).unwrap_or_default();
        assert_eq!(
            checked_in, yaml,
            "backend/openapi/playarr.yaml is out of date with the live utoipa spec; \
             regenerate with `UPDATE_OPENAPI_SPEC=1 cargo test -p playarr-api openapi_spec_matches_checked_in_file`"
        );
    }
}
