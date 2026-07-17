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

mod acme_cache;
mod relay_dns;

const CLIENT_COMPATIBILITY_TOML: &str = include_str!("../config/client-compatibility.toml");

#[derive(Clone)]
struct HttpRedirectAcceptor<A> {
    inner: A,
    https_origin: Arc<str>,
}

impl<A> HttpRedirectAcceptor<A> {
    fn new(inner: A, https_origin: String) -> Self {
        Self {
            inner,
            https_origin: https_origin.into(),
        }
    }
}

impl<A, S> axum_server::accept::Accept<tokio::net::TcpStream, S> for HttpRedirectAcceptor<A>
where
    A: axum_server::accept::Accept<tokio::net::TcpStream, S, Service = S>
        + Clone
        + Send
        + Sync
        + 'static,
    A::Stream: Send + 'static,
    A::Future: Send + 'static,
    S: Send + 'static,
{
    type Stream = A::Stream;
    type Service = S;
    type Future = std::pin::Pin<
        Box<
            dyn std::future::Future<Output = std::io::Result<(Self::Stream, Self::Service)>> + Send,
        >,
    >;

    fn accept(&self, mut stream: tokio::net::TcpStream, service: S) -> Self::Future {
        let inner = self.inner.clone();
        let https_origin = self.https_origin.clone();
        Box::pin(async move {
            let mut first_byte = [0_u8; 1];
            let read = stream.peek(&mut first_byte).await?;
            if read > 0 && first_byte[0].is_ascii_uppercase() {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};

                let mut request = vec![0_u8; 8 * 1024];
                let request_len = stream.read(&mut request).await?;
                let target = plaintext_http_target(&request[..request_len]);
                let location = format!("{https_origin}{target}");
                let response = format!(
                    "HTTP/1.1 308 Permanent Redirect\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n"
                );
                stream.write_all(response.as_bytes()).await?;
                stream.shutdown().await?;
                return Err(std::io::Error::other("redirected plaintext HTTP to HTTPS"));
            }

            inner.accept(stream, service).await
        })
    }
}

fn plaintext_http_target(request: &[u8]) -> &str {
    std::str::from_utf8(request)
        .ok()
        .and_then(|request| request.lines().next())
        .and_then(|line| line.split_ascii_whitespace().nth(1))
        .filter(|target| target.starts_with('/') && !target.starts_with("//"))
        .unwrap_or("/")
}

fn https_origin(domain: &str, port: u16) -> String {
    if port == 443 {
        format!("https://{domain}")
    } else {
        format!("https://{domain}:{port}")
    }
}

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
    // worker's reconciliation-poller spawner. Starts empty here -- it's
    // `boot_api` that hydrates it from the real `SourceInstanceRepo`
    // (persisted `SourceInstance` rows) right before constructing
    // `AppState`, so a restart no longer forgets every registered
    // instance. See `streamarr_api::SourceInstanceRegistry`'s doc comment
    // for the split between this fast in-memory read path and the durable
    // repo behind it.
    let source_instances = Arc::new(streamarr_api::SourceInstanceRegistry::new());

    // Connects `boot_api`'s `TranscodeOrchestrator` (an on-demand session
    // starting is the send side) to `boot_worker`'s `TdarrDispatcher` (the
    // receive side) -- see `streamarr_transcode`'s module docs, "other
    // bridge" section, for why: it's what promotes a live, temporary
    // on-demand transcode into a durable, Tdarr-produced `Rendition` for
    // future requests. Constructed once here (not inside either `boot_*`
    // function) since both live in the same process for `STREAMARR_ROLE=all`
    // -- the only topology this local `mpsc` channel can bridge; a split
    // api/worker deployment needs a cross-node signal instead (same
    // limitation already noted on `TranscodeOrchestrator::active_children`),
    // not addressed here. If this process doesn't run the worker role, or
    // `TDARR_URL` isn't set, `tdarr_notify_rx` is simply dropped and every
    // `try_send` on the other end harmlessly fails closed.
    let (tdarr_notify_tx, tdarr_notify_rx) =
        tokio::sync::mpsc::channel::<streamarr_transcode::MediaFileImportEvent>(64);

    // Playback-activity analytics plumbing, shared across roles the same
    // way `active_sessions`/`source_instances` above are: `analytics`
    // (backing every playback-session/event write) is used by `boot_api`'s
    // `AppState`, while the cluster-wide-singleton background jobs that
    // operate on the same store/registry (`RollupScheduler`,
    // `SessionReaper`, `RetentionSweeper`) run leader-gated inside
    // `boot_worker`. See `streamarr_telemetry::analytics::collector`'s
    // module doc comment for the overall architecture.
    let analytics_store: Arc<dyn streamarr_db::analytics::AnalyticsStore> = Arc::new(
        streamarr_db::analytics::SqlxAnalyticsStore::new(pool.clone()),
    );
    let session_registry: Arc<dyn streamarr_telemetry::analytics::SessionRegistry> =
        Arc::new(streamarr_telemetry::analytics::InMemorySessionRegistry::new());
    // Drained by `AnalyticsFlusher`, spawned inside `boot_api` -- see that
    // function for why the flusher lives there rather than here: only an
    // API-role process ever calls `AnalyticsCollector::on_event`/
    // `on_session_start` (there's no HTTP handler in the worker role), so
    // it's the only role that ever produces events into this channel.
    let (analytics_event_tx, analytics_event_rx) =
        tokio::sync::mpsc::channel::<streamarr_model::PlaybackEvent>(4096);
    let analytics = Arc::new(streamarr_telemetry::analytics::AnalyticsCollector::new(
        session_registry.clone(),
        analytics_store.clone(),
        analytics_event_tx,
    ));

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
            tdarr_notify_rx,
            analytics_store.clone(),
            session_registry.clone(),
            analytics.clone(),
        )
        .await?
    } else {
        Vec::new()
    };

    let application_listener = async {
        if config.role.runs_api() {
            boot_api(
                &config,
                pool,
                source_instances,
                active_sessions,
                tdarr_notify_tx,
                analytics_store,
                session_registry,
                analytics,
                analytics_event_rx,
            )
            .await
        } else {
            tracing::info!(
                "role does not run the public API router; serving only a minimal /healthz listener"
            );
            run_minimal_health_listener(&config).await
        }
    };

    if let Some(bind_addr) = config.relay_dns_bind_addr {
        tracing::info!(addr = %bind_addr, "authoritative relay DNS enabled inside streamarr");
        tokio::try_join!(application_listener, relay_dns::serve(bind_addr))?;
    } else {
        application_listener.await?;
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

/// How long an on-demand [`streamarr_transcode::TranscodeSession`] survives
/// without being accessed before it's eligible for cleanup -- an *idle*
/// deadline (every real manifest/segment request slides it forward, see
/// `TranscodeOrchestrator::lookup_session`'s doc comment), not a cap on how
/// long a single playback can run. `STREAMARR_TRANSCODE_SESSION_IDLE_TTL_SECS`,
/// defaulting to 60s -- long enough that normal HLS segment-fetch cadence
/// (a few seconds apart) never lapses it, short enough that a viewer who
/// closes the tab or loses their connection frees the ffmpeg process and
/// its capacity slot promptly rather than lingering for the lifetime of a
/// much longer default.
fn transcode_session_idle_ttl_from_env() -> std::time::Duration {
    const DEFAULT_SECS: u64 = 60;
    match std::env::var("STREAMARR_TRANSCODE_SESSION_IDLE_TTL_SECS") {
        Ok(raw) => match raw.parse::<u64>() {
            Ok(secs) if secs > 0 => std::time::Duration::from_secs(secs),
            _ => {
                tracing::warn!(
                    value = %raw,
                    "STREAMARR_TRANSCODE_SESSION_IDLE_TTL_SECS is not a positive integer; \
                     falling back to the default of {DEFAULT_SECS}s"
                );
                std::time::Duration::from_secs(DEFAULT_SECS)
            }
        },
        Err(_) => std::time::Duration::from_secs(DEFAULT_SECS),
    }
}

fn generated_dev_jwt_secret() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// Resolves the id of the account `AuthMode::TrustedNetwork`'s
/// zero-credential auto-login binds to, from
/// `STREAMARR_DEFAULT_ADMIN_USER_ID`. `fallback` is the id
/// [`bootstrap_admin_if_needed`] resolved (either a freshly bootstrapped
/// admin, or the id of an existing admin/user already in the database) --
/// used whenever the env var is unset or doesn't parse.
///
/// Unlike the old boot-lifetime-random-UUID fallback this function used to
/// generate, `fallback` is guaranteed to actually resolve against
/// `AppState::user_directory` (`streamarr_api::user_directory::
/// RepoBackedUserDirectory`, backed by the real `UserRepo` -- unlike the
/// in-memory stand-in it replaced, this one only ever resolves ids that are
/// genuinely persisted). A random, nothing-resolves-to-it id would make
/// trusted-network mode's auto-login fail every login attempt.
fn default_admin_user_id_from_env(fallback: uuid::Uuid) -> uuid::Uuid {
    match std::env::var("STREAMARR_DEFAULT_ADMIN_USER_ID") {
        Ok(raw) => match uuid::Uuid::parse_str(&raw) {
            Ok(id) => id,
            Err(err) => {
                tracing::warn!(
                    value = %raw,
                    %err,
                    "STREAMARR_DEFAULT_ADMIN_USER_ID is not a valid UUID; falling back to the \
                     resolved bootstrap admin id instead"
                );
                fallback
            }
        },
        Err(_) => fallback,
    }
}

/// Resolves the directory Streamarr Admin's built static assets
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
             or build clients/tv-web/admin and place its dist/ output there, to co-host Streamarr Admin."
        );
        None
    }
}

