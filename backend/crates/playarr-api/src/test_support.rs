//! Shared test-only harness: builds a full [`AppState`] (every field real,
//! backed by in-memory/in-process test doubles or an ephemeral in-memory
//! SQLite `DbPool` with real migrations applied -- never mocks of the
//! service types themselves) plus the router built from it, so every
//! module's `#[cfg(test)]` tests exercise the real wiring end-to-end
//! through actual HTTP requests rather than calling handlers directly.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use axum::Router;
use chrono::{Duration, Utc};
use playarr_auth::{
    DashMapDeviceFlowHandler, DeviceFlowConfig, DeviceFlowHandler, InMemoryAdminRegistry,
    InMemoryDeviceAuthorizationStore, InMemoryRefreshTokenStore, JwtIssuer, RefreshTokenService,
    RefreshTokenStore, TrustedNetwork, UserDirectory,
};
use playarr_cache::{CacheAndPubSub, InMemory};
use playarr_catalog::CatalogService;
use playarr_db::analytics::{AnalyticsStore, SqlxAnalyticsStore};
use playarr_db::repo::{
    seed_default_views, PlaylistRepo, SqlxCreditRepo, SqlxDeviceRepo, SqlxDownloadTicketRepo,
    SqlxGroupLibraryRepo, SqlxLibraryViewRepo, SqlxMediaFileRepo, SqlxNodeIdentityRepo,
    SqlxPeerGroupRepo, SqlxPeerJoinTokenRepo, SqlxPeerLeafAvailabilityRepo, SqlxPeerNodeRepo,
    SqlxPlaylistRepo, SqlxPolicyRepo, SqlxProfilePinRepo, SqlxPushRegistrationRepo,
    SqlxRenditionRepo, SqlxRoutingRuleRepo, SqlxSourceInstanceRepo, SqlxSystemSettingsRepo,
    SqlxTdarrConnectionRepo, SqlxUserInviteRepo, SqlxUserInviteRequestRepo, SqlxUserRepo,
    SqlxWatchProgressRepo, SqlxWorkRepo,
};
use playarr_db::{
    CreditRepo, DbPool, DeviceRepo, DownloadTicketRepo, GroupLibraryRepo, LibraryViewRepo,
    MediaFileRepo, NodeIdentityRepo, PeerGroupRepo, PeerJoinTokenRepo, PeerLeafAvailabilityRepo,
    PeerNodeRepo, PolicyRepo, ProfilePinRepo, PushRegistrationRepo, RenditionRepo, RoutingRuleRepo,
    SourceInstanceRepo, SystemSettingsRepo, TdarrConnectionRepo, UserInviteRepo,
    UserInviteRequestRepo, UserRepo, WatchProgressRepo, WorkRepo,
};
use playarr_model::{Availability, Policy, Sensitive, User, Work, WorkKind};
use playarr_telemetry::analytics::{AnalyticsCollector, InMemorySessionRegistry, SessionRegistry};
use playarr_transcode::{ActiveSessionCounter, TranscodeOrchestrator};
use uuid::Uuid;

use crate::playback::{InMemoryMediaFileLookup, MediaFileLookup};
use crate::source_registry::SourceInstanceRegistry;
use crate::user_directory::RepoBackedUserDirectory;
use crate::version::VersionState;
use crate::version_gate::{ClientCompatibilityTable, VersionGateLayer};
use crate::{build_router, AppState, ReadinessState};

#[derive(Default)]
pub struct RecordingPushNotifier {
    pub sent: tokio::sync::Mutex<Vec<(String, crate::notifications::PushMessage)>>,
}

#[async_trait::async_trait]
impl crate::notifications::PushNotifier for RecordingPushNotifier {
    async fn send(
        &self,
        token: &str,
        message: &crate::notifications::PushMessage,
    ) -> Result<crate::notifications::PushSendOutcome, String> {
        self.sent
            .lock()
            .await
            .push((token.to_string(), message.clone()));
        Ok(crate::notifications::PushSendOutcome::Delivered)
    }
}

