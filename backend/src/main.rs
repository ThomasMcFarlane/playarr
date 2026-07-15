//! `streamarr` — the combined server binary and maintenance CLI.
//!
//! With no subcommand, boots the server: resolves [`streamarr_config::Config`]
//! from the environment, initializes [`streamarr_telemetry`], connects and
//! migrates the database, and then, depending on `STREAMARR_ROLE`:
//!
//! - `api`/`all`: serves the full Axum router built by
//!   [`streamarr_api::build_router`], with a real [`streamarr_api::AppState`]
//!   behind it (catalog, requests, transcode orchestrator, device-flow auth,
//!   session login, webhook receiver). Every mutating request-management
//!   route requires a verified `Authorization: Bearer <token>` (see
//!   `streamarr_api::auth_extractor`); `auth_mode_from_env`/
//!   `default_admin_user_id_from_env` below resolve this deployment's login
//!   trust tier and default admin identity.
//! - `worker`/`all`: spawns the arr-sync reconciliation pollers (one per
//!   configured `SourceInstance`) and the Tdarr background dispatch loop
//!   (gated by [`streamarr_coordination::ClusterCoordinator`] leader
//!   election, so only one node runs it in a multi-node deployment) as
//!   background tasks. `worker`-only additionally serves a minimal
//!   `/healthz` listener, since it runs no public API router.
//!
//! `update` is a separate maintenance subcommand for checking/applying
//! binary updates out-of-band from a running server.

use std::sync::Arc;
use std::time::Duration;

use clap::{Parser, Subcommand, ValueEnum};
use streamarr_config::{Config, DeploymentTier};
use streamarr_db::DbPool;

const CLIENT_COMPATIBILITY_TOML: &str = include_str!("../config/client-compatibility.toml");

#[derive(Parser)]
#[command(
    name = "streamarr",
    version,
    about = "Streamarr backend server and maintenance CLI"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Run the server. This is the default when no subcommand is given.
    Serve,
    /// Check for, and optionally apply, a Streamarr binary update.
    Update {
        /// Only check for an update and report it; never apply one, even
        /// if `--yes` is also passed.
        #[arg(long)]
        check: bool,
        /// Apply the update non-interactively if one is available. Without
        /// this flag, an available update is reported but not applied.
        #[arg(long)]
        yes: bool,
        #[arg(long, value_enum, default_value_t = UpdateChannel::Stable)]
        channel: UpdateChannel,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum UpdateChannel {
    Stable,
    Beta,
    Nightly,
}

impl std::fmt::Display for UpdateChannel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            UpdateChannel::Stable => "stable",
            UpdateChannel::Beta => "beta",
            UpdateChannel::Nightly => "nightly",
        })
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.command.unwrap_or(Command::Serve) {
        Command::Serve => serve().await,
        Command::Update {
            check,
            yes,
            channel,
        } => update(check, yes, channel).await,
    }
}

async fn serve() -> anyhow::Result<()> {
    let config = Config::from_env()?;
    let _telemetry_guard = streamarr_telemetry::init(&config);

    tracing::info!(
        role = %config.role,
        deployment_tier = ?config.deployment_tier,
        "starting streamarr"
    );

    let pool = connect_and_migrate(&config).await?;
    let coordinator = build_coordinator(&config).await?;
    // Shared across roles so a single `all`-role process's playback
    // decisions (`TranscodeOrchestrator`, in `boot_api`) and background
    // throttle checks (`TdarrDispatcher`, in `boot_worker`) agree on how
    // many on-demand sessions are actually active right now.
    let active_sessions = streamarr_transcode::ActiveSessionCounter::new();
    // Composition-root-owned registry of configured *arr `SourceInstance`s,
    // shared between the API's request-submission/webhook routes and the
    // worker's reconciliation-poller spawner — see
    // `streamarr_api::SourceInstanceRegistry`'s doc comment for why this
    // starts empty (no persistence/admin API for source instance config
    // exists yet anywhere in the workspace).
    let source_instances = Arc::new(streamarr_api::SourceInstanceRegistry::new());

    // `streamarr-telemetry`'s own docs are explicit that `init` above only
    // covers logging -- the /metrics HTTP listener is real, tested code
    // that this composition root is documented as responsible for
    // spawning, and (until now) never actually did: every deployment
    // config (docker-compose, the Helm chart's Service/ServiceMonitor,
    // this file's own metrics_bind_addr) assumed :9090/metrics answers
    // requests, and it silently didn't -- nothing was listening on that
    // port at all. Spawned unconditionally, before the role branch below,
    // since both api and worker roles expose metrics per the Helm chart.
    let metrics_registry = streamarr_telemetry::metrics::MetricsRegistry::new();
    tokio::spawn(spawn_metrics_listener(
        config.metrics_bind_addr,
        metrics_registry,
    ));

    // Spawns background tasks and returns immediately; they keep running
    // for the life of the process regardless of which role served the
    // foreground listener below.
    let _worker_handles = if config.role.runs_worker() {
        boot_worker(
            pool.clone(),
            coordinator,
            source_instances.clone(),
            active_sessions.clone(),
        )
        .await?
    } else {
        Vec::new()
    };

    if config.role.runs_api() {
        boot_api(&config, pool, source_instances, active_sessions).await?;
    } else {
        tracing::info!(
            "role does not run the public API router; serving only a minimal /healthz listener"
        );
        run_minimal_health_listener(&config).await?;
    }

    Ok(())
}

