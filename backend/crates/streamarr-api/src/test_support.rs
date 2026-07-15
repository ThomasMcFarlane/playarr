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
use streamarr_auth::{
    DashMapDeviceFlowHandler, DeviceFlowConfig, DeviceFlowHandler, InMemoryAdminRegistry,
    InMemoryDeviceAuthorizationStore, InMemoryRefreshTokenStore, InMemoryUserDirectory, JwtIssuer,
    RefreshTokenService, RefreshTokenStore, TrustedNetwork, UserDirectory,
};
use streamarr_cache::{CacheAndPubSub, InMemory};
use streamarr_catalog::CatalogService;
use streamarr_db::repo::{SqlxDeviceRepo, SqlxMediaFileRepo, SqlxRenditionRepo, SqlxWorkRepo};
use streamarr_db::{DbPool, DeviceRepo, MediaFileRepo, RenditionRepo, WorkRepo};
use streamarr_model::{Availability, Sensitive, User, Work, WorkKind};
use streamarr_requests::{InMemoryRequestRepo, RequestRepo, RequestService};
use streamarr_transcode::{ActiveSessionCounter, TranscodeOrchestrator};
use uuid::Uuid;

use crate::playback::{InMemoryMediaFileLookup, MediaFileLookup};
use crate::requests::HealthCheckArrPusher;
use crate::source_registry::SourceInstanceRegistry;
use crate::version::VersionState;
use crate::version_gate::{ClientCompatibilityTable, VersionGateLayer};
use crate::{build_router, AppState, ReadinessState};