pub struct TestState {
    pub app: AppState,
    pub source_instances: Arc<SourceInstanceRegistry>,
    pub media_files: Arc<InMemoryMediaFileLookup>,
    pub device_flow: Arc<dyn DeviceFlowHandler>,
    pub work_repo: Arc<dyn WorkRepo>,
    pub media_file_repo: Arc<dyn MediaFileRepo>,
    /// Same `EmbeddingRepo` `app.catalog` is built against (via
    /// `CatalogService::with_embedding_repo`) -- exposed here so tests can
    /// seed a `WorkEmbedding` directly to exercise `GET /api/v1/catalog/
    /// {id}/similar`, since `CatalogService` has no public accessor for
    /// its own repo, by design.
    pub embedding_repo: Arc<dyn playarr_db::EmbeddingRepo>,
    /// Same `RenditionRepo` `app.transcode` is backed by -- exposed here so
    /// tests can seed a `Ready` rendition directly (`TranscodeOrchestrator`
    /// has no public accessor for its own repo, by design).
    pub rendition_repo: Arc<dyn RenditionRepo>,
    /// Same `InMemoryAdminRegistry` `app.admin_registry` wraps, exposed here
    /// as its concrete type. Superseded for minting an admin test caller --
    /// `crate::auth_extractor::AdminUser` no longer reads `admin_registry`
    /// at all (it checks a real, persisted `Policy::is_admin` via
    /// `user_repo`/`policy_repo` instead); use [`seed_admin_user`] to
    /// persist a real admin `User`+`Policy` for a test caller instead of
    /// calling [`InMemoryAdminRegistry::add`] here.
    pub admin_registry: Arc<InMemoryAdminRegistry>,
    /// Real, `SqlxUserRepo`-backed persistence for the same in-memory
    /// SQLite pool `app` is built against -- exposed here so tests can seed
    /// additional users directly (see [`seed_admin_user`]).
    pub user_repo: Arc<dyn UserRepo>,
    /// Real, `SqlxPolicyRepo`-backed persistence for the same in-memory
    /// SQLite pool `app` is built against.
    pub policy_repo: Arc<dyn PolicyRepo>,
    /// The same in-memory SQLite pool every repo above is built against --
    /// exposed here so tests can assert on columns no repo trait reads back
    /// (e.g. `users.origin_peer_id`/`policies.origin_peer_id`, deliberately
    /// not part of `playarr_model::{User, Policy}` -- see
    /// `playarr-db::repo::user`'s own doc comment), the same rationale
    /// `embedding_repo`/`rendition_repo` above already document.
    pub pool: DbPool,
    pub push_notifications: Arc<RecordingPushNotifier>,
    /// The clock `app.household` reads; move it to cross schedule, budget
    /// and approval-expiry boundaries.
    pub clock: Arc<crate::household::FixedClock>,
    /// The id of the one `User` seeded into `app.user_directory` and bound
    /// to `app.auth_mode`'s trusted-network auto-login -- what
    /// `POST /api/v1/auth/login` resolves to for any source IP in tests
    /// (the seeded `AuthMode::TrustedNetwork` allowlist is `0.0.0.0/0`).
    pub default_user_id: Uuid,
    /// Kept alive for `TestState`'s lifetime so `WebhookReceiver::handle`'s
    /// `try_send` has a live receiver to enqueue onto, mirroring how a real
    /// deployment's reconciliation poller holds the other end open. Never
    /// read directly by tests -- see [`crate::AppState::webhook`].
    _trigger_rx: tokio::sync::mpsc::Receiver<playarr_arr_sync::RefetchRequest>,
}

/// Issues a real, verifiable access token for `user_id` via
/// `state.app.jwt` -- the same [`JwtIssuer`] every `AuthUser`/`AdminUser`
/// extraction in the router under test verifies against. Tests that need
/// an *admin* caller should also call
/// `state.admin_registry.add(user_id)` first.
pub fn mint_access_token(state: &TestState, user_id: Uuid) -> String {
    state
        .app
        .jwt
        .issue_access_token(user_id, Uuid::new_v4(), Uuid::new_v4())
        .expect("issue test access token")
}

/// `Authorization` header value for [`mint_access_token`]'s output.
pub fn bearer_header(token: &str) -> String {
    format!("Bearer {token}")
}

/// Persists a real `User` (with an admin `Policy`) for `user_id` via
/// `state.user_repo`/`policy_repo` -- the real, `Policy`-backed replacement
/// for the old `state.admin_registry.add(user_id)` pattern. Call this
/// before [`mint_access_token`] for any test that needs an admin caller:
/// `crate::auth_extractor::AdminUser` now checks a real, persisted
/// `Policy::is_admin` (see that extractor's doc comment for why), so a
/// caller that only exists in `admin_registry` and not in the database no
/// longer passes the check.
pub async fn seed_admin_user(state: &TestState, user_id: Uuid) {
    let policy = Policy {
        id: Uuid::new_v4(),
        name: format!("test-admin-policy-{user_id}"),
        library_allow: Vec::new(),
        group_library_allow: Vec::new(),
        blocked_folders: Vec::new(),
        max_rating: None,
        blocked_tags: Vec::new(),
        allowed_tags: Vec::new(),
        can_transcode: true,
        can_download: true,
        can_delete: true,
        can_share_public: true,
        can_request: false,
        device_allow: Vec::new(),
        max_concurrent_sessions: None,
        household: Default::default(),
        access_schedule: None,
        // Mirrors the real bootstrap admin (see `main.rs`'s
        // `bootstrap_admin_if_needed`): admin access does not imply
        // Playarr streaming access, so a test-seeded admin shouldn't
        // either. Tests that need an admin caller who can *also* stream
        // should set this explicitly rather than relying on this helper.
        can_stream: false,
        is_admin: true,
    };
    state
        .policy_repo
        .upsert(&policy)
        .await
        .expect("seed admin test policy");

    let user = User {
        id: user_id,
        username: format!("test-admin-{user_id}"),
        display_name: "Test Admin User".to_string(),
        email: None,
        password_hash: Sensitive::new(playarr_auth::login::hash_password("test-only-password")),
        policy_id: policy.id,
        created_at: Utc::now(),
        disabled: false,
        preferred_audio_language: playarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
    };
    state
        .user_repo
        .upsert(&user)
        .await
        .expect("seed admin test user");
}