/// Opens the connection pool for `config.database_url` (SQLite or Postgres,
/// auto-detected by `streamarr_db::connect`) and applies the matching
/// embedded migration set.
async fn connect_and_migrate(config: &Config) -> anyhow::Result<DbPool> {
    let pool = streamarr_db::connect(&config.database_url).await?;
    let is_postgres = !matches!(config.deployment_tier, DeploymentTier::SingleNode);
    streamarr_db::run_migrations(&pool, is_postgres).await?;
    Ok(pool)
}

/// Cache + pub/sub backend selection, mirroring
/// `streamarr_config::DeploymentTier`'s own three-way split: in-process for
/// single-node, Postgres `LISTEN`/`NOTIFY` for multi-node-without-Redis,
/// real Redis for the fully horizontally-scaled tier.
async fn build_cache(config: &Config) -> anyhow::Result<Arc<dyn streamarr_cache::CacheAndPubSub>> {
    match config.deployment_tier {
        DeploymentTier::SingleNode => Ok(Arc::new(streamarr_cache::InMemory::new())),
        DeploymentTier::MultiNodePostgresRedis => {
            let redis_url = config
                .redis_url
                .clone()
                .ok_or_else(|| anyhow::anyhow!("REDIS_URL is required for this deployment tier"))?;
            Ok(Arc::new(streamarr_cache::Redis::new(redis_url)))
        }
        DeploymentTier::MultiNodePostgres => {
            let pg_pool = sqlx::postgres::PgPoolOptions::new()
                .connect(&config.database_url)
                .await?;
            Ok(Arc::new(streamarr_cache::PostgresListenNotify::new(
                pg_pool,
            )))
        }
    }
}

/// Coordination backend selection: trivially-always-leader/uncontended
/// locks for single-node, real Postgres advisory locks + a leader heartbeat
/// table for both multi-node tiers (coordination has no Redis path — see
/// `streamarr_coordination`'s own docs).
async fn build_coordinator(
    config: &Config,
) -> anyhow::Result<Arc<dyn streamarr_coordination::ClusterCoordinator>> {
    match config.deployment_tier {
        DeploymentTier::SingleNode => Ok(Arc::new(
            streamarr_coordination::SingleNodeCoordinator::new(),
        )),
        DeploymentTier::MultiNodePostgres | DeploymentTier::MultiNodePostgresRedis => {
            let pg_pool = sqlx::postgres::PgPoolOptions::new()
                .connect(&config.database_url)
                .await?;
            Ok(Arc::new(streamarr_coordination::PostgresCoordinator::new(
                pg_pool,
                uuid::Uuid::new_v4(),
            )))
        }
    }
}

/// Resolves the HS256 secret [`streamarr_auth::JwtIssuer`] signs access
/// tokens with, from `STREAMARR_JWT_SECRET`. Falls back to a secret
/// generated fresh at boot (logged loudly) rather than a hardcoded default
/// -- fine for local/dev use (single-process lifetime), but tokens won't
/// validate across a restart or between nodes in a real deployment without
/// a real, stable, operator-provided secret.
fn jwt_secret_from_env() -> String {
    match std::env::var("STREAMARR_JWT_SECRET") {
        Ok(secret) if secret.len() >= 32 => secret,
        Ok(_) => {
            tracing::warn!(
                "STREAMARR_JWT_SECRET is shorter than the required 32 bytes; ignoring it and \
                 generating a boot-lifetime secret instead"
            );
            generated_dev_jwt_secret()
        }
        Err(_) => {
            tracing::warn!(
                "STREAMARR_JWT_SECRET not set; generating a boot-lifetime secret. Fine for local \
                 development; set STREAMARR_JWT_SECRET explicitly for any deployment where tokens \
                 must survive a restart or be honored across multiple nodes."
            );
            generated_dev_jwt_secret()
        }
    }
}