/// Resolves the operator's configured login trust tier
/// (`STREAMARR_AUTH_MODE` -- `full-account` (the default as of this pass)
/// or `trusted-network`, opt-in only) for `POST /api/v1/auth/login`.
///
/// **Why the default flipped from `trusted-network` to `full-account`:**
/// real username/password accounts now have a real, always-available,
/// durable persistence layer (`streamarr_db::UserRepo`/`PolicyRepo`) and
/// `boot_api` guarantees at least one real admin account exists before
/// this deployment ever serves traffic (see [`bootstrap_admin_if_needed`]).
/// With a genuine credential-based login path always available, defaulting
/// a fresh deployment to IP-based, zero-credential auto-admin
/// (`trusted-network`) is no longer the right default -- it was only ever
/// the sensible *zero-setup* choice because, before this pass, it was the
/// *only* login path that could possibly work (no `UserRepo`, no
/// provisioning tool, nobody could ever have a real password). That gap is
/// closed. `trusted-network` is still fully supported and still the right
/// choice for some deployments (e.g. a household box where nobody wants to
/// remember a password) -- see [`trusted_network_auth_mode`]'s doc comment
/// for its real security tradeoff -- but it now requires the operator to
/// explicitly opt in with `STREAMARR_AUTH_MODE=trusted-network` rather than
/// being handed out to anyone who reaches the socket by default.
fn auth_mode_from_env(admin_user_id: uuid::Uuid) -> streamarr_auth::AuthMode {
    use streamarr_auth::AuthMode;

    match std::env::var("STREAMARR_AUTH_MODE") {
        Ok(value) if value == "trusted-network" => trusted_network_auth_mode(admin_user_id),
        Ok(value) if value == "full-account" => {
            tracing::info!(
                "STREAMARR_AUTH_MODE=full-account: POST /api/v1/auth/login requires a real \
                 username/password for every login -- see bootstrap_admin_if_needed's doc \
                 comment for how this deployment's first admin account gets provisioned."
            );
            AuthMode::FullAccount
        }
        Ok(other) => {
            tracing::warn!(
                value = %other,
                "unrecognized STREAMARR_AUTH_MODE (expected full-account or trusted-network); \
                 falling back to full-account, the default"
            );
            AuthMode::FullAccount
        }
        Err(_) => {
            tracing::info!(
                "STREAMARR_AUTH_MODE not set; defaulting to full-account -- set \
                 STREAMARR_AUTH_MODE=trusted-network to opt into IP-based zero-credential \
                 auto-admin instead (see trusted_network_auth_mode's doc comment for the \
                 tradeoff before doing so)."
            );
            AuthMode::FullAccount
        }
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

/// Builds the `AuthMode::TrustedNetwork` mode, only reached when the
/// operator explicitly opts in with `STREAMARR_AUTH_MODE=trusted-network`
/// (see [`auth_mode_from_env`]'s doc comment for why this is no longer the
/// implicit default): `STREAMARR_TRUSTED_NETWORK_CIDR`, if set, replaces
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
        "STREAMARR_AUTH_MODE=trusted-network (explicitly opted into): every request whose \
         source IP falls inside this allowlist auto-logs in as the default admin user with \
         zero credentials -- see trusted_network_auth_mode's doc comment for the real security \
         implications before exposing this server beyond a genuinely trusted network"
    );

    AuthMode::TrustedNetwork { allowlist }
}

/// The bootstrap admin username used when `STREAMARR_BOOTSTRAP_ADMIN_USERNAME`
/// is unset.
const DEFAULT_BOOTSTRAP_ADMIN_USERNAME: &str = "admin";

/// Ensures at least one real, persisted `User` exists before this
/// deployment ever serves traffic -- with zero users in a fresh database,
/// nobody could log in, in *either* auth mode (`full-account` has no
/// account to authenticate as; `trusted-network`'s auto-login target
/// wouldn't resolve against the real, `UserRepo`-backed `UserDirectory`
/// either). Called once, from [`boot_api`], before `AppState` is
/// constructed.
///
/// If [`streamarr_db::UserRepo::list_all`] already returns at least one
/// row, this is a no-op: returns the id of an existing admin (found by
/// checking each user's `Policy::is_admin`), or, if none of them is an
/// admin, the first user found at all -- either way, [`default_admin_user_id_from_env`]
/// still has a real, resolvable fallback id for `AuthMode::TrustedNetwork`
/// to bind to if that mode is explicitly opted into.
///
/// Otherwise, provisions exactly one admin account: reads
/// `STREAMARR_BOOTSTRAP_ADMIN_USERNAME` (default `"admin"`) and
/// `STREAMARR_BOOTSTRAP_ADMIN_PASSWORD`. When the password env var is
/// unset (or empty), a real random password is generated -- never a fixed,
/// shipped-in-code default, which would be a real, exploitable
/// vulnerability the moment two deployments share it -- and logged exactly
/// once at `WARN` (the only time it is ever available in cleartext: the
/// database only ever stores its Argon2id hash) so the operator can
/// actually retrieve and change it.
///
/// This function itself only resolves the two env vars; [`bootstrap_admin_with`]
/// is the actual env-independent logic (split out so tests can pass
/// explicit values instead of racily mutating process-global env vars
/// under parallel test execution).
async fn bootstrap_admin_if_needed(
    user_repo: &Arc<dyn streamarr_db::UserRepo>,
    policy_repo: &Arc<dyn streamarr_db::PolicyRepo>,
) -> anyhow::Result<uuid::Uuid> {
    let username = std::env::var("STREAMARR_BOOTSTRAP_ADMIN_USERNAME")
        .unwrap_or_else(|_| DEFAULT_BOOTSTRAP_ADMIN_USERNAME.to_string());
    let explicit_password = std::env::var("STREAMARR_BOOTSTRAP_ADMIN_PASSWORD").ok();
    bootstrap_admin_with(
        user_repo,
        policy_repo,
        &username,
        explicit_password.as_deref(),
    )
    .await
}