/// Persists a real `User` (with a `can_stream: true` `Policy`) for
/// `user_id` -- the fixture `crate::auth_extractor::StreamingUser` tests
/// need for a caller who's logged in *and* permitted to use Playarr.
/// Mirrors [`seed_admin_user`]; use this instead when a test needs a
/// non-admin streaming caller specifically (or call `seed_admin_user` and
/// separately flip `can_stream` if a test genuinely needs both grants).
pub async fn seed_streaming_user(state: &TestState, user_id: Uuid) {
    let policy = Policy {
        id: Uuid::new_v4(),
        name: format!("test-streaming-policy-{user_id}"),
        library_allow: Vec::new(),
        group_library_allow: Vec::new(),
        blocked_folders: Vec::new(),
        max_rating: None,
        blocked_tags: Vec::new(),
        allowed_tags: Vec::new(),
        can_transcode: true,
        can_download: true,
        can_delete: false,
        can_share_public: false,
        can_request: false,
        device_allow: Vec::new(),
        max_concurrent_sessions: None,
        household: Default::default(),
        access_schedule: None,
        can_stream: true,
        is_admin: false,
    };
    state
        .policy_repo
        .upsert(&policy)
        .await
        .expect("seed streaming test policy");

    let user = User {
        id: user_id,
        username: format!("test-streaming-{user_id}"),
        display_name: "Test Streaming User".to_string(),
        email: None,
        password_hash: Sensitive::new(playarr_auth::login::hash_password("test-only-password")),
        policy_id: policy.id,
        created_at: Utc::now(),
        disabled: false,
        preferred_audio_language: playarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
    };
    state
        .user_repo
        .upsert(&user)
        .await
        .expect("seed streaming test user");
}

/// Like [`seed_streaming_user`] but with a caller-chosen `Policy::
/// library_allow` -- exists for tests that need to prove per-user library
/// access control (`CatalogViewer`/`StreamingUser::allowed_libraries`)
/// actually restricts a caller to a specific set of source-instance ids,
/// rather than the wide-open (`is_admin`-bypassed or empty-but-unchecked)
/// policies [`seed_admin_user`]/[`seed_streaming_user`] seed.
pub async fn seed_streaming_user_with_library_allow(
    state: &TestState,
    user_id: Uuid,
    library_allow: Vec<Uuid>,
) {
    let policy = Policy {
        id: Uuid::new_v4(),
        name: format!("test-restricted-streaming-policy-{user_id}"),
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
        can_request: false,
        device_allow: Vec::new(),
        max_concurrent_sessions: None,
        household: Default::default(),
        access_schedule: None,
        can_stream: true,
        is_admin: false,
    };
    state
        .policy_repo
        .upsert(&policy)
        .await
        .expect("seed restricted streaming test policy");

    let user = User {
        id: user_id,
        username: format!("test-restricted-streaming-{user_id}"),
        display_name: "Test Restricted Streaming User".to_string(),
        email: None,
        password_hash: Sensitive::new(playarr_auth::login::hash_password("test-only-password")),
        policy_id: policy.id,
        created_at: Utc::now(),
        disabled: false,
        preferred_audio_language: playarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
    };
    state
        .user_repo
        .upsert(&user)
        .await
        .expect("seed restricted streaming test user");
}

/// Like [`seed_streaming_user_with_library_allow`] but the grant is a
/// `Policy::group_library_allow` (portable `GroupLibrary` ids, §5.1)
/// instead of a raw `SourceInstance` id -- `library_allow` is left empty, so
/// a test using this helper proves the group-library grant *alone* is
/// enough, not merely that it's additive on top of an existing
/// `library_allow` grant.
pub async fn seed_streaming_user_with_group_library_allow(
    state: &TestState,
    user_id: Uuid,
    group_library_allow: Vec<Uuid>,
) {
    let policy = Policy {
        id: Uuid::new_v4(),
        name: format!("test-group-library-streaming-policy-{user_id}"),
        library_allow: Vec::new(),
        group_library_allow,
        blocked_folders: Vec::new(),
        max_rating: None,
        blocked_tags: Vec::new(),
        allowed_tags: Vec::new(),
        can_transcode: true,
        can_download: true,
        can_delete: false,
        can_share_public: false,
        can_request: false,
        device_allow: Vec::new(),
        max_concurrent_sessions: None,
        household: Default::default(),
        access_schedule: None,
        can_stream: true,
        is_admin: false,
    };
    state
        .policy_repo
        .upsert(&policy)
        .await
        .expect("seed group-library streaming test policy");

    let user = User {
        id: user_id,
        username: format!("test-group-library-streaming-{user_id}"),
        display_name: "Test Group Library Streaming User".to_string(),
        email: None,
        password_hash: Sensitive::new(playarr_auth::login::hash_password("test-only-password")),
        policy_id: policy.id,
        created_at: Utc::now(),
        disabled: false,
        preferred_audio_language: playarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
    };
    state
        .user_repo
        .upsert(&user)
        .await
        .expect("seed group-library streaming test user");
}