fn generated_dev_jwt_secret() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// Resolves the id of the single default/admin user a fresh single-node
/// deployment gets, from `STREAMARR_DEFAULT_ADMIN_USER_ID`. Falls back to a
/// boot-lifetime-only generated id, mirroring [`generated_dev_jwt_secret`]'s
/// fallback above -- fine for local/dev use, but every session issued
/// before a restart is orphaned anyway (the in-memory `RefreshTokenStore`/
/// `DeviceAuthorizationStore` don't survive a restart either), so a real
/// deployment that wants a stable admin identity across restarts should set
/// this explicitly.
fn default_admin_user_id_from_env() -> uuid::Uuid {
    match std::env::var("STREAMARR_DEFAULT_ADMIN_USER_ID") {
        Ok(raw) => match uuid::Uuid::parse_str(&raw) {
            Ok(id) => id,
            Err(err) => {
                tracing::warn!(
                    value = %raw,
                    %err,
                    "STREAMARR_DEFAULT_ADMIN_USER_ID is not a valid UUID; generating a \
                     boot-lifetime id instead"
                );
                uuid::Uuid::new_v4()
            }
        },
        Err(_) => {
            tracing::warn!(
                "STREAMARR_DEFAULT_ADMIN_USER_ID not set; generating a boot-lifetime default \
                 admin user id. Set it explicitly for any deployment where the admin identity \
                 must be stable across restarts."
            );
            uuid::Uuid::new_v4()
        }
    }
}

/// Resolves the directory the standalone Web app's built static assets
/// (`index.html` + `assets/`) live in, so `boot_api` can co-host the UI on
/// the same origin/port as the API -- see [`streamarr_api::build_router`]'s
/// `web_assets_dir` doc comment for why that's the goal (parity with how
/// every `*arr` app ships its own UI, rather than requiring a separately
/// hosted web client pointed at this API).
///
/// `STREAMARR_WEB_ASSETS_DIR` wins if set. Otherwise defaults to a `web/`
/// directory next to this binary's own executable (not the process's
/// current working directory, which is unreliable across systemd/Docker/
/// direct-invocation) -- `infra/docker/backend.Dockerfile` copies the built
/// assets there, and a bare-metal/systemd install lays out the release
/// tarball the same way. Returns `None` (API-only, exactly the prior
/// behavior) when neither resolves to a directory actually containing
/// `index.html` -- e.g. a `cargo run` during backend-only development
/// where nobody has run `pnpm run build` for the web app, which must keep
/// working without requiring a web build first.
fn web_assets_dir_from_env() -> Option<std::path::PathBuf> {
    let candidate = match std::env::var("STREAMARR_WEB_ASSETS_DIR") {
        Ok(raw) => std::path::PathBuf::from(raw),
        Err(_) => std::env::current_exe().ok()?.parent()?.join("web"),
    };

    if candidate.join("index.html").is_file() {
        Some(candidate)
    } else {
        tracing::info!(
            path = %candidate.display(),
            "no built web UI found at this path; serving API only. Set STREAMARR_WEB_ASSETS_DIR, \
             or build clients/tv-web/web and place its dist/ output there, to co-host the Web app."
        );
        None
    }
}

/// Resolves the operator's configured login trust tier
/// (`STREAMARR_AUTH_MODE` -- `trusted-network` (the default) or
/// `full-account`) for `POST /api/v1/auth/login`. See
/// [`trusted_network_auth_mode`]'s doc comment for the real security
/// tradeoff the default makes for a fresh deployment.
///
/// `full-account` mode is wired at the type level -- `evaluate_login`
/// fully implements it -- but this pass provisions no user with a known,
/// usable password (there is no user-provisioning tool; the only seeded
/// `User`, `admin_user_id`, gets a random, never-recorded password hash),
/// so flipping to `full-account` today leaves a fresh deployment with no
/// way to log in at all until real `User` persistence and a provisioning
/// path exist. Documented here as a known follow-up gap, not silently
/// papered over.
fn auth_mode_from_env(admin_user_id: uuid::Uuid) -> streamarr_auth::AuthMode {
    use streamarr_auth::AuthMode;

    match std::env::var("STREAMARR_AUTH_MODE") {
        Ok(value) if value == "full-account" => {
            tracing::warn!(
                "STREAMARR_AUTH_MODE=full-account: POST /api/v1/auth/login now requires a \
                 username/password for every login, but no user with a known password is \
                 provisioned in this pass (no UserRepo/admin-provisioning tool exists yet) -- \
                 nobody can log in until one is. Use trusted-network (the default) until real \
                 user provisioning lands."
            );
            AuthMode::FullAccount
        }
        Ok(value) if value == "trusted-network" => trusted_network_auth_mode(admin_user_id),
        Ok(other) => {
            tracing::warn!(
                value = %other,
                "unrecognized STREAMARR_AUTH_MODE (expected trusted-network or full-account); \
                 falling back to trusted-network"
            );
            trusted_network_auth_mode(admin_user_id)
        }
        Err(_) => trusted_network_auth_mode(admin_user_id),
    }
}