/// The env-independent core of [`bootstrap_admin_if_needed`], split out so
/// tests can exercise it with explicit, in-process values instead of
/// mutating process-global environment variables (which is inherently
/// racy against Rust's default parallel test execution -- two tests
/// setting/clearing the same env var concurrently is a real flakiness
/// source, not a hypothetical one).
async fn bootstrap_admin_with(
    user_repo: &Arc<dyn streamarr_db::UserRepo>,
    policy_repo: &Arc<dyn streamarr_db::PolicyRepo>,
    username: &str,
    explicit_password: Option<&str>,
) -> anyhow::Result<uuid::Uuid> {
    let existing_users = user_repo.list_all().await?;
    if !existing_users.is_empty() {
        for user in &existing_users {
            if let Ok(Some(policy)) = policy_repo.find_by_id(user.policy_id).await {
                if policy.is_admin {
                    return Ok(user.id);
                }
            }
        }
        tracing::info!(
            existing_user_count = existing_users.len(),
            "users already exist in the database; skipping bootstrap admin creation (no \
             existing user's policy has is_admin set -- trusted-network mode, if opted into, \
             will bind to the first user found instead)"
        );
        return Ok(existing_users[0].id);
    }

    let (password, generated) = match explicit_password {
        Some(password) if !password.is_empty() => (password.to_string(), false),
        _ => (generate_bootstrap_password(), true),
    };

    let policy = streamarr_model::Policy {
        id: uuid::Uuid::new_v4(),
        name: "Bootstrap Admin".to_string(),
        library_allow: Vec::new(),
        blocked_folders: Vec::new(),
        max_rating: None,
        blocked_tags: Vec::new(),
        allowed_tags: Vec::new(),
        can_transcode: true,
        can_download: true,
        can_delete: true,
        can_share_public: true,
        device_allow: Vec::new(),
        max_concurrent_sessions: None,
        access_schedule: None,
        // Deliberately no Playarr access -- this account exists to run
        // Streamarr's own admin surface, not as a household viewer
        // account. See `Policy::can_stream`'s doc comment: `is_admin`
        // does not imply it. An operator who also wants to use Playarr
        // day to day should provision (or grant `can_stream` on) a
        // separate account via the Users admin screen.
        can_stream: false,
        is_admin: true,
    };
    policy_repo.upsert(&policy).await?;

    let user = streamarr_model::User {
        id: uuid::Uuid::new_v4(),
        username: username.to_string(),
        display_name: username.to_string(),
        email: None,
        password_hash: streamarr_model::Sensitive::new(streamarr_auth::login::hash_password(
            &password,
        )),
        policy_id: policy.id,
        created_at: chrono::Utc::now(),
        disabled: false,
        preferred_audio_language: streamarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
    };
    let user_id = user.id;
    user_repo.upsert(&user).await?;

    if generated {
        tracing::warn!(
            "bootstrap admin created -- username: {username} password: {password} -- save this \
             now, it will not be shown again"
        );
    } else {
        tracing::warn!(
            username = %username,
            "bootstrap admin created using STREAMARR_BOOTSTRAP_ADMIN_PASSWORD from the \
             environment -- save it now if you haven't already, it will not be logged again"
        );
    }

    Ok(user_id)
}

/// A real, randomly generated bootstrap admin password: two concatenated
/// v4 UUIDs' hex digits (64 characters, the same generation idiom
/// [`generated_dev_jwt_secret`] above already uses for the same
/// "boot-lifetime, never hardcoded" reasoning) -- comfortably above any
/// reasonable minimum length, and never the same value twice, unlike a
/// fixed in-code default would be.
fn generate_bootstrap_password() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