/// Like [`seed_streaming_user_with_library_allow`] but with
/// `Policy::can_download` deliberately left `false` -- the fixture
/// `downloads.rs`'s tests need to prove `ensure_can_download` actually
/// gates every download endpoint even for a caller who otherwise has full
/// Playarr streaming + library access.
pub async fn seed_streaming_user_without_download_access(
    state: &TestState,
    user_id: Uuid,
    library_allow: Vec<Uuid>,
) {
    let policy = Policy {
        id: Uuid::new_v4(),
        name: format!("test-no-download-policy-{user_id}"),
        library_allow,
        group_library_allow: Vec::new(),
        blocked_folders: Vec::new(),
        max_rating: None,
        blocked_tags: Vec::new(),
        allowed_tags: Vec::new(),
        can_transcode: true,
        can_download: false,
        can_delete: false,
        can_share_public: false,
        can_request: false,
        device_allow: Vec::new(),
        max_concurrent_sessions: None,
        household: Default::default(),
        access_schedule: None,
        can_stream: true,
        is_admin: false,
    };
    state
        .policy_repo
        .upsert(&policy)
        .await
        .expect("seed no-download test policy");

    let user = User {
        id: user_id,
        username: format!("test-no-download-{user_id}"),
        display_name: "Test No-Download User".to_string(),
        email: None,
        password_hash: Sensitive::new(playarr_auth::login::hash_password("test-only-password")),
        policy_id: policy.id,
        created_at: Utc::now(),
        disabled: false,
        preferred_audio_language: playarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
    };
    state
        .user_repo
        .upsert(&user)
        .await
        .expect("seed no-download test user");
}

pub fn test_version_gate() -> VersionGateLayer {
    VersionGateLayer::new(
        ClientCompatibilityTable::from_toml_str(
            r#"
[server]
version = "0.1.0"
apiVersion = "1"
"#,
        )
        .unwrap(),
    )
}

/// Opens a fresh, migrated, in-memory SQLite [`DbPool`] private to this
/// call -- same `max_connections(1)` + unique-name-per-call pattern
/// `playarr-catalog`'s own tests use, for the same reason (see that
/// crate's `test_pool` doc comment): SQLite's `:memory:`/`mode=memory`
/// databases are connection-private, so a multi-connection pool (or two
/// tests sharing one name) risks silently reading an empty, unmigrated
/// database.
async fn test_pool() -> DbPool {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let url = format!("sqlite://playarr_api_test_{n}?mode=memory&cache=shared");

    sqlx::any::install_default_drivers();
    let pool: DbPool = sqlx::any::AnyPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("open in-memory sqlite pool");
    playarr_db::run_migrations(&pool, false)
        .await
        .expect("run real embedded sqlite migrations");
    pool
}