/// The RFC 1918 private-address ranges plus loopback -- what "trusted home
/// LAN" actually means. This, not `0.0.0.0/0`, is the default allowlist
/// [`trusted_network_auth_mode`] builds when `STREAMARR_TRUSTED_NETWORK_CIDR`
/// is unset: a request whose source IP is outside every private range (i.e.
/// arrived over the public internet, including through an operator's own
/// unintentional port-forward/UPnP exposure) is *not* auto-logged-in as
/// admin just because it reached the socket.
const DEFAULT_TRUSTED_NETWORK_CIDRS: &[&str] = &[
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "127.0.0.1/32",
    "::1/128",
];

/// Builds the `AuthMode::TrustedNetwork` mode this pass defaults every
/// fresh deployment to: `STREAMARR_TRUSTED_NETWORK_CIDR`, if set, replaces
/// [`DEFAULT_TRUSTED_NETWORK_CIDRS`] with that single custom range; either
/// way, every request whose source IP falls inside the resulting allowlist
/// auto-logs in as `admin_user_id`, with zero credentials.
///
/// **Security implications of the default (RFC 1918 + loopback):** anyone
/// who can reach this server from inside the household/office network --
/// not just from this one machine -- becomes an authenticated admin with
/// zero credentials. That's the correct, zero-setup default for the
/// box-under-your-TV single-node deployment this project is primarily built
/// for, and it deliberately does *not* extend that trust to the public
/// internet the way a `0.0.0.0/0` default would -- a stray port-forward or
/// UPnP mapping should not silently hand out admin to the entire internet.
/// It is still not a substitute for real per-user auth on a shared or
/// untrusted LAN (guest wifi, a dorm/apartment building network, etc):
/// anyone else on that same private range is just as trusted as the
/// operator. For those cases, narrow `STREAMARR_TRUSTED_NETWORK_CIDR` to
/// the actual trusted subnet, switch to `STREAMARR_AUTH_MODE=full-account`
/// (see that mode's own documented gap above), or put a real authenticating
/// reverse proxy in front of it.
fn trusted_network_auth_mode(admin_user_id: uuid::Uuid) -> streamarr_auth::AuthMode {
    use streamarr_auth::{AuthMode, TrustedNetwork};

    let configured_cidr = std::env::var("STREAMARR_TRUSTED_NETWORK_CIDR").ok();
    let cidrs: Vec<String> = match &configured_cidr {
        Some(cidr) => vec![cidr.clone()],
        None => DEFAULT_TRUSTED_NETWORK_CIDRS
            .iter()
            .map(|s| s.to_string())
            .collect(),
    };

    let allowlist: Vec<TrustedNetwork> = cidrs
        .iter()
        .filter_map(|cidr| match cidr.parse() {
            Ok(network) => Some(TrustedNetwork {
                network,
                auto_login_user_id: admin_user_id,
            }),
            Err(_) => {
                tracing::warn!(cidr = %cidr, "invalid CIDR in trusted-network allowlist; skipping it");
                None
            }
        })
        .collect();

    // An empty allowlist (every configured/default CIDR failed to parse)
    // would deny every login attempt outright, including the operator's
    // own -- fail open to the same private-range default rather than
    // leaving a fresh deployment silently unreachable.
    let allowlist = if allowlist.is_empty() {
        tracing::warn!(
            "trusted-network allowlist ended up empty after parsing; falling back to the \
             private-range default so the deployment stays reachable"
        );
        DEFAULT_TRUSTED_NETWORK_CIDRS
            .iter()
            .map(|cidr| TrustedNetwork {
                network: cidr
                    .parse()
                    .expect("DEFAULT_TRUSTED_NETWORK_CIDRS entries are valid CIDRs"),
                auto_login_user_id: admin_user_id,
            })
            .collect()
    } else {
        allowlist
    };

    tracing::warn!(
        cidrs = ?cidrs,
        admin_user_id = %admin_user_id,
        "STREAMARR_AUTH_MODE=trusted-network (the default): every request whose source IP \
         falls inside this allowlist auto-logs in as the default admin user with zero \
         credentials -- see trusted_network_auth_mode's doc comment for the real security \
         implications before exposing this server beyond a genuinely trusted network"
    );

    AuthMode::TrustedNetwork { allowlist }
}