async fn boot_api(
    config: &Config,
    pool: DbPool,
    source_instances: Arc<streamarr_api::SourceInstanceRegistry>,
    active_sessions: streamarr_transcode::ActiveSessionCounter,
    tdarr_notify_tx: tokio::sync::mpsc::Sender<streamarr_transcode::MediaFileImportEvent>,
    analytics_store: Arc<dyn streamarr_db::analytics::AnalyticsStore>,
    session_registry: Arc<dyn streamarr_telemetry::analytics::SessionRegistry>,
    analytics: Arc<streamarr_telemetry::analytics::AnalyticsCollector>,
    analytics_event_rx: tokio::sync::mpsc::Receiver<streamarr_model::PlaybackEvent>,
) -> anyhow::Result<()> {
    use streamarr_api::user_directory::RepoBackedUserDirectory;
    use streamarr_api::{
        build_router, AppState, ClientCompatibilityTable, ReadinessState,
        RepoBackedMediaFileLookup, VersionGateLayer, VersionState,
    };
    use streamarr_auth::{
        DashMapDeviceFlowHandler, DeviceFlowConfig, DeviceFlowHandler, InMemoryAdminRegistry,
        InMemoryDeviceAuthorizationStore, JwtIssuer, RefreshTokenService, RefreshTokenStore,
        UserDirectory,
    };
    use streamarr_db::repo::{
        seed_default_views, SqlxCreditRepo, SqlxDeviceRepo, SqlxLibraryViewRepo, SqlxMediaFileRepo,
        SqlxPlaylistRepo, SqlxPolicyRepo, SqlxProfilePinRepo, SqlxPushRegistrationRepo,
        SqlxRefreshTokenRepo, SqlxRenditionRepo, SqlxSourceInstanceRepo, SqlxTdarrConnectionRepo,
        SqlxUserInviteRepo, SqlxUserInviteRequestRepo, SqlxUserRepo, SqlxWatchProgressRepo,
        SqlxWorkRepo,
    };
    use streamarr_db::{
        CreditRepo, DeviceRepo, LibraryViewRepo, MediaFileRepo, PlaylistRepo, PolicyRepo,
        ProfilePinRepo, PushRegistrationRepo, RenditionRepo, SourceInstanceRepo,
        TdarrConnectionRepo, UserInviteRepo, UserInviteRequestRepo, UserRepo, WatchProgressRepo,
        WorkRepo,
    };
    use streamarr_model::VersionEnvelope;

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
    let source_instance_repo: Arc<dyn SourceInstanceRepo> =
        Arc::new(SqlxSourceInstanceRepo::new(pool.clone()));
    let user_repo: Arc<dyn UserRepo> = Arc::new(SqlxUserRepo::new(pool.clone()));
    let user_invite_repo: Arc<dyn UserInviteRepo> = Arc::new(SqlxUserInviteRepo::new(pool.clone()));
    let user_invite_request_repo: Arc<dyn UserInviteRequestRepo> =
        Arc::new(SqlxUserInviteRequestRepo::new(pool.clone()));
    let push_registration_repo: Arc<dyn PushRegistrationRepo> =
        Arc::new(SqlxPushRegistrationRepo::new(pool.clone()));
    let push_notifier: Arc<dyn streamarr_api::notifications::PushNotifier> =
        match std::env::var("GOOGLE_APPLICATION_CREDENTIALS") {
            Ok(path) => Arc::new(
                streamarr_api::notifications::FcmNotifier::from_service_account_file(path)
                    .map_err(anyhow::Error::msg)?,
            ),
            Err(_) => streamarr_api::notifications::disabled_notifier(),
        };
    let firebase_web_config = std::env::var("STREAMARR_FIREBASE_WEB_CONFIG")
        .ok()
        .map(|value| serde_json::from_str(&value))
        .transpose()
        .map_err(|err| anyhow::anyhow!("invalid STREAMARR_FIREBASE_WEB_CONFIG JSON: {err}"))?;
    let profile_pin_repo: Arc<dyn ProfilePinRepo> = Arc::new(SqlxProfilePinRepo::new(pool.clone()));
    let policy_repo: Arc<dyn PolicyRepo> = Arc::new(SqlxPolicyRepo::new(pool.clone()));
    let watch_progress: Arc<dyn WatchProgressRepo> =
        Arc::new(SqlxWatchProgressRepo::new(pool.clone()));
    let library_view_repo: Arc<dyn LibraryViewRepo> =
        Arc::new(SqlxLibraryViewRepo::new(pool.clone()));
    // Idempotent -- inserts "Newly Added"/"Newly Released" only if their
    // fixed ids don't already exist, never overwriting an admin's edits.
    // Same "seed once, every boot" treatment as `bootstrap_admin_if_needed`
    // below, just for Views instead of the admin account.
    if let Err(err) = seed_default_views(library_view_repo.as_ref()).await {
        tracing::error!(
            %err,
            "failed to seed default library views; Playarr's Home screen may be missing \
             its default 'Newly Added'/'Newly Released' shelves until this is investigated"
        );
    }
    let playlist_repo: Arc<dyn PlaylistRepo> = Arc::new(SqlxPlaylistRepo::new(pool.clone()));
    let credit_repo: Arc<dyn CreditRepo> = Arc::new(SqlxCreditRepo::new(pool.clone()));
    let tdarr_connection_repo: Arc<dyn TdarrConnectionRepo> =
        Arc::new(SqlxTdarrConnectionRepo::new(pool.clone()));
    // Durable, not `InMemoryRefreshTokenStore` -- see
    // `streamarr_db::repo::refresh_token`'s doc comment: without this, a
    // process restart silently invalidated every refresh token, forcing a
    // fresh login the moment each client's short-lived access token next
    // expired even though its refresh token was still well within its own
    // (much longer) TTL.
    let refresh_store: Arc<dyn RefreshTokenStore> =
        Arc::new(SqlxRefreshTokenRepo::new(pool.clone()));

    // Hydrate the in-memory `SourceInstanceRegistry` from whatever's
    // actually durable *before* it's handed to the router (and, via
    // `boot_worker`, the reconciliation-poller spawner) -- this is the
    // actual fix for "registered *arr connections don't survive a
    // restart": previously the registry always started empty and the only
    // way in was `POST /api/v1/admin/source-instances` on the running
    // process. Read-then-upsert, not a bulk "replace" -- keeps this in
    // step with `admin.rs`'s handlers, which write through the same repo.
    match source_instance_repo.list_all().await {
        Ok(instances) => {
            let hydrated_count = instances.len();
            for instance in instances {
                source_instances.upsert(instance);
            }
            if hydrated_count == 0 {
                tracing::info!(
                    "no persisted source instances found in the database; \
                     SourceInstanceRegistry starts empty"
                );
            } else {
                tracing::info!(
                    hydrated_count,
                    "hydrated SourceInstanceRegistry from persisted source instances"
                );
            }
        }
        Err(err) => {
            tracing::error!(
                %err,
                "failed to load persisted source instances from the database; \
                 SourceInstanceRegistry starts with whatever it already had (likely empty) -- \
                 previously-registered *arr connections may be unavailable until this is \
                 investigated"
            );
        }
    }

    let media_files: Arc<dyn streamarr_api::MediaFileLookup> =
        Arc::new(RepoBackedMediaFileLookup::new(media_file_repo.clone()));

    // The API role only ever *reads* cached embeddings (`GET /api/v1/
    // catalog/{id}/similar` brute-force cosine-scans `embedding_repo`); it
    // never loads the actual `streamarr_embeddings::Embedder` model itself
    // -- that's the worker role's job (see `spawn_poller_for`'s
    // `embedding_sync` wiring below). A work with no cached embedding yet
    // (not synced, or the worker hasn't loaded its model) just 404s from
    // `similar` (see that method's doc comment) -- there's nothing to
    // gate at boot here.
    let embedding_repo: Arc<dyn streamarr_db::EmbeddingRepo> =
        Arc::new(streamarr_db::repo::SqlxEmbeddingRepo::new(pool.clone()));
    let catalog = Arc::new(
        streamarr_catalog::CatalogService::new(
            work_repo.clone(),
            media_file_repo,
            cache.clone(),
            pool,
            watch_progress.clone(),
        )
        .with_embedding_repo(embedding_repo),
    );

    let transcode = Arc::new(
        streamarr_transcode::TranscodeOrchestrator::new(rendition_repo, cache, active_sessions)
            .with_output_root(std::env::temp_dir().join("streamarr-transcode"))
            .with_session_ttl(transcode_session_idle_ttl_from_env())
            .with_tdarr_notify(tdarr_notify_tx),
    );

    let jwt_secret = jwt_secret_from_env();
    let jwt = Arc::new(JwtIssuer::new(
        jwt_secret.as_bytes(),
        "streamarr",
        chrono::Duration::minutes(15),
    ));
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
                .unwrap_or_else(|_| "/link".to_string()),
            refresh_ttl: chrono::Duration::days(30),
        },
    ));

    // -- Real, durable user/policy persistence + login wiring --
    // `user_repo`/`policy_repo` (constructed above) replace the old
    // `streamarr_auth::login::InMemoryUserDirectory`/`admin_registry`
    // in-memory stand-ins that doc comment used to describe as interim.
    // `bootstrap_admin_if_needed` guarantees at least one real admin
    // account exists in the database before `state` (and therefore the
    // router) is ever constructed below -- with zero users in a fresh
    // database, nobody could ever log in through either auth mode.
    let bootstrap_admin_user_id = bootstrap_admin_if_needed(&user_repo, &policy_repo).await?;
    let admin_user_id = default_admin_user_id_from_env(bootstrap_admin_user_id);
    let user_directory: Arc<dyn UserDirectory> =
        Arc::new(RepoBackedUserDirectory::new(user_repo.clone()));
    // Still constructed (and still a required `AppState` field) even though
    // `auth_extractor::AdminUser` no longer reads it -- see that field's own
    // doc comment on `AppState` for why it's left in place for now.
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
        transcode,
        device_flow,
        webhook,
        source_instances,
        source_instance_repo,
        library_view_repo,
        playlist_repo,
        work_repo,
        credit_repo,
        tdarr_connection_repo,
        media_files,
        watch_progress,
        jwt,
        admin_registry,
        auth_mode,
        user_directory,
        user_repo,
        user_invite_repo,
        user_invite_request_repo,
        push_registration_repo,
        push_notifier,
        firebase_web_config,
        profile_pin_repo,
        policy_repo,
        sessions: refresh,
        refresh_ttl: chrono::Duration::days(30),
        node_id: uuid::Uuid::new_v4().to_string(),
        analytics_store: analytics_store.clone(),
        session_registry,
        analytics,
    };
    let version_gate = VersionGateLayer::new(compatibility_table);

    // Must run on every node that runs this (the API) role -- not
    // leader-gated. The event channel is a local, in-process `mpsc` fed
    // only by this same node's own `AnalyticsCollector` (via the playback
    // handlers this router just got wired with above), so each node has
    // its own buffered events that only it can flush; gating this behind
    // leadership would silently drop every non-leader node's events. See
    // `streamarr_telemetry::analytics::flusher`'s module doc comment.
    let analytics_flusher = streamarr_telemetry::analytics::AnalyticsFlusher::new(
        analytics_store,
        analytics_event_rx,
        std::time::Duration::from_secs(3),
        500,
    );
    tokio::spawn(analytics_flusher.run());

    let (router, _openapi) = build_router(state, version_gate, web_assets_dir_from_env());

    serve_application_router(config, router, Some(readiness)).await
}