pub async fn test_state() -> (Router, TestState) {
    let pool = test_pool().await;

    let live_events = playarr_db::LiveEventPublisher::from_pool(pool.clone());
    let work_repo: Arc<dyn WorkRepo> = Arc::new(playarr_db::EventingWorkRepo::new(
        Arc::new(SqlxWorkRepo::new(pool.clone())),
        live_events.clone(),
    ));
    let device_repo: Arc<dyn DeviceRepo> = Arc::new(SqlxDeviceRepo::new(pool.clone()));
    let rendition_repo: Arc<dyn RenditionRepo> = Arc::new(SqlxRenditionRepo::new(pool.clone()));
    let media_file_repo: Arc<dyn MediaFileRepo> = Arc::new(playarr_db::EventingMediaFileRepo::new(
        Arc::new(SqlxMediaFileRepo::new(pool.clone())),
        live_events.clone(),
    ));
    let source_instance_repo: Arc<dyn SourceInstanceRepo> =
        Arc::new(SqlxSourceInstanceRepo::new(pool.clone()));
    let user_repo: Arc<dyn UserRepo> = Arc::new(SqlxUserRepo::new(pool.clone()));
    let user_invite_repo: Arc<dyn UserInviteRepo> = Arc::new(SqlxUserInviteRepo::new(pool.clone()));
    let user_invite_request_repo: Arc<dyn UserInviteRequestRepo> =
        Arc::new(SqlxUserInviteRequestRepo::new(pool.clone()));
    let push_registration_repo: Arc<dyn PushRegistrationRepo> =
        Arc::new(SqlxPushRegistrationRepo::new(pool.clone()));
    let profile_pin_repo: Arc<dyn ProfilePinRepo> = Arc::new(SqlxProfilePinRepo::new(pool.clone()));
    let household_clock = Arc::new(crate::household::FixedClock::new(Utc::now()));
    let household_repo = Arc::new(playarr_db::SqlxHouseholdRepo::new(pool.clone()));
    let household = Arc::new(crate::household::HouseholdState::new(
        household_repo.clone(),
        household_repo.clone(),
        household_repo,
        household_clock.clone(),
    ));
    let policy_repo: Arc<dyn PolicyRepo> = Arc::new(SqlxPolicyRepo::new(pool.clone()));
    let watch_progress: Arc<dyn WatchProgressRepo> =
        Arc::new(playarr_db::EventingWatchProgressRepo::new(
            Arc::new(SqlxWatchProgressRepo::new(pool.clone())),
            live_events.clone(),
        ));
    let download_tickets: Arc<dyn DownloadTicketRepo> =
        Arc::new(playarr_db::EventingDownloadTicketRepo::new(
            Arc::new(SqlxDownloadTicketRepo::new(pool.clone())),
            live_events.clone(),
        ));
    let library_view_repo: Arc<dyn LibraryViewRepo> =
        Arc::new(SqlxLibraryViewRepo::new(pool.clone()));
    let playlist_repo: Arc<dyn PlaylistRepo> = Arc::new(playarr_db::EventingPlaylistRepo::new(
        Arc::new(SqlxPlaylistRepo::new(pool.clone())),
        live_events.clone(),
    ));
    let watchlist_repo: Arc<dyn playarr_db::repo::WatchlistRepo> =
        Arc::new(playarr_db::EventingWatchlistRepo::new(
            Arc::new(playarr_db::repo::SqlxWatchlistRepo::new(pool.clone())),
            live_events.clone(),
        ));
    let resume_dismissals: Arc<dyn playarr_db::repo::ResumeDismissalRepo> =
        Arc::new(playarr_db::repo::SqlxResumeDismissalRepo::new(pool.clone()));
    let credit_repo: Arc<dyn CreditRepo> = Arc::new(SqlxCreditRepo::new(pool.clone()));
    let tdarr_connection_repo: Arc<dyn TdarrConnectionRepo> =
        Arc::new(SqlxTdarrConnectionRepo::new(pool.clone()));
    let system_settings_repo: Arc<dyn SystemSettingsRepo> =
        Arc::new(SqlxSystemSettingsRepo::new(pool.clone()));
    let node_identity_repo: Arc<dyn NodeIdentityRepo> =
        Arc::new(SqlxNodeIdentityRepo::new(pool.clone()));
    let peer_group_repo: Arc<dyn PeerGroupRepo> = Arc::new(SqlxPeerGroupRepo::new(pool.clone()));
    let peer_node_repo: Arc<dyn PeerNodeRepo> = Arc::new(SqlxPeerNodeRepo::new(pool.clone()));
    let peer_join_token_repo: Arc<dyn PeerJoinTokenRepo> =
        Arc::new(SqlxPeerJoinTokenRepo::new(pool.clone()));
    let group_library_repo: Arc<dyn GroupLibraryRepo> =
        Arc::new(SqlxGroupLibraryRepo::new(pool.clone()));
    let routing_rule_repo: Arc<dyn RoutingRuleRepo> =
        Arc::new(SqlxRoutingRuleRepo::new(pool.clone()));
    let peer_leaf_availability_repo: Arc<dyn PeerLeafAvailabilityRepo> =
        Arc::new(SqlxPeerLeafAvailabilityRepo::new(pool.clone()));
    let peer_source_instance_repo: Arc<dyn playarr_db::PeerSourceInstanceRepo> = Arc::new(
        playarr_db::repo::SqlxPeerSourceInstanceRepo::new(pool.clone()),
    );
    let peer_sync_state_repo: Arc<dyn playarr_db::PeerSyncStateRepo> =
        Arc::new(playarr_db::repo::SqlxPeerSyncStateRepo::new(pool.clone()));
    let sync_conflict_log_repo: Arc<dyn playarr_db::SyncConflictLogRepo> =
        Arc::new(playarr_db::repo::SqlxSyncConflictLogRepo::new(pool.clone()));
    // Real boot parity -- production's `boot_api` seeds the two default
    // views right after migrations run, and test callers that assert on
    // `GET /api/v1/views` (e.g. confirming "Newly Added"/"Newly Released"
    // show up out of the box) need that same seeding to have happened here.
    seed_default_views(library_view_repo.as_ref())
        .await
        .expect("seed default views");
    let analytics_store: Arc<dyn AnalyticsStore> = Arc::new(SqlxAnalyticsStore::new(pool.clone()));
    let session_registry: Arc<dyn SessionRegistry> = Arc::new(InMemorySessionRegistry::new());
    let (analytics_event_tx, _analytics_event_rx) = tokio::sync::mpsc::channel(64);
    let analytics = Arc::new(AnalyticsCollector::new(
        session_registry.clone(),
        analytics_store.clone(),
        analytics_event_tx,
    ));
    let cache: Arc<dyn CacheAndPubSub> = Arc::new(InMemory::new());

    let embedding_repo: Arc<dyn playarr_db::EmbeddingRepo> =
        Arc::new(playarr_db::repo::SqlxEmbeddingRepo::new(pool.clone()));
    let catalog = Arc::new(
        CatalogService::new(
            work_repo.clone(),
            media_file_repo.clone(),
            cache.clone(),
            pool.clone(),
            watch_progress.clone(),
        )
        .with_embedding_repo(embedding_repo.clone())
        .with_media_language_repo(Arc::new(playarr_db::repo::SqlxMediaLanguageRepo::new(
            pool.clone(),
        ))),
    );

    let source_instances = Arc::new(SourceInstanceRegistry::new());

    let transcode = Arc::new(
        TranscodeOrchestrator::new(rendition_repo.clone(), cache, ActiveSessionCounter::new())
            .with_ffmpeg_binary("/usr/bin/true")
            .with_output_root(
                std::env::temp_dir().join(format!("playarr-api-test-{}", Uuid::new_v4())),
            ),
    );

    let jwt = Arc::new(JwtIssuer::new(
        b"test-only-secret-key-at-least-32-bytes!",
        "playarr-test",
        Duration::minutes(15),
    ));
    let refresh_store: Arc<dyn RefreshTokenStore> = Arc::new(InMemoryRefreshTokenStore::new());
    let refresh = Arc::new(RefreshTokenService::new(
        refresh_store,
        device_repo,
        jwt.clone(),
        Duration::days(30),
    ));
    let device_flow: Arc<dyn DeviceFlowHandler> = Arc::new(DashMapDeviceFlowHandler::new(
        Arc::new(InMemoryDeviceAuthorizationStore::new()),
        refresh.clone(),
        DeviceFlowConfig {
            code_ttl: Duration::minutes(10),
            // Zero interval so back-to-back polls in a test don't trip
            // `TokenError::SlowDown` unexpectedly.
            polling_interval: Duration::zero(),
            verification_base_uri: "https://playarr.test/link".to_string(),
            refresh_ttl: Duration::days(30),
        },
    ));

    // Real, `UserRepo`/`PolicyRepo`-backed user/policy wiring -- see
    // `crate::user_directory::RepoBackedUserDirectory` and
    // `crate::auth_extractor::AdminUser`'s doc comments. The seeded
    // `AuthMode::TrustedNetwork` allowlist is deliberately `0.0.0.0/0`
    // (every source IP) so `POST /api/v1/auth/login` tests don't need to
    // fake a specific source address to succeed; tests that specifically
    // exercise the CIDR restriction construct their own `AuthMode` inline
    // instead of using this default.
    let default_policy_id = Uuid::new_v4();
    let default_policy = Policy {
        id: default_policy_id,
        name: "test-default-policy".to_string(),
        library_allow: Vec::new(),
        group_library_allow: Vec::new(),
        blocked_folders: Vec::new(),
        max_rating: None,
        blocked_tags: Vec::new(),
        allowed_tags: Vec::new(),
        can_transcode: true,
        can_download: true,
        can_delete: false,
        can_share_public: false,
        can_request: false,
        device_allow: Vec::new(),
        max_concurrent_sessions: None,
        household: Default::default(),
        access_schedule: None,
        // The default trusted-network auto-login test user stands in for
        // an ordinary Playarr viewer in most tests, so it carries
        // streaming access by default -- see `seed_admin_user` above for
        // the (deliberately non-streaming) admin counterpart.
        can_stream: true,
        is_admin: false,
    };
    policy_repo
        .upsert(&default_policy)
        .await
        .expect("seed default test policy");

    let default_user_id = Uuid::new_v4();
    let default_user = User {
        id: default_user_id,
        username: "test-default".to_string(),
        display_name: "Test Default User".to_string(),
        email: None,
        password_hash: Sensitive::new(playarr_auth::login::hash_password("test-only-password")),
        policy_id: default_policy_id,
        created_at: Utc::now(),
        disabled: false,
        preferred_audio_language: playarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
    };
    user_repo
        .upsert(&default_user)
        .await
        .expect("seed default test user");

    let user_directory: Arc<dyn UserDirectory> =
        Arc::new(RepoBackedUserDirectory::new(user_repo.clone()));
    let admin_registry = Arc::new(InMemoryAdminRegistry::new());
    let auth_mode = Arc::new(playarr_auth::AuthMode::TrustedNetwork {
        allowlist: vec![TrustedNetwork {
            network: "0.0.0.0/0".parse().expect("0.0.0.0/0 is a valid CIDR"),
            auto_login_user_id: default_user_id,
        }],
    });

    let (trigger_tx, trigger_rx) = tokio::sync::mpsc::channel(16);
    let webhook = Arc::new(playarr_arr_sync::WebhookReceiver::new(trigger_tx));

    let media_files = Arc::new(InMemoryMediaFileLookup::new());

    let push_notifications = Arc::new(RecordingPushNotifier::default());
    let app = AppState {
        readiness: ReadinessState::new(),
        version: VersionState {
            envelope: playarr_model::VersionEnvelope {
                instance_name: playarr_model::DEFAULT_INSTANCE_NAME.to_string(),
                server_version: "0.1.0".to_string(),
                api_version: "1".to_string(),
                build_sha: None,
                compatibility: vec![],
            },
        },
        catalog,
        transcode,
        device_flow: device_flow.clone(),
        webhook,
        source_instances: source_instances.clone(),
        source_instance_repo,
        library_view_repo,
        playlist_repo,
        watchlist_repo,
        resume_dismissals,
        discovery_requests_allow_all_users: false,
        work_repo: work_repo.clone(),
        credit_repo,
        tdarr_connection_repo,
        system_settings_repo,
        backup: None,
        media_files: media_files.clone() as Arc<dyn MediaFileLookup>,
        watch_progress,
        download_tickets,
        jwt,
        admin_registry: admin_registry.clone(),
        auth_mode,
        user_directory,
        user_repo: user_repo.clone(),
        user_invite_repo,
        user_invite_request_repo,
        push_registration_repo,
        push_notifier: push_notifications.clone(),
        firebase_web_config: None,
        profile_pin_repo,
        household,
        policy_repo: policy_repo.clone(),
        sessions: refresh,
        refresh_ttl: Duration::days(30),
        node_id: "test-node".to_string(),
        analytics_store,
        session_registry,
        analytics,
        node_identity_repo,
        peer_group_repo,
        peer_node_repo,
        peer_join_token_repo,
        pending_self_peer_profile: Arc::new(std::sync::Mutex::new(None)),
        group_library_repo,
        media_file_repo: media_file_repo.clone(),
        routing_rule_repo,
        peer_leaf_availability_repo,
        peer_source_instance_repo,
        peer_sync_state_repo,
        sync_conflict_log_repo,
        coordinator: Arc::new(playarr_coordination::SingleNodeCoordinator::new()),
        peer_http: reqwest::Client::new(),
        peer_transport_routes: playarr_peer_sync::peer_client::PeerTransportRoutes::default(),
        request_timing: Arc::new(playarr_telemetry::request_timing::RequestTimingRegistry::new()),
        remote_repo: Arc::new(playarr_db::repo::SqlxRemoteRepo::new(pool.clone())),
        live_events,
        calendar_cache: Arc::new(crate::calendar::CalendarCache::new()),
        portability: Arc::new(crate::portability::ExportRegistry::new()),
        availability_event_repo: Arc::new(playarr_db::SqlxAvailabilityEventRepo::new(pool.clone())),
        calendar_feed_token_repo: Arc::new(playarr_db::SqlxCalendarFeedTokenRepo::new(
            pool.clone(),
        )),
    };

    let (router, _api) = build_router(app.clone(), test_version_gate(), None);

    (
        router,
        TestState {
            app,
            source_instances,
            media_files,
            admin_registry,
            user_repo,
            policy_repo,
            pool,
            push_notifications,
            clock: household_clock,
            default_user_id,
            device_flow,
            work_repo,
            media_file_repo,
            embedding_repo,
            rendition_repo,
            _trigger_rx: trigger_rx,
        },
    )
}