async fn boot_api(
    config: &Config,
    pool: DbPool,
    source_instances: Arc<streamarr_api::SourceInstanceRegistry>,
    active_sessions: streamarr_transcode::ActiveSessionCounter,
) -> anyhow::Result<()> {
    use streamarr_api::{
        build_router, AppState, ClientCompatibilityTable, ReadinessState,
        RepoBackedMediaFileLookup, VersionGateLayer, VersionState,
    };
    use streamarr_auth::{
        DashMapDeviceFlowHandler, DeviceFlowConfig, DeviceFlowHandler, InMemoryAdminRegistry,
        InMemoryDeviceAuthorizationStore, InMemoryRefreshTokenStore, InMemoryUserDirectory,
        JwtIssuer, RefreshTokenService, RefreshTokenStore, UserDirectory,
    };
    use streamarr_db::repo::{SqlxDeviceRepo, SqlxMediaFileRepo, SqlxRenditionRepo, SqlxWorkRepo};
    use streamarr_db::{DeviceRepo, MediaFileRepo, RenditionRepo, WorkRepo};
    use streamarr_model::VersionEnvelope;
    use streamarr_requests::{InMemoryRequestRepo, RequestRepo, RequestService};

    let compatibility_table = ClientCompatibilityTable::from_toml_str(CLIENT_COMPATIBILITY_TOML)?;

    let version_envelope = VersionEnvelope {
        server_version: compatibility_table.server.version.clone(),
        api_version: compatibility_table.server.api_version.clone(),
        build_sha: option_env!("STREAMARR_BUILD_SHA").map(str::to_string),
        // The per-platform compatibility rows aren't projected from
        // `compatibility_table` into `streamarr_model::CompatibilityEntry`
        // yet (that mapping needs the version-code-vs-semver comparison
        // logic `version_gate::evaluate` is also waiting on) — an empty
        // list here is honest about that rather than fabricating entries.
        compatibility: Vec::new(),
    };

    let readiness = ReadinessState::new();

    let cache = build_cache(config).await?;

    let work_repo: Arc<dyn WorkRepo> = Arc::new(SqlxWorkRepo::new(pool.clone()));
    let device_repo: Arc<dyn DeviceRepo> = Arc::new(SqlxDeviceRepo::new(pool.clone()));
    let rendition_repo: Arc<dyn RenditionRepo> = Arc::new(SqlxRenditionRepo::new(pool.clone()));
    let media_file_repo: Arc<dyn MediaFileRepo> = Arc::new(SqlxMediaFileRepo::new(pool.clone()));

    let media_files: Arc<dyn streamarr_api::MediaFileLookup> =
        Arc::new(RepoBackedMediaFileLookup::new(media_file_repo.clone()));

    let catalog = Arc::new(streamarr_catalog::CatalogService::new(
        work_repo,
        media_file_repo,
        cache.clone(),
        pool,
    ));

    let request_repo: Arc<dyn RequestRepo> = Arc::new(InMemoryRequestRepo::new());
    let requests = Arc::new(RequestService::new(
        request_repo.clone(),
        source_instances.clone(),
        Arc::new(streamarr_api::requests::HealthCheckArrPusher::new()),
    ));

    let transcode = Arc::new(
        streamarr_transcode::TranscodeOrchestrator::new(rendition_repo, cache, active_sessions)
            .with_output_root(std::env::temp_dir().join("streamarr-transcode")),
    );

    let jwt_secret = jwt_secret_from_env();
    let jwt = Arc::new(JwtIssuer::new(
        jwt_secret.as_bytes(),
        "streamarr",
        chrono::Duration::minutes(15),
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
            code_ttl: chrono::Duration::minutes(10),
            polling_interval: chrono::Duration::seconds(5),
            verification_base_uri: std::env::var("STREAMARR_DEVICE_VERIFICATION_URI")
                .unwrap_or_else(|_| format!("http://{}/link", config.http_bind_addr)),
            refresh_ttl: chrono::Duration::days(30),
        },
    ));

    // -- Interim admin/policy + login wiring -- see
    // `streamarr_auth::admin` and
    // `streamarr_auth::login::InMemoryUserDirectory`'s doc comments for
    // why these are deliberately small, in-memory stand-ins rather than
    // real `User`/`Policy` persistence, and `auth_mode_from_env`'s doc
    // comment for the real security tradeoff this deployment's default
    // makes.
    let admin_user_id = default_admin_user_id_from_env();
    let admin_user = streamarr_model::User {
        id: admin_user_id,
        username: "admin".to_string(),
        display_name: "Default Admin".to_string(),
        email: None,
        // No real password-based login story exists for this seeded user
        // in this pass -- see `auth_mode_from_env`'s doc comment. The hash
        // is a random, never-recorded value purely so `User::password_hash`
        // holds *something* well-formed, not a real, usable credential.
        password_hash: streamarr_model::Sensitive::new(streamarr_auth::login::hash_password(
            &uuid::Uuid::new_v4().to_string(),
        )),
        policy_id: uuid::Uuid::new_v4(),
        created_at: chrono::Utc::now(),
        disabled: false,
    };
    let user_directory: Arc<dyn UserDirectory> =
        Arc::new(InMemoryUserDirectory::from_users([admin_user]));
    let admin_registry = Arc::new(InMemoryAdminRegistry::from_ids([admin_user_id]));
    let auth_mode = Arc::new(auth_mode_from_env(admin_user_id));

    // TODO: `_webhook_rx` should be handed to the reconciliation pollers
    // `boot_worker` spawns per `SourceInstance`, so a webhook received by
    // this process's API router can fast-path that same process's poller.
    // Wiring that requires `SourceInstanceRegistry` to actually be
    // populated first (see its own doc comment for why it starts empty) —
    // until then this end is simply dropped; `WebhookReceiver::handle`
    // degrades gracefully rather than erroring when its trigger channel has
    // no live receiver (see that method's doc comment).
    let (webhook_tx, _webhook_rx) = tokio::sync::mpsc::channel(256);
    let webhook = Arc::new(streamarr_arr_sync::WebhookReceiver::new(webhook_tx));

    let state = AppState {
        readiness: readiness.clone(),
        version: VersionState {
            envelope: version_envelope,
        },
        catalog,
        requests,
        request_repo,
        transcode,
        device_flow,
        webhook,
        source_instances,
        media_files,
        jwt,
        admin_registry,
        auth_mode,
        user_directory,
        sessions: refresh,
        refresh_ttl: chrono::Duration::days(30),
        node_id: uuid::Uuid::new_v4().to_string(),
    };
    let version_gate = VersionGateLayer::new(compatibility_table);

    let (router, _openapi) = build_router(state, version_gate, web_assets_dir_from_env());

    let listener = tokio::net::TcpListener::bind(config.http_bind_addr).await?;
    tracing::info!(addr = %config.http_bind_addr, "http server listening");

    // Only flip to ready once the listener is actually bound — a readiness
    // probe passing before this point would tell a load balancer to send
    // traffic to a port nothing is listening on yet.
    readiness.set_ready(true);

    // `POST /api/v1/auth/login`'s `AuthMode::TrustedNetwork` tier needs the
    // caller's real source IP (`ConnectInfo`) to decide whether to
    // auto-login -- `into_make_service_with_connect_info` is what actually
    // populates that extractor; plain `axum::serve(listener, router)` would
    // leave it unpopulated and every trusted-network login would 401.
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;
    Ok(())
}