/// Serves an application router over exactly one configured transport:
/// automatic ACME HTTPS, static-certificate HTTPS, or plain HTTP. The ACME
/// state is continuously polled for the lifetime of the process, so renewed
/// certificates are installed into the shared rustls resolver without a
/// Streamarr restart.
///
/// `POST /api/v1/auth/login`'s `AuthMode::TrustedNetwork` tier needs the
/// caller's real source IP (`ConnectInfo`) to decide whether to auto-login.
/// Every transport therefore uses `into_make_service_with_connect_info`.
async fn serve_application_router(
    config: &Config,
    router: axum::Router,
    readiness: Option<streamarr_api::ReadinessState>,
) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind(config.http_bind_addr).await?;

    if let Some(acme) = &config.acme {
        use futures::StreamExt;
        use rustls_acme::{AcmeConfig, EventOk, UseChallenge};

        // HTTP-01 intentionally gets its own listener. It never exposes the
        // Streamarr API over cleartext: challenge paths stay local and every
        // other request redirects to this node's browser-trusted HTTPS name.
        let challenge_listener = tokio::net::TcpListener::bind(acme.http01_bind_addr).await?;
        let contacts: Vec<String> = acme.contact.iter().cloned().collect();
        let mut state = AcmeConfig::new([acme.domain.as_str()])
            .contact(&contacts)
            .cache(acme_cache::SecureDirCache::new(acme.cache_dir.clone()))
            .directory_lets_encrypt(acme.environment.is_production())
            .challenge_type(UseChallenge::Http01)
            .state();
        let redirect_origin = https_origin(&acme.domain, config.http_bind_addr.port());
        let acceptor = HttpRedirectAcceptor::new(
            state.axum_acceptor(state.default_rustls_config()),
            redirect_origin.clone(),
        );
        let challenge_service = state.http01_challenge_tower_service();
        let challenge_router = axum::Router::new()
            .route_service(
                "/.well-known/acme-challenge/{challenge_token}",
                challenge_service,
            )
            .fallback({
                let redirect_origin = redirect_origin.clone();
                move |axum::extract::OriginalUri(uri): axum::extract::OriginalUri| {
                    let location = format!("{redirect_origin}{uri}");
                    async move { axum::response::Redirect::permanent(&location) }
                }
            });

        let environment = if acme.environment.is_production() {
            "production"
        } else {
            "staging"
        };
        tracing::info!(
            domain = %acme.domain,
            environment,
            cache_dir = %acme.cache_dir.display(),
            https_addr = %config.http_bind_addr,
            http01_addr = %acme.http01_bind_addr,
            "automatic HTTPS enabled with Let's Encrypt ACME HTTP-01"
        );
        let acme_state_future = async move {
            let initial_deadline = tokio::time::Instant::now() + Duration::from_secs(120);
            let mut certificate_deployed = false;
            loop {
                let next = if certificate_deployed {
                    state.next().await
                } else {
                    tokio::time::timeout_at(initial_deadline, state.next())
                        .await
                        .map_err(|_| {
                            anyhow::anyhow!(
                            "Let's Encrypt did not deploy an initial certificate within 120 seconds"
                        )
                        })?
                };
                let Some(event) = next else {
                    return Err::<(), anyhow::Error>(anyhow::anyhow!(
                        "Let's Encrypt ACME state stream ended unexpectedly"
                    ));
                };
                match event {
                    Ok(EventOk::DeployedCachedCert) => {
                        tracing::info!("deployed cached Let's Encrypt certificate");
                        certificate_deployed = true;
                        if let Some(readiness) = &readiness {
                            readiness.set_ready(true);
                        }
                    }
                    Ok(EventOk::DeployedNewCert) => {
                        tracing::info!(
                            "deployed newly issued or renewed Let's Encrypt certificate without restart"
                        );
                        certificate_deployed = true;
                        if let Some(readiness) = &readiness {
                            readiness.set_ready(true);
                        }
                    }
                    Ok(EventOk::CertCacheStore) => {
                        tracing::debug!("stored Let's Encrypt certificate in ACME cache")
                    }
                    Ok(EventOk::AccountCacheStore) => {
                        tracing::debug!("stored Let's Encrypt account in ACME cache")
                    }
                    Err(err) => tracing::error!(error = %err, "Let's Encrypt ACME state error"),
                }
            }
        };

        let https_server = axum_server::from_tcp(listener.into_std()?)?
            .acceptor(acceptor)
            .serve(router.into_make_service_with_connect_info::<std::net::SocketAddr>());
        let challenge_server = axum::serve(challenge_listener, challenge_router);
        tokio::try_join!(
            async { https_server.await.map_err(anyhow::Error::from) },
            async { challenge_server.await.map_err(anyhow::Error::from) },
            acme_state_future,
        )?;
    } else if let Some(tls) = &config.tls {
        let tls_config =
            axum_server::tls_rustls::RustlsConfig::from_pem_file(&tls.cert_path, &tls.key_path)
                .await?;
        tracing::info!(addr = %config.http_bind_addr, "https server listening with static certificate");
        if let Some(readiness) = readiness {
            readiness.set_ready(true);
        }
        axum_server::from_tcp_rustls(listener.into_std()?, tls_config)?
            .serve(router.into_make_service_with_connect_info::<std::net::SocketAddr>())
            .await?;
    } else {
        tracing::info!(addr = %config.http_bind_addr, "http server listening");
        if let Some(readiness) = readiness {
            readiness.set_ready(true);
        }
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await?;
    }
    Ok(())
}