pub async fn seed_movie(state: &TestState, title: &str) -> Uuid {
    let work = Work {
        id: Uuid::new_v4(),
        kind: WorkKind::Movie,
        external_refs: vec![],
        title: title.to_string(),
        sort_title: title.to_string(),
        overview: Some(format!("{title} is a test fixture.")),
        images: vec![],
        genres: vec![],
        tags: vec![],
        added_at: Utc::now(),
        release_date: None,
        monitored: true,
        availability: Availability::Available,
    };
    let id = work.id;
    state.work_repo.upsert(&work).await.unwrap();
    id
}

/// Seeds a series `Work` carrying a TVDB external ref.
pub async fn seed_series_with_tvdb(state: &TestState, title: &str, tvdb_id: &str) -> Uuid {
    let work = Work {
        id: Uuid::new_v4(),
        kind: WorkKind::Series,
        external_refs: vec![playarr_model::ExternalRef {
            provider: playarr_model::ExternalProvider::Tvdb,
            external_id: tvdb_id.to_string(),
        }],
        title: title.to_string(),
        sort_title: title.to_string(),
        overview: None,
        images: vec![],
        genres: vec![],
        tags: vec![],
        added_at: Utc::now(),
        release_date: None,
        monitored: true,
        availability: Availability::Pending,
    };
    let id = work.id;
    state.work_repo.upsert(&work).await.unwrap();
    id
}