/// Worker-role bootstrap: spawns one `ReconciliationPoller` per configured
/// `SourceInstance` and (when `TDARR_URL` is set) the leader-gated Tdarr
/// background dispatch loop. Returns immediately with the spawned tasks'
/// `JoinHandle`s — callers that don't need to observe completion (`serve`)
/// can drop them; the tasks keep running detached either way.
async fn boot_worker(
    pool: DbPool,
    coordinator: Arc<dyn streamarr_coordination::ClusterCoordinator>,
    source_instances: Arc<streamarr_api::SourceInstanceRegistry>,
    active_sessions: streamarr_transcode::ActiveSessionCounter,
) -> anyhow::Result<Vec<tokio::task::JoinHandle<()>>> {
    use streamarr_arr_sync::{ArrClient, ReconciliationPoller};
    use streamarr_db::repo::{SqlxMediaFileRepo, SqlxRenditionRepo, SqlxWorkRepo};
    use streamarr_db::{MediaFileRepo, RenditionRepo, WorkRepo};
    use streamarr_telemetry::correlation::spawn::spawn_traced;

    let mut handles = Vec::new();

    let work_repo: Arc<dyn WorkRepo> = Arc::new(SqlxWorkRepo::new(pool.clone()));
    let media_file_repo: Arc<dyn MediaFileRepo> = Arc::new(SqlxMediaFileRepo::new(pool.clone()));
    let configured_instances = source_instances.all();
    if configured_instances.is_empty() {
        tracing::info!(
            "no SourceInstance is configured (no persistence/admin API for source instance \
             config exists yet — see streamarr_api::SourceInstanceRegistry's doc comment); \
             arr-sync has nothing to poll until one is registered"
        );
    }
    for instance in configured_instances {
        let arr_client = ArrClient::from_source_instance(&instance);
        // No webhook wired to this specific poller yet (see the TODO in
        // `boot_api`) — an empty, otherwise-unused sender end means this
        // channel only ever sees `Scheduled` reconciliation ticks, never a
        // fast-pathed `Refetch`, until that wiring lands.
        let (_refetch_tx, refetch_rx) = tokio::sync::mpsc::channel(64);
        let poller = ReconciliationPoller::new(
            instance.id,
            instance.kind,
            arr_client,
            Duration::from_secs(300),
            work_repo.clone(),
            media_file_repo.clone(),
            pool.clone(),
            coordinator.clone(),
            refetch_rx,
        );
        let span = tracing::info_span!(
            "arr_sync_poller",
            source_instance_id = %instance.id,
            source_kind = ?instance.kind,
        );
        handles.push(spawn_traced(span, async move {
            if let Err(err) = poller.run().await {
                tracing::error!(%err, "reconciliation poller exited with an error");
            }
        }));
    }

    if let Ok(tdarr_url) = std::env::var("TDARR_URL") {
        let tdarr_api_key = std::env::var("TDARR_API_KEY").unwrap_or_default();
        let rendition_repo: Arc<dyn RenditionRepo> = Arc::new(SqlxRenditionRepo::new(pool));
        let tdarr = streamarr_tdarr_client::TdarrClient::new(tdarr_url, tdarr_api_key);
        // TODO: nothing produces `MediaFileImportEvent`s yet (no
        // `MediaFileRepo`/import pipeline — see `streamarr-transcode`'s own
        // docs on `MediaFileImportEvent`); dropping `_events_tx` means this
        // dispatcher only ever runs its real throttle-check loop against
        // Tdarr's live API, never the per-import dispatch path, until that
        // pipeline exists.
        let (_events_tx, events_rx) = tokio::sync::mpsc::channel(64);
        let dispatcher = streamarr_transcode::TdarrDispatcher::new(
            tdarr,
            rendition_repo,
            active_sessions,
            events_rx,
            streamarr_transcode::TdarrDispatcherConfig {
                tdarr_db_id: std::env::var("TDARR_DB_ID")
                    .unwrap_or_else(|_| "streamarr".to_string()),
                default_profile: "h264-720p-4mbps".to_string(),
                worker_process: "transcodecpu".to_string(),
                default_worker_limit: 2,
                throttled_worker_limit: 0,
                active_session_threshold: 2,
                throttle_check_interval: Duration::from_secs(30),
            },
        );
        handles.push(tokio::spawn(run_while_leader(
            coordinator,
            "transcode-dispatcher",
            Duration::from_secs(30),
            async move {
                if let Err(err) = dispatcher.run().await {
                    tracing::error!(%err, "tdarr dispatcher exited with an error");
                }
            },
        )));
    } else {
        tracing::info!("TDARR_URL not set; skipping the background Tdarr dispatch loop");
    }

    Ok(handles)
}