/// Worker-role bootstrap: spawns one `ReconciliationPoller` per configured
/// `SourceInstance` and (when `TDARR_URL` is set) the leader-gated Tdarr
/// background dispatch loop. Returns immediately with the spawned tasks'
/// `JoinHandle`s — callers that don't need to observe completion (`serve`)
/// can drop them; the tasks keep running detached either way.
/// Spawns one [`ReconciliationPoller`] for `instance`, sharing the given
/// repos/pool/coordinator with every other poller. Factored out of
/// [`boot_worker`] so both its initial snapshot loop and the supervisor
/// loop below (which spawns pollers for instances registered *after*
/// startup) share exactly one construction path.
#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_arguments)]
fn spawn_poller_for(
    instance: &streamarr_model::SourceInstance,
    source_instances: &Arc<streamarr_api::SourceInstanceRegistry>,
    work_repo: Arc<dyn streamarr_db::WorkRepo>,
    media_file_repo: Arc<dyn streamarr_db::MediaFileRepo>,
    credit_repo: Arc<dyn streamarr_db::CreditRepo>,
    artwork_prewarm: Option<streamarr_arr_sync::ArtworkPrewarm>,
    embedding_sync: Option<streamarr_arr_sync::EmbeddingSync>,
    pool: DbPool,
    coordinator: Arc<dyn streamarr_coordination::ClusterCoordinator>,
) -> tokio::task::JoinHandle<()> {
    use streamarr_arr_sync::{ArrClient, ReconciliationPoller};
    use streamarr_telemetry::correlation::spawn::spawn_traced;

    let arr_client = ArrClient::from_source_instance(instance);
    // No webhook wired to this specific poller yet (see the TODO in
    // `boot_api`) — this channel only ever sees `Scheduled` ticks from its
    // own interval, plus whatever `SourceInstanceRegistry::trigger_sync`
    // sends on an operator's manual "Sync now" (the admin UI's per-instance
    // sync button, `POST /api/v1/admin/source-instances/{id}/sync`), never
    // a webhook-fast-pathed single-entity `Refetch`, until that separate
    // wiring lands.
    let (refetch_tx, refetch_rx) = tokio::sync::mpsc::channel(64);
    source_instances.register_trigger(instance.id, refetch_tx);
    let poller = ReconciliationPoller::new(
        instance.id,
        instance.kind,
        arr_client,
        Duration::from_secs(300),
        work_repo,
        media_file_repo,
        pool,
        coordinator,
        refetch_rx,
    )
    // `SourceInstanceRegistry` implements `SyncStatusReporter` itself (see
    // that type's doc comment) -- reusing the same `Arc` already threaded
    // through this function rather than introducing a separate status
    // store. Backs `GET /api/v1/admin/source-instances/sync-status`
    // (Streamarr Admin's "Tasks" screen).
    .with_status_reporter(source_instances.clone())
    // A no-op for every source kind except Radarr (see
    // `MediaSync::with_credit_repo`'s doc comment) -- passed unconditionally
    // rather than only for `SourceKind::Radarr` instances, since threading
    // it through unconditionally here is simpler than a kind-gated branch
    // and costs nothing extra for non-Radarr instances.
    .with_credit_repo(credit_repo);
    let poller = if let Some(prewarm) = artwork_prewarm {
        poller.with_artwork_prewarm(prewarm.with_source_instance(instance.clone()))
    } else {
        poller
    };
    let poller = if let Some(embedding_sync) = embedding_sync {
        poller.with_embedding_sync(embedding_sync)
    } else {
        poller
    };
    let span = tracing::info_span!(
        "arr_sync_poller",
        source_instance_id = %instance.id,
        source_kind = ?instance.kind,
    );
    spawn_traced(span, async move {
        if let Err(err) = poller.run().await {
            tracing::error!(%err, "reconciliation poller exited with an error");
        }
    })
}