/// Inserts a `MediaFile` row via the real `MediaFileRepo`, letting a test
/// control which source instance a work's file "belongs" to --
/// `CatalogService::browse`'s `source_instance_id` filter matches on this
/// (`MediaFile::source_instance_id`), not on anything carried by `Work`
/// itself; see `playarr_catalog::BrowseQuery::source_instance_id`'s doc
/// comment for why.
pub async fn seed_media_file(
    state: &TestState,
    work_id: Uuid,
    leaf_ref: playarr_model::media::LeafRef,
    source_instance_id: Uuid,
) -> Uuid {
    let file = playarr_model::MediaFile {
        id: Uuid::new_v4(),
        work_id,
        leaf_ref,
        path: std::path::PathBuf::from("/media/file.mkv"),
        container: "mkv".to_string(),
        codec: "h264".to_string(),
        bitrate: Some(4_000_000),
        duration_ms: Some(3_600_000),
        size_bytes: 123_456,
        source_instance_id,
        source_file_id: Some("1".to_string()),
    };
    let id = file.id;
    state.media_file_repo.create(&file).await.unwrap();
    id
}

/// Like [`seed_media_file`], but also inserts into `state.media_files` (the
/// in-memory [`crate::playback::MediaFileLookup`] every handler actually
/// reads via `AppState::media_files`) and returns the full
/// [`playarr_model::MediaFile`], not just its id. `downloads.rs`'s tests
/// need both: `state.download_tickets` is a real, `SqlxDownloadTicketRepo`-
/// backed repo whose `download_tickets.media_file_id` is a real `REFERENCES
/// media_files (id)` foreign key (so a bare in-memory-only insert would
/// fail `insert`/`find_active` with a real FK violation), while every
/// handler's own `MediaFile` lookup goes through the in-memory
/// `MediaFileLookup`, not `media_file_repo`, directly (so a
/// real-repo-only insert would 404 in the handler itself).
pub async fn seed_downloadable_media_file(
    state: &TestState,
    work_id: Uuid,
    source_instance_id: Uuid,
) -> playarr_model::MediaFile {
    let file = playarr_model::MediaFile {
        id: Uuid::new_v4(),
        work_id,
        leaf_ref: playarr_model::media::LeafRef::Work,
        path: std::path::PathBuf::from("/media/movies/Sample.mkv"),
        container: "mkv".to_string(),
        codec: "h264".to_string(),
        bitrate: Some(8_000_000),
        duration_ms: Some(3_600_000),
        size_bytes: 4_000_000_000,
        source_instance_id,
        source_file_id: Some("1".to_string()),
    };
    state.media_file_repo.create(&file).await.unwrap();
    state.media_files.insert(file.clone());
    file
}