/// Runs `task` only once this node has won leadership of `role` via
/// `coordinator`, then keeps renewing that lease every `ttl / 2` until
/// `task` completes. `SingleNodeCoordinator` (the systemd/single-node tier)
/// makes the campaign step trivially and permanently succeed, so `task`
/// starts immediately there — this is the "gate the reconciliation/dispatch
/// loops so only one node runs them" mechanism the multi-node
/// `PostgresCoordinator` tier depends on for real.
///
/// TODO(graceful-handoff): if renewal ever reports leadership lost mid-run
/// (a real possibility only under `PostgresCoordinator`, e.g. this node
/// stalled past the lease TTL and another node's campaign won), this only
/// logs loudly — it does not abort/hand off `task`, since neither
/// `TdarrDispatcher` nor `ReconciliationPoller` currently accept an
/// external cancellation signal to drain against. Threading one through is
/// future work; today's fallback (two nodes briefly both driving the same
/// loop until the stalled one's `task` naturally completes or the process
/// restarts) is safe for both loops' idempotent, upsert-shaped operations,
/// just not maximally clean.
async fn run_while_leader<Fut>(
    coordinator: Arc<dyn streamarr_coordination::ClusterCoordinator>,
    role: &'static str,
    ttl: Duration,
    task: Fut,
) where
    Fut: std::future::Future<Output = ()> + Send + 'static,
{
    loop {
        match coordinator.campaign_leader(role, ttl).await {
            Ok(true) => break,
            Ok(false) => tracing::debug!(role, "not leader for this role yet; retrying"),
            Err(err) => tracing::warn!(role, %err, "leadership campaign failed; retrying"),
        }
        tokio::time::sleep(ttl / 2).await;
    }
    tracing::info!(role, "acquired leadership; starting leader-gated task");

    let renewal_coordinator = coordinator.clone();
    let renewal = tokio::spawn(async move {
        let mut interval = tokio::time::interval(ttl / 2);
        interval.tick().await; // the first tick fires immediately; we just campaigned.
        loop {
            interval.tick().await;
            match renewal_coordinator.renew_leadership(role, ttl).await {
                Ok(true) => {}
                Ok(false) => tracing::warn!(
                    role,
                    "lost leadership on renewal; task keeps running -- see \
                     run_while_leader's doc comment for the deferred graceful-handoff TODO"
                ),
                Err(err) => tracing::warn!(role, %err, "leadership renewal errored"),
            }
        }
    });

    task.await;
    renewal.abort();
}