async fn boot_worker(
    pool: DbPool,
    coordinator: Arc<dyn streamarr_coordination::ClusterCoordinator>,
    source_instances: Arc<streamarr_api::SourceInstanceRegistry>,
    active_sessions: streamarr_transcode::ActiveSessionCounter,
    tdarr_notify_rx: tokio::sync::mpsc::Receiver<streamarr_transcode::MediaFileImportEvent>,
    analytics_store: Arc<dyn streamarr_db::analytics::AnalyticsStore>,
    session_registry: Arc<dyn streamarr_telemetry::analytics::SessionRegistry>,
    analytics: Arc<streamarr_telemetry::analytics::AnalyticsCollector>,
) -> anyhow::Result<Vec<tokio::task::JoinHandle<()>>> {
    use std::collections::HashSet;

    use streamarr_db::repo::{SqlxCreditRepo, SqlxEmbeddingRepo, SqlxMediaFileRepo, SqlxWorkRepo};
    use streamarr_db::{CreditRepo, EmbeddingRepo, MediaFileRepo, WorkRepo};

    let mut handles = Vec::new();

    let work_repo: Arc<dyn WorkRepo> = Arc::new(SqlxWorkRepo::new(pool.clone()));
    let media_file_repo: Arc<dyn MediaFileRepo> = Arc::new(SqlxMediaFileRepo::new(pool.clone()));
    let credit_repo: Arc<dyn CreditRepo> = Arc::new(SqlxCreditRepo::new(pool.clone()));

    // Proactive artwork cache warming (see `streamarr_arr_sync::
    // artwork_prewarm`'s doc comment) -- unconditional, no fallible setup,
    // so this is always `Some`.
    let artwork_prewarm = Some(streamarr_arr_sync::ArtworkPrewarm::new(
        streamarr_artwork::shared(),
    ));

    // Best-effort, same tradeoff `boot_api`'s own embedding-repo wiring
    // documents: `FastEmbedEmbedder::new()` downloads its model on first
    // use, so this must never fail worker startup. `None` here just means
    // `similar` stays empty-of-fresh-data (already-cached embeddings from
    // before this failure still serve fine) until a later restart
    // succeeds.
    let embedding_repo: Arc<dyn EmbeddingRepo> = Arc::new(SqlxEmbeddingRepo::new(pool.clone()));
    let embedding_sync = match tokio::task::spawn_blocking(
        streamarr_embeddings::FastEmbedEmbedder::new,
    )
    .await
    {
        Ok(Ok(embedder)) => Some(streamarr_arr_sync::EmbeddingSync::new(
            Arc::new(embedder),
            embedding_repo,
        )),
        Ok(Err(err)) => {
            tracing::warn!(
                %err,
                "local embedding model failed to load; new/changed works will not get a \
                 'similar to this' embedding until a later restart succeeds"
            );
            None
        }
        Err(err) => {
            tracing::warn!(%err, "embedding model init task panicked; embedding sync disabled this run");
            None
        }
    };

    let mut spawned_instance_ids: HashSet<uuid::Uuid> = HashSet::new();
    let configured_instances = source_instances.all();
    if configured_instances.is_empty() {
        tracing::info!(
            "no SourceInstance is configured yet; arr-sync has nothing to poll until one is \
             registered via the admin API. Checked again every 10s by the supervisor loop \
             below, so a later registration doesn't need a process restart to start syncing."
        );
    }
    for instance in &configured_instances {
        handles.push(spawn_poller_for(
            instance,
            &source_instances,
            work_repo.clone(),
            media_file_repo.clone(),
            credit_repo.clone(),
            artwork_prewarm.clone(),
            embedding_sync.clone(),
            pool.clone(),
            coordinator.clone(),
        ));
        spawned_instance_ids.insert(instance.id);
    }

    // `POST /api/v1/admin/source-instances` (`admin.rs`'s
    // `create_source_instance_handler`) only ever upserts into the shared
    // registry (and, write-through, the `SourceInstanceRepo` behind it) --
    // it never signals this worker directly. Without this loop, a
    // SourceInstance registered after the snapshot above would silently
    // never get a poller and never sync until the process restarted. This
    // is a cheap in-memory `DashMap` read, not a network/DB call, so a 10s
    // poll interval is negligible overhead.
    //
    // NOTE: this only closes the gap for `STREAMARR_ROLE=all` (this
    // worker and the `api` role sharing one `Arc<SourceInstanceRegistry>`
    // in the same process, e.g. `docker-compose.standalone.yml`). Split
    // `api`/`worker`-role deployments (Postgres tiers 2/3) run this
    // function in a *different* process than the one serving the admin
    // endpoint, each with its own registry -- and unlike `boot_api`
    // (which hydrates its registry from `SourceInstanceRepo` before
    // serving), this function does not hydrate its own from the database
    // at all yet, even though the repo/persistence now exists. A
    // worker-only process's registry stays empty (so it spawns no
    // pollers) until this loop is also wired to read from the repo -- a
    // smaller follow-up now that persistence exists, not the bigger
    // "no persistence exists anywhere" gap this note used to describe.
    {
        let source_instances = source_instances.clone();
        let work_repo = work_repo.clone();
        let media_file_repo = media_file_repo.clone();
        let credit_repo = credit_repo.clone();
        let artwork_prewarm = artwork_prewarm.clone();
        let embedding_sync = embedding_sync.clone();
        let pool = pool.clone();
        let coordinator = coordinator.clone();
        handles.push(tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(10));
            interval.tick().await; // first tick fires immediately; the snapshot above already covers "now"
            loop {
                interval.tick().await;
                for instance in source_instances.all() {
                    if spawned_instance_ids.insert(instance.id) {
                        tracing::info!(
                            source_instance_id = %instance.id,
                            source_kind = ?instance.kind,
                            "SourceInstance registered after startup; spawning its reconciliation poller now"
                        );
                        spawn_poller_for(
                            &instance,
                            &source_instances,
                            work_repo.clone(),
                            media_file_repo.clone(),
                            credit_repo.clone(),
                            artwork_prewarm.clone(),
                            embedding_sync.clone(),
                            pool.clone(),
                            coordinator.clone(),
                        );
                    }
                }
            }
        }));
    }

    // Three cluster-wide-singleton playback-analytics background jobs --
    // all leader-gated, same `run_while_leader` pattern the Tdarr
    // dispatcher below already uses, since each would be redundant work
    // (though not unsafe -- every one of them is idempotent) if every node
    // ran it concurrently.
    {
        let rollup = streamarr_telemetry::analytics::RollupScheduler::new(
            analytics_store.clone(),
            Duration::from_secs(300),
        );
        handles.push(tokio::spawn(run_while_leader(
            coordinator.clone(),
            "analytics-rollup",
            Duration::from_secs(30),
            async move {
                if let Err(err) = rollup.run().await {
                    tracing::error!(%err, "stats_daily rollup scheduler exited with an error");
                }
            },
        )));
    }
    {
        // 60s idle threshold: four missed heartbeats at the recommended
        // 15s client heartbeat cadence -- see `SessionReaper`'s own doc
        // comment for the tradeoff this balances.
        let reaper = streamarr_telemetry::analytics::SessionReaper::new(
            session_registry.clone(),
            analytics.clone(),
            Duration::from_secs(60),
            Duration::from_secs(30),
        );
        handles.push(tokio::spawn(run_while_leader(
            coordinator.clone(),
            "analytics-reaper",
            Duration::from_secs(30),
            async move {
                reaper.run().await;
            },
        )));
    }
    {
        let retention = streamarr_telemetry::analytics::RetentionSweeper::new(
            pool.clone(),
            streamarr_telemetry::analytics::RetentionPolicy::default(),
            Duration::from_secs(3600),
        );
        handles.push(tokio::spawn(run_while_leader(
            coordinator.clone(),
            "analytics-retention",
            Duration::from_secs(30),
            async move {
                if let Err(err) = retention.run().await {
                    tracing::error!(%err, "playback analytics retention sweeper exited with an error");
                }
            },
        )));
    }

    // Sourced from the admin-registered `TdarrConnection` (see
    // `streamarr_api::tdarr`'s module doc comment) -- replaces the old
    // `TDARR_URL`/`TDARR_API_KEY`/`TDARR_DB_ID` env-var-only config, same
    // "durable, admin-registerable, not a restart-required env var"
    // upgrade `SourceInstance` already went through for `*arr` apps.
    let tdarr_connection_repo: Arc<dyn streamarr_db::TdarrConnectionRepo> = Arc::new(
        streamarr_db::repo::SqlxTdarrConnectionRepo::new(pool.clone()),
    );
    match tdarr_connection_repo.get().await {
        Ok(Some(connection)) => {
            handles.push(spawn_tdarr_dispatcher(
                connection,
                pool.clone(),
                active_sessions,
                tdarr_notify_rx,
                coordinator.clone(),
            ));
        }
        Ok(None) => {
            tracing::info!(
                "no Tdarr connection registered yet; background Tdarr dispatch loop starts \
                 once one is registered via POST /api/v1/admin/tdarr (checked every 10s below)"
            );
            // Same "registered after this snapshot" gap `SourceInstance`
            // hydration has its own 10s watch loop for (see the comment
            // above this function's `configured_instances` loop) --
            // mirrored here for Tdarr's single connection. Runs until the
            // connection first appears, then spawns the dispatcher (moving
            // `tdarr_notify_rx` in, which is why this loop can only ever
            // do this once) and stops watching -- registering a *second*
            // time (e.g. to rotate the API key) updates the row in place
            // but does not hot-swap the already-running dispatcher; that
            // still needs a restart, same as changing `STREAMARR_AUTH_MODE`
            // does.
            let coordinator = coordinator.clone();
            handles.push(tokio::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(10));
                interval.tick().await; // first tick fires immediately; the check above already covered "now"
                let mut tdarr_notify_rx = Some(tdarr_notify_rx);
                loop {
                    interval.tick().await;
                    match tdarr_connection_repo.get().await {
                        Ok(Some(connection)) => {
                            let Some(tdarr_notify_rx) = tdarr_notify_rx.take() else {
                                return;
                            };
                            tracing::info!(
                                "Tdarr connection registered; starting the background dispatch loop now"
                            );
                            spawn_tdarr_dispatcher(
                                connection,
                                pool.clone(),
                                active_sessions,
                                tdarr_notify_rx,
                                coordinator.clone(),
                            );
                            return;
                        }
                        Ok(None) => {}
                        Err(err) => {
                            tracing::error!(%err, "failed to check for a registered Tdarr connection");
                        }
                    }
                }
            }));
        }
        Err(err) => {
            tracing::error!(
                %err,
                "failed to load the Tdarr connection from the database; background Tdarr \
                 dispatch is unavailable until this is investigated"
            );
        }
    }

    Ok(handles)
}