/// Persists a streaming `User` whose `Policy` starts from the same defaults
/// as [`seed_streaming_user`] and is then customised by `configure` --
/// the household/child-control tests' way of building a restricted profile
/// (rating ceiling, schedule, budget, guardians). Returns the saved policy.
pub async fn seed_policy_user(
    state: &TestState,
    user_id: Uuid,
    configure: impl FnOnce(&mut Policy),
) -> Policy {
    let mut policy = Policy {
        id: Uuid::new_v4(),
        name: format!("test-household-policy-{user_id}"),
        library_allow: Vec::new(),
        group_library_allow: Vec::new(),
        blocked_folders: Vec::new(),
        max_rating: None,
        blocked_tags: Vec::new(),
        allowed_tags: Vec::new(),
        can_transcode: true,
        can_download: true,
        can_delete: false,
        can_share_public: false,
        can_request: false,
        device_allow: Vec::new(),
        max_concurrent_sessions: None,
        household: Default::default(),
        access_schedule: None,
        can_stream: true,
        is_admin: false,
    };
    configure(&mut policy);
    state
        .policy_repo
        .upsert(&policy)
        .await
        .expect("seed household test policy");
    let user = User {
        id: user_id,
        username: format!("test-household-{user_id}"),
        display_name: "Household Test User".to_string(),
        email: None,
        password_hash: Sensitive::new(playarr_auth::login::hash_password("test-only-password")),
        policy_id: policy.id,
        created_at: Utc::now(),
        disabled: false,
        preferred_audio_language: playarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
    };
    state
        .user_repo
        .upsert(&user)
        .await
        .expect("seed household test user");
    policy
}

/// Like [`seed_movie`] with explicit tags (e.g. `rating:PG`).
pub async fn seed_movie_with_tags(state: &TestState, title: &str, tags: &[&str]) -> Uuid {
    let work = Work {
        id: Uuid::new_v4(),
        kind: WorkKind::Movie,
        external_refs: vec![],
        title: title.to_string(),
        sort_title: title.to_string(),
        overview: Some(format!("{title} is a test fixture.")),
        images: vec![],
        genres: vec![],
        tags: tags.iter().map(|t| t.to_string()).collect(),
        added_at: Utc::now(),
        release_date: None,
        monitored: true,
        availability: Availability::Available,
    };
    let id = work.id;
    state.work_repo.upsert(&work).await.unwrap();
    id
}