/// Binds `streamarr_telemetry::metrics::http::router` (the real, tested
/// `/metrics` Prometheus-exposition-format handler that crate ships but
/// never wires up itself) to `metrics_bind_addr`, on its own listener
/// separate from the public API port -- so it can be firewalled off from
/// public-facing ingress without needing auth middleware of its own,
/// matching every deployment tier's existing assumption that this port is
/// a private/internal one (see infra/kubernetes/helm/streamarr/values.yaml's
/// `metricsPort`, never exposed via an Ingress). Logged, not propagated
/// via `?`, since this runs detached via `tokio::spawn` -- a failure here
/// (e.g. the port already in use) shouldn't take the whole process down
/// when the public API/worker loops are otherwise healthy, but it must be
/// loud, not silent, since a metrics outage is still a real operational
/// problem worth seeing in the logs.
async fn spawn_metrics_listener(
    metrics_bind_addr: std::net::SocketAddr,
    registry: streamarr_telemetry::metrics::MetricsRegistry,
) {
    let router = streamarr_telemetry::metrics::http::router(registry);
    let listener = match tokio::net::TcpListener::bind(metrics_bind_addr).await {
        Ok(listener) => listener,
        Err(err) => {
            tracing::error!(addr = %metrics_bind_addr, error = %err, "failed to bind metrics listener");
            return;
        }
    };
    tracing::info!(addr = %metrics_bind_addr, "metrics listener listening");
    if let Err(err) = axum::serve(listener, router).await {
        tracing::error!(addr = %metrics_bind_addr, error = %err, "metrics listener exited");
    }
}

/// Worker-only role: no public API router, but still a real HTTP listener
/// (`GET /healthz`) so a process supervisor/orchestrator has something to
/// probe rather than only inferring liveness from the process existing.
async fn run_minimal_health_listener(config: &Config) -> anyhow::Result<()> {
    let router = axum::Router::new().route(
        "/healthz",
        axum::routing::get(|| async { axum::http::StatusCode::OK }),
    );
    let listener = tokio::net::TcpListener::bind(config.http_bind_addr).await?;
    tracing::info!(addr = %config.http_bind_addr, "worker-only minimal health listener listening");
    axum::serve(listener, router).await?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum UpdateCheckOutcome {
    UpToDate {
        current_version: String,
    },
    UpdateAvailable {
        current_version: String,
        latest_version: String,
    },
}

async fn update(check: bool, yes: bool, channel: UpdateChannel) -> anyhow::Result<()> {
    let outcome = check_for_update(channel).await?;

    match outcome {
        UpdateCheckOutcome::UpToDate { current_version } => {
            println!("streamarr {current_version} is up to date ({channel} channel)");
        }
        UpdateCheckOutcome::UpdateAvailable {
            current_version,
            latest_version,
        } => {
            println!("update available: {current_version} -> {latest_version} ({channel} channel)");

            if check {
                return Ok(());
            }
            if !yes {
                println!("re-run with --yes to apply, or --check to only check");
                return Ok(());
            }

            apply_update(&latest_version).await?;
        }
    }

    Ok(())
}

/// Checks the configured release channel's feed for a build newer than the
/// one currently running. The network call itself is stubbed — this
/// always reports up to date — but the function is real: a real return
/// type, a real caller in [`update`], and a real current-version read from
/// the compiled-in `CARGO_PKG_VERSION`. Wiring the actual HTTP call
/// against the release feed is a follow-up that fills in this function's
/// body, not one that changes its signature or how `update` calls it.
async fn check_for_update(channel: UpdateChannel) -> anyhow::Result<UpdateCheckOutcome> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let _ = channel; // will select the release feed URL once that call is wired in

    // let feed_url = release_feed_url(channel);
    // let latest: ReleaseInfo = reqwest::get(feed_url).await?.json().await?;
    // return Ok(if latest.version > current_version { ... } else { ... });

    Ok(UpdateCheckOutcome::UpToDate { current_version })
}

/// Applies a downloaded update. Not implemented — the intended sequence,
/// left here so the shape of the work is clear before anyone picks it up:
///
/// 1. Download the release artifact and its cosign signature for
///    `target_version` from the release feed.
/// 2. `cosign verify-blob --key <streamarr-release-pubkey> --signature
///    <sig.file> <artifact>` — refuse to proceed at all if verification
///    fails; a failed signature check is not a retryable error.
/// 3. Write the verified artifact to a staging path on the *same*
///    filesystem as the running binary, so the final swap can be an atomic
///    rename rather than a copy.
/// 4. Drain: flip readiness to not-ready (stop new traffic being routed
///    here) and let in-flight HTTP requests and active playback sessions
///    finish, up to a grace deadline, before touching the binary on disk.
/// 5. Atomically rename the staged binary over the current one
///    (`rename(2)` within one filesystem is atomic — there is no window
///    where the path points at a partially-written file) and re-exec.
async fn apply_update(target_version: &str) -> anyhow::Result<()> {
    anyhow::bail!(
        "streamarr update --yes is not implemented yet (would update to {target_version})"
    );
}