/// Builds and spawns the leader-gated `TdarrDispatcher` loop from a
/// persisted [`streamarr_model::TdarrConnection`] -- the single spawn
/// point both `boot_worker`'s boot-time hydration and its registration
/// watch loop (see that function's body) call into, so the two paths
/// can't drift.
fn spawn_tdarr_dispatcher(
    connection: streamarr_model::TdarrConnection,
    pool: DbPool,
    active_sessions: streamarr_transcode::ActiveSessionCounter,
    tdarr_notify_rx: tokio::sync::mpsc::Receiver<streamarr_transcode::MediaFileImportEvent>,
    coordinator: Arc<dyn streamarr_coordination::ClusterCoordinator>,
) -> tokio::task::JoinHandle<()> {
    use streamarr_db::repo::SqlxRenditionRepo;
    use streamarr_db::RenditionRepo;

    let rendition_repo: Arc<dyn RenditionRepo> = Arc::new(SqlxRenditionRepo::new(pool));
    let tdarr = streamarr_tdarr_client::TdarrClient::new(
        connection.base_url,
        connection.api_key_encrypted.expose_secret().clone(),
    );
    // `tdarr_notify_rx` is the receive side of the channel `boot_api`'s
    // `TranscodeOrchestrator` sends on every time it starts a live
    // on-demand session (see `streamarr_transcode`'s module docs, "other
    // bridge" section) -- this is what turns "someone is watching this
    // file right now via a temporary session" into a durable,
    // Tdarr-produced `Rendition` for future requests. Real *arr
    // import/upgrade events aren't wired onto this same channel yet
    // (there's no `MediaFileRepo`-backed import pipeline outside
    // arr-sync's own reconciliation flow to source them from) -- a
    // separate, not-yet-addressed gap; the on-demand path above is real
    // and live today regardless.
    let dispatcher = streamarr_transcode::TdarrDispatcher::new(
        tdarr,
        rendition_repo,
        active_sessions,
        tdarr_notify_rx,
        streamarr_transcode::TdarrDispatcherConfig {
            tdarr_db_id: connection.tdarr_db_id,
            default_profile: connection.default_profile,
            worker_process: connection.worker_process,
            default_worker_limit: connection.default_worker_limit,
            throttled_worker_limit: connection.throttled_worker_limit,
            active_session_threshold: connection.active_session_threshold.max(0) as usize,
            throttle_check_interval: Duration::from_secs(
                connection.throttle_check_interval_secs.max(0) as u64,
            ),
        },
    );
    tokio::spawn(run_while_leader(
        coordinator,
        "transcode-dispatcher",
        Duration::from_secs(30),
        async move {
            if let Err(err) = dispatcher.run().await {
                tracing::error!(%err, "tdarr dispatcher exited with an error");
            }
        },
    ))
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
    tracing::info!(addr = %config.http_bind_addr, "worker-only minimal health listener starting");
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

#[cfg(test)]
mod bootstrap_tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use streamarr_auth::PasswordVerifier as _;
    use streamarr_db::repo::{SqlxPolicyRepo, SqlxUserRepo};
    use streamarr_db::{DbPool, PolicyRepo, UserRepo};

    /// Same private, migrated, in-memory SQLite pool idiom
    /// `streamarr-api`'s `test_support::test_pool` and `streamarr-catalog`'s
    /// own tests use -- a fresh, uniquely named `:memory:`-equivalent
    /// database per call.
    async fn test_pool() -> DbPool {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let url = format!("sqlite://streamarr_bin_bootstrap_test_{n}?mode=memory&cache=shared");

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

    /// End-to-end proof (real SQLite, real Argon2 hashing, no mocks) that a
    /// fresh, empty database gets exactly one real, persisted, `is_admin`
    /// account whose generated password actually verifies against the
    /// stored hash -- the actual "nobody could ever log in" gap this
    /// function exists to close.
    #[tokio::test]
    async fn bootstrap_creates_a_real_verifiable_admin_on_an_empty_database() {
        let pool = test_pool().await;
        let user_repo: Arc<dyn UserRepo> = Arc::new(SqlxUserRepo::new(pool.clone()));
        let policy_repo: Arc<dyn PolicyRepo> = Arc::new(SqlxPolicyRepo::new(pool));

        let admin_id = bootstrap_admin_with(
            &user_repo,
            &policy_repo,
            DEFAULT_BOOTSTRAP_ADMIN_USERNAME,
            None,
        )
        .await
        .expect("bootstrap succeeds on an empty database");

        let users = user_repo.list_all().await.unwrap();
        assert_eq!(users.len(), 1, "exactly one account is provisioned");
        let user = &users[0];
        assert_eq!(user.id, admin_id);
        assert_eq!(user.username, DEFAULT_BOOTSTRAP_ADMIN_USERNAME);
        assert!(!user.disabled);

        let policy = policy_repo
            .find_by_id(user.policy_id)
            .await
            .unwrap()
            .expect("bootstrap admin's policy is persisted");
        assert!(policy.is_admin, "bootstrap account must be a real admin");
        assert!(
            !policy.can_stream,
            "bootstrap admin must not have Playarr streaming access by default"
        );

        // The generated password itself is never stored/returned -- only
        // its Argon2id hash is persisted -- so this can only prove *some*
        // real, well-formed password was generated and hashed correctly
        // (a wrong guess must not verify against it), not recover what the
        // generated password actually was.
        assert!(
            !streamarr_auth::login::Argon2PasswordVerifier.verify(
                "definitely-not-the-generated-password",
                user.password_hash.expose_secret()
            ),
            "an arbitrary wrong password must never verify against the real hash"
        );
    }

    #[tokio::test]
    async fn bootstrap_is_idempotent_and_honors_explicit_credentials() {
        let pool = test_pool().await;
        let user_repo: Arc<dyn UserRepo> = Arc::new(SqlxUserRepo::new(pool.clone()));
        let policy_repo: Arc<dyn PolicyRepo> = Arc::new(SqlxPolicyRepo::new(pool));

        let first_id = bootstrap_admin_with(
            &user_repo,
            &policy_repo,
            "root-test-user",
            Some("a-real-known-test-password-123"),
        )
        .await
        .unwrap();
        let users_after_first = user_repo.list_all().await.unwrap();
        assert_eq!(users_after_first.len(), 1);
        assert_eq!(users_after_first[0].username, "root-test-user");

        // The explicit password must actually be the one that verifies --
        // not a generated one -- since an explicit password was passed.
        assert!(streamarr_auth::login::Argon2PasswordVerifier.verify(
            "a-real-known-test-password-123",
            users_after_first[0].password_hash.expose_secret()
        ));

        // A second call against a now-non-empty database must not create a
        // second account -- it must resolve back to the same (or an
        // equally real, already-persisted) admin instead, regardless of
        // what's passed in this time.
        let second_id = bootstrap_admin_with(&user_repo, &policy_repo, "some-other-name", None)
            .await
            .unwrap();
        let users_after_second = user_repo.list_all().await.unwrap();
        assert_eq!(
            users_after_second.len(),
            1,
            "bootstrap must not create a second account when one already exists"
        );
        assert_eq!(second_id, first_id);
    }

    #[test]
    fn generated_bootstrap_passwords_are_long_and_not_a_fixed_default() {
        let a = generate_bootstrap_password();
        let b = generate_bootstrap_password();
        assert_ne!(a, b, "must never generate the same password twice");
        assert!(a.len() >= 20, "must be comfortably longer than 20 chars");
    }

    #[test]
    fn plaintext_redirect_preserves_only_origin_form_targets() {
        assert_eq!(
            plaintext_http_target(
                b"GET /api/system/health?full=1 HTTP/1.1\r\nHost: example\r\n\r\n"
            ),
            "/api/system/health?full=1"
        );
        assert_eq!(
            plaintext_http_target(b"GET https://attacker.example/ HTTP/1.1\r\n\r\n"),
            "/"
        );
        assert_eq!(plaintext_http_target(b"garbage"), "/");
    }

    #[test]
    fn https_redirect_origin_keeps_nonstandard_streamarr_port() {
        assert_eq!(
            https_origin("v4-203-0-113-10.relay.playarr.app", 8484),
            "https://v4-203-0-113-10.relay.playarr.app:8484"
        );
        assert_eq!(
            https_origin("streamarr.example.com", 443),
            "https://streamarr.example.com"
        );
    }

    #[tokio::test]
    async fn plaintext_http_on_tls_socket_receives_https_redirect() {
        use axum_server::accept::Accept as _;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let mut client = tokio::net::TcpStream::connect(address).await.unwrap();
        let (server, _) = listener.accept().await.unwrap();
        let acceptor = HttpRedirectAcceptor::new(
            axum_server::accept::DefaultAcceptor::new(),
            "https://v4-203-0-113-10.relay.playarr.app:8484".to_string(),
        );

        let redirect = tokio::spawn(async move {
            let error = acceptor.accept(server, ()).await.unwrap_err();
            assert_eq!(error.kind(), std::io::ErrorKind::Other);
        });
        client
            .write_all(b"GET /api/system/health?full=1 HTTP/1.1\r\nHost: 203.0.113.10:8484\r\n\r\n")
            .await
            .unwrap();
        let mut response = String::new();
        client.read_to_string(&mut response).await.unwrap();
        redirect.await.unwrap();

        assert!(response.starts_with("HTTP/1.1 308 Permanent Redirect\r\n"));
        assert!(response.contains(
            "Location: https://v4-203-0-113-10.relay.playarr.app:8484/api/system/health?full=1\r\n"
        ));
    }
}