pub struct TestState {
    pub app: AppState,
    pub source_instances: Arc<SourceInstanceRegistry>,
    pub media_files: Arc<InMemoryMediaFileLookup>,
    pub device_flow: Arc<dyn DeviceFlowHandler>,
    pub work_repo: Arc<dyn WorkRepo>,
    pub media_file_repo: Arc<dyn MediaFileRepo>,
    /// Same `InMemoryAdminRegistry` `app.admin_registry` wraps, exposed here
    /// as its concrete type (rather than only reachable through `app`) so
    /// tests can call [`InMemoryAdminRegistry::add`] to mint an admin
    /// caller for approve/reject-as-admin test cases.
    pub admin_registry: Arc<InMemoryAdminRegistry>,
    /// The id of the one `User` seeded into `app.user_directory` and bound
    /// to `app.auth_mode`'s trusted-network auto-login -- what
    /// `POST /api/v1/auth/login` resolves to for any source IP in tests
    /// (the seeded `AuthMode::TrustedNetwork` allowlist is `0.0.0.0/0`).
    pub default_user_id: Uuid,
    /// Kept alive for `TestState`'s lifetime so `WebhookReceiver::handle`'s
    /// `try_send` has a live receiver to enqueue onto, mirroring how a real
    /// deployment's reconciliation poller holds the other end open. Never
    /// read directly by tests -- see [`crate::AppState::webhook`].
    _trigger_rx: tokio::sync::mpsc::Receiver<streamarr_arr_sync::RefetchRequest>,
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

fn test_version_gate() -> VersionGateLayer {
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
/// `streamarr-catalog`'s own tests use, for the same reason (see that
/// crate's `test_pool` doc comment): SQLite's `:memory:`/`mode=memory`
/// databases are connection-private, so a multi-connection pool (or two
/// tests sharing one name) risks silently reading an empty, unmigrated
/// database.
async fn test_pool() -> DbPool {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let url = format!("sqlite://streamarr_api_test_{n}?mode=memory&cache=shared");

    sqlx::any::install_default_drivers();
    let pool: DbPool = sqlx::any::AnyPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("open in-memory sqlite pool");
    streamarr_db::run_migrations(&pool, false)
        .await
        .expect("run real embedded sqlite migrations");
    pool
}

pub async fn test_state() -> (Router, TestState) {
    let pool = test_pool().await;

    let work_repo: Arc<dyn WorkRepo> = Arc::new(SqlxWorkRepo::new(pool.clone()));
    let device_repo: Arc<dyn DeviceRepo> = Arc::new(SqlxDeviceRepo::new(pool.clone()));
    let rendition_repo: Arc<dyn RenditionRepo> = Arc::new(SqlxRenditionRepo::new(pool.clone()));
    let media_file_repo: Arc<dyn MediaFileRepo> = Arc::new(SqlxMediaFileRepo::new(pool.clone()));
    let cache: Arc<dyn CacheAndPubSub> = Arc::new(InMemory::new());

    let catalog = Arc::new(CatalogService::new(
        work_repo.clone(),
        media_file_repo.clone(),
        cache.clone(),
        pool,
    ));

    let request_repo: Arc<dyn RequestRepo> = Arc::new(InMemoryRequestRepo::new());
    let source_instances = Arc::new(SourceInstanceRegistry::new());
    let requests = Arc::new(RequestService::new(
        request_repo.clone(),
        source_instances.clone(),
        Arc::new(HealthCheckArrPusher::new()),
    ));

    let transcode = Arc::new(
        TranscodeOrchestrator::new(rendition_repo, cache, ActiveSessionCounter::new())
            .with_ffmpeg_binary("/usr/bin/true")
            .with_output_root(
                std::env::temp_dir().join(format!("streamarr-api-test-{}", Uuid::new_v4())),
            ),
    );

    let jwt = Arc::new(JwtIssuer::new(
        b"test-only-secret-key-at-least-32-bytes!",
        "streamarr-test",
        Duration::minutes(15),
    ));
    let refresh_store: Arc<dyn RefreshTokenStore> = Arc::new(InMemoryRefreshTokenStore::new());
    let refresh = Arc::new(RefreshTokenService::new(
        refresh_store,
        device_repo,
        jwt.clone(),
    ));
    let device_flow: Arc<dyn DeviceFlowHandler> = Arc::new(DashMapDeviceFlowHandler::new(
        Arc::new(InMemoryDeviceAuthorizationStore::new()),
        refresh.clone(),
        DeviceFlowConfig {
            code_ttl: Duration::minutes(10),
            // Zero interval so back-to-back polls in a test don't trip
            // `TokenError::SlowDown` unexpectedly.
            polling_interval: Duration::zero(),
            verification_base_uri: "https://streamarr.test/link".to_string(),
            refresh_ttl: Duration::days(30),
        },
    ));

    // Interim admin/policy + login wiring -- see `streamarr_auth::admin`
    // and `streamarr_auth::login::InMemoryUserDirectory`'s doc comments.
    // The seeded `AuthMode::TrustedNetwork` allowlist is deliberately
    // `0.0.0.0/0` (every source IP) so `POST /api/v1/auth/login` tests
    // don't need to fake a specific source address to succeed; tests that
    // specifically exercise the CIDR restriction construct their own
    // `AuthMode` inline instead of using this default.
    let default_user_id = Uuid::new_v4();
    let default_user = User {
        id: default_user_id,
        username: "test-default".to_string(),
        display_name: "Test Default User".to_string(),
        email: None,
        password_hash: Sensitive::new(streamarr_auth::login::hash_password("test-only-password")),
        policy_id: Uuid::new_v4(),
        created_at: Utc::now(),
        disabled: false,
    };
    let user_directory: Arc<dyn UserDirectory> =
        Arc::new(InMemoryUserDirectory::from_users([default_user]));
    let admin_registry = Arc::new(InMemoryAdminRegistry::new());
    let auth_mode = Arc::new(streamarr_auth::AuthMode::TrustedNetwork {
        allowlist: vec![TrustedNetwork {
            network: "0.0.0.0/0".parse().expect("0.0.0.0/0 is a valid CIDR"),
            auto_login_user_id: default_user_id,
        }],
    });

    let (trigger_tx, trigger_rx) = tokio::sync::mpsc::channel(16);
    let webhook = Arc::new(streamarr_arr_sync::WebhookReceiver::new(trigger_tx));

    let media_files = Arc::new(InMemoryMediaFileLookup::new());

    let app = AppState {
        readiness: ReadinessState::new(),
        version: VersionState {
            envelope: streamarr_model::VersionEnvelope {
                server_version: "0.1.0".to_string(),
                api_version: "1".to_string(),
                build_sha: None,
                compatibility: vec![],
            },
        },
        catalog,
        requests,
        request_repo,
        transcode,
        device_flow: device_flow.clone(),
        webhook,
        source_instances: source_instances.clone(),
        media_files: media_files.clone() as Arc<dyn MediaFileLookup>,
        jwt,
        admin_registry: admin_registry.clone(),
        auth_mode,
        user_directory,
        sessions: refresh,
        refresh_ttl: Duration::days(30),
        node_id: "test-node".to_string(),
    };

    let (router, _api) = build_router(app.clone(), test_version_gate());

    (
        router,
        TestState {
            app,
            source_instances,
            media_files,
            admin_registry,
            default_user_id,
            device_flow,
            work_repo,
            media_file_repo,
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
        monitored: true,
        availability: Availability::Available,
    };
    let id = work.id;
    state.work_repo.upsert(&work).await.unwrap();
    id
}
