//! `playarr` — the combined server binary and maintenance CLI.
//!
//! With no subcommand, boots the server: resolves [`playarr_config::Config`]
//! from the environment, initializes [`playarr_telemetry`], connects and
//! migrates the database, and then, depending on `PLAYARR_ROLE`:
//!
//! - `api`/`all`: serves the full Axum router built by
//!   [`playarr_api::build_router`], with a real [`playarr_api::AppState`]
//!   behind it (catalog, requests, transcode orchestrator, device-flow auth,
//!   session login, webhook receiver). Every mutating request-management
//!   route requires a verified `Authorization: Bearer <token>` (see
//!   `playarr_api::auth_extractor`); `auth_mode_from_env`/
//!   `default_admin_user_id_from_env` below resolve this deployment's login
//!   trust tier and default admin identity.
//! - `worker`/`all`: spawns the arr-sync reconciliation pollers (one per
//!   configured `SourceInstance`), the peer-sync pollers (one per non-self
//!   `peer_nodes` row -- see `docs/architecture/peer-groups.md` §3.6; zero
//!   for an ungrouped node), and the Tdarr background dispatch loop (each
//!   gated by [`playarr_coordination::ClusterCoordinator`] leader
//!   election or a per-peer lock, so only one node runs/polls a given one
//!   in a multi-node deployment) as background tasks. `worker`-only
//!   additionally serves a minimal `/healthz` listener, since it runs no
//!   public API router.
//!
//! `update` is a separate maintenance subcommand for checking/applying
//! binary updates out-of-band from a running server.
// `async_trait` expansions trip clippy::double_must_use on current stable.
#![allow(clippy::double_must_use)]

use std::future::IntoFuture;
use std::sync::Arc;
use std::time::Duration;
use std::{env, io::Read};

use clap::{Parser, Subcommand, ValueEnum};
use playarr_config::Config;
use playarr_db::DbPool;

mod acme_cache;
mod multi_cert;
mod relay;
mod relay_acme;
mod source_urls;

const CLIENT_COMPATIBILITY_TOML: &str = include_str!("../config/client-compatibility.toml");

#[derive(Clone)]
struct HttpRedirectAcceptor<A> {
    inner: A,
    https_origin: Arc<str>,
    /// Relay challenge tokens that may be answered over plain HTTP, so the
    /// Playarr Worker's callback works on the HTTPS port.
    relay_challenges: Option<Arc<relay::ChallengeStore>>,
}

impl<A> HttpRedirectAcceptor<A> {
    fn new(inner: A, https_origin: String) -> Self {
        Self {
            inner,
            https_origin: https_origin.into(),
            relay_challenges: None,
        }
    }

    fn with_relay_challenges(mut self, challenges: Option<Arc<relay::ChallengeStore>>) -> Self {
        self.relay_challenges = challenges;
        self
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
        let relay_challenges = self.relay_challenges.clone();
        Box::pin(async move {
            let mut first_byte = [0_u8; 1];
            let read = stream.peek(&mut first_byte).await?;
            if read > 0 && first_byte[0].is_ascii_uppercase() {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};

                let mut request = vec![0_u8; 8 * 1024];
                let request_len = stream.read(&mut request).await?;
                if let Some(response) = relay_challenges.as_deref().and_then(|store| {
                    relay::plaintext_challenge_response(&request[..request_len], store)
                }) {
                    stream.write_all(response.as_bytes()).await?;
                    stream.shutdown().await?;
                    return Err(std::io::Error::other(
                        "answered relay challenge over plaintext HTTP",
                    ));
                }
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
    name = "playarr",
    version,
    about = "Playarr Server backend server and maintenance CLI"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Run the server. This is the default when no subcommand is given.
    Serve,
    /// Check for, and optionally apply, a Playarr Server binary update.
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
    /// Server backups: create, verify and manage recovery keys.
    Backup {
        #[command(subcommand)]
        command: BackupCommand,
    },
    /// Reset an existing administrator's password from standard input.
    ResetAdminPassword {
        /// Administrator username to update.
        #[arg(long, default_value = DEFAULT_BOOTSTRAP_ADMIN_USERNAME)]
        username: String,
    },
    /// Create an administrator account (password from standard input), or
    /// reset the password when that administrator already exists. Intended
    /// for provisioning a dedicated operator or test account without touching
    /// the database directly.
    CreateAdmin {
        /// Username for the administrator account.
        #[arg(long)]
        username: String,
    },
}

#[derive(Subcommand)]
enum BackupCommand {
    /// Generate a recovery key pair. The secret identity is written to `--out`
    /// (mode 0600, never printed); the public key is printed for
    /// `PLAYARR_BACKUP_RECIPIENTS`.
    Keygen {
        #[arg(long)]
        out: std::path::PathBuf,
    },
    /// Run one backup now using the `PLAYARR_BACKUP_*` configuration.
    Create,
    /// Restore a backup into the database named by `DATABASE_URL`. Run with the
    /// server stopped. Validates and stages first; the current installation is
    /// only replaced (and kept aside) once every check passes.
    Restore {
        #[arg(long)]
        archive: std::path::PathBuf,
        #[arg(long)]
        identity_file: std::path::PathBuf,
        /// Rewrite library paths, `OLD=NEW`. Repeatable.
        #[arg(long = "remap-path", value_parser = parse_remap)]
        remap: Vec<(String, String)>,
        /// `replace` keeps the peer identity (the original is gone); `clone`
        /// drops it and disables outbound integrations.
        #[arg(long, value_enum, default_value_t = RestoreIdentity::Replace)]
        identity: RestoreIdentity,
        /// Proceed even when library roots are missing on this machine.
        #[arg(long)]
        allow_missing_media: bool,
        /// Validate and stage only; change nothing.
        #[arg(long)]
        dry_run: bool,
        /// Staging directory (default: beside the SQLite file, else the temp dir).
        #[arg(long)]
        work_dir: Option<std::path::PathBuf>,
    },
    /// Decrypt an archive and check every checksum without restoring.
    Verify {
        #[arg(long)]
        archive: std::path::PathBuf,
        #[arg(long)]
        identity_file: std::path::PathBuf,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum RestoreIdentity {
    Replace,
    Clone,
}

fn parse_remap(raw: &str) -> Result<(String, String), String> {
    match raw.split_once('=') {
        Some((old, new)) if !old.is_empty() && !new.is_empty() => {
            Ok((old.to_string(), new.to_string()))
        }
        _ => Err("expected OLD=NEW".to_string()),
    }
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
        Command::Backup { command } => backup_command(command).await,
        Command::ResetAdminPassword { username } => reset_admin_password(&username).await,
        Command::CreateAdmin { username } => create_admin(&username).await,
    }
}

async fn backup_command(command: BackupCommand) -> anyhow::Result<()> {
    use std::io::Write as _;
    match command {
        BackupCommand::Keygen { out } => {
            let key = playarr_backup::crypto::generate_key();
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt as _;
                options.mode(0o600);
            }
            let mut file = options
                .open(&out)
                .map_err(|error| anyhow::anyhow!("cannot create {}: {error}", out.display()))?;
            writeln!(file, "# Playarr backup recovery key. Keep it offline; anyone holding it can read every backup.")?;
            writeln!(file, "# public key: {}", key.public)?;
            writeln!(file, "{}", key.secret)?;
            file.sync_all()?;
            println!("recovery key written to {}", out.display());
            println!("public key (for PLAYARR_BACKUP_RECIPIENTS): {}", key.public);
            Ok(())
        }
        BackupCommand::Create => {
            let mut config = playarr_backup::BackupConfig::from_env()?
                .ok_or_else(|| anyhow::anyhow!("PLAYARR_BACKUP_DIR is not set"))?;
            config.artwork_dir = Some(playarr_artwork::artwork_cache_root());
            let database_url = env::var("DATABASE_URL")
                .map_err(|_| anyhow::anyhow!("DATABASE_URL is required"))?;
            let pool = playarr_db::connect(&database_url).await?;
            let service =
                playarr_backup::BackupService::new(config, pool, env!("CARGO_PKG_VERSION"));
            let sidecar = service.run_now("cli").await?;
            println!(
                "backup {} written to {} ({} bytes, {} partial)",
                sidecar.manifest.backup_id,
                sidecar.archive_name,
                sidecar.archive_size,
                if sidecar.manifest.partial {
                    "labelled"
                } else {
                    "not"
                }
            );
            Ok(())
        }
        BackupCommand::Restore {
            archive,
            identity_file,
            remap,
            identity,
            allow_missing_media,
            dry_run,
            work_dir,
        } => {
            let database_url = env::var("DATABASE_URL")
                .map_err(|_| anyhow::anyhow!("DATABASE_URL is required"))?;
            let identities = playarr_backup::crypto::read_identity_file(&identity_file)?;
            let work_dir = work_dir.unwrap_or_else(|| {
                database_url
                    .strip_prefix("sqlite://")
                    .and_then(|rest| rest.split('?').next())
                    .and_then(|path| std::path::Path::new(path).parent())
                    .map(|parent| parent.to_path_buf())
                    .unwrap_or_else(env::temp_dir)
            });
            let report =
                playarr_backup::restore::restore(playarr_backup::restore::RestoreOptions {
                    archive,
                    identities,
                    database_url,
                    work_dir,
                    artwork_dir: Some(playarr_artwork::artwork_cache_root()),
                    remap,
                    identity_mode: match identity {
                        RestoreIdentity::Replace => playarr_backup::restore::IdentityMode::Replace,
                        RestoreIdentity::Clone => playarr_backup::restore::IdentityMode::Clone,
                    },
                    allow_missing_media,
                    dry_run,
                })
                .await?;
            println!("{}", serde_json::to_string_pretty(&report)?);
            if report.cutover {
                println!("restore complete; start the server, then have users sign in again");
            } else {
                println!("dry run complete; nothing was changed");
            }
            Ok(())
        }
        BackupCommand::Verify {
            archive,
            identity_file,
        } => {
            let identities = playarr_backup::crypto::read_identity_file(&identity_file)?;
            let manifest = tokio::task::spawn_blocking(move || {
                playarr_backup::archive::verify_and_extract(&archive, &identities, None)
            })
            .await??;
            println!(
                "backup {} verified: engine {}, schema {}, {} files, {}",
                manifest.backup_id,
                manifest.engine.as_str(),
                manifest.schema_version,
                manifest.files.len(),
                if manifest.partial {
                    "partial"
                } else {
                    "complete"
                }
            );
            Ok(())
        }
    }
}

/// Resets one persisted administrator account without exposing the new
/// password in process arguments or shell history. The password is accepted
/// only on standard input and the database stores only its Argon2id hash.
async fn reset_admin_password(username: &str) -> anyhow::Result<()> {
    let database_url =
        env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL is required"))?;
    let pool = playarr_db::connect(&database_url).await?;

    use playarr_db::{PolicyRepo as _, UserRepo as _};
    let user_repo = playarr_db::repo::SqlxUserRepo::new(pool.clone());
    let policy_repo = playarr_db::repo::SqlxPolicyRepo::new(pool);
    let mut user = user_repo
        .find_by_username(username)
        .await?
        .ok_or_else(|| anyhow::anyhow!("no user named {username}"))?;
    let is_admin = policy_repo
        .find_by_id(user.policy_id)
        .await?
        .is_some_and(|policy| policy.is_admin);
    if !is_admin {
        anyhow::bail!("user {username} is not an administrator");
    }

    let mut password = String::new();
    std::io::stdin().read_to_string(&mut password)?;
    let password = password.trim_end_matches(['\r', '\n']);
    if password.len() < 12 {
        anyhow::bail!("password must contain at least 12 characters");
    }

    user.password_hash =
        playarr_model::Sensitive::new(playarr_auth::login::hash_password(password));
    user_repo.upsert(&user).await?;
    println!("reset password for administrator {username}");
    Ok(())
}

/// Provisions (or re-passwords) one administrator that may also stream, so a
/// dedicated operator/test account can exercise the whole product. The
/// password is read from standard input only; the database stores its
/// Argon2id hash. Refuses to touch an existing non-administrator account.
async fn create_admin(username: &str) -> anyhow::Result<()> {
    let database_url =
        env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL is required"))?;
    let pool = playarr_db::connect(&database_url).await?;
    let user_repo: Arc<dyn playarr_db::UserRepo> =
        Arc::new(playarr_db::repo::SqlxUserRepo::new(pool.clone()));
    let policy_repo: Arc<dyn playarr_db::PolicyRepo> =
        Arc::new(playarr_db::repo::SqlxPolicyRepo::new(pool));

    let mut password = String::new();
    std::io::stdin().read_to_string(&mut password)?;
    let password = password.trim_end_matches(['\r', '\n']);
    let created = create_admin_with(&user_repo, &policy_repo, username, password).await?;
    println!(
        "{} administrator {username}",
        if created {
            "created"
        } else {
            "reset password for"
        }
    );
    Ok(())
}

/// Env- and stdin-independent core of [`create_admin`]. Returns `true` when a
/// new account was created, `false` when an existing administrator's password
/// was reset.
async fn create_admin_with(
    user_repo: &Arc<dyn playarr_db::UserRepo>,
    policy_repo: &Arc<dyn playarr_db::PolicyRepo>,
    username: &str,
    password: &str,
) -> anyhow::Result<bool> {
    if username.trim().is_empty() {
        anyhow::bail!("username must not be empty");
    }
    if password.len() < 12 {
        anyhow::bail!("password must contain at least 12 characters");
    }
    let hash = playarr_model::Sensitive::new(playarr_auth::login::hash_password(password));

    if let Some(mut user) = user_repo.find_by_username(username).await? {
        let is_admin = policy_repo
            .find_by_id(user.policy_id)
            .await?
            .is_some_and(|policy| policy.is_admin);
        if !is_admin {
            anyhow::bail!("user {username} exists and is not an administrator");
        }
        user.password_hash = hash;
        user_repo.upsert(&user).await?;
        return Ok(false);
    }

    let policy = playarr_model::Policy {
        id: uuid::Uuid::new_v4(),
        name: format!("Administrator ({username})"),
        library_allow: Vec::new(),
        group_library_allow: Vec::new(),
        blocked_folders: Vec::new(),
        max_rating: None,
        blocked_tags: Vec::new(),
        allowed_tags: Vec::new(),
        can_transcode: true,
        can_download: true,
        can_delete: true,
        can_share_public: false,
        can_request: false,
        device_allow: Vec::new(),
        max_concurrent_sessions: None,
        household: Default::default(),
        access_schedule: None,
        can_stream: true,
        is_admin: true,
    };
    policy_repo.upsert(&policy).await?;
    let user = playarr_model::User {
        id: uuid::Uuid::new_v4(),
        username: username.to_string(),
        display_name: username.to_string(),
        email: None,
        password_hash: hash,
        policy_id: policy.id,
        created_at: chrono::Utc::now(),
        disabled: false,
        preferred_audio_language: playarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
    };
    user_repo.upsert(&user).await?;
    Ok(true)
}

async fn serve() -> anyhow::Result<()> {
    let config = Config::from_env()?;
    let _telemetry_guard = playarr_telemetry::init(&config);

    tracing::info!(
        role = %config.role,
        "starting playarr"
    );

    let pool = connect_and_migrate(&config).await?;
    let coordinator = build_coordinator(&config).await?;
    // Shared across roles so a single `all`-role process's playback
    // decisions (`TranscodeOrchestrator`, in `boot_api`) and background
    // throttle checks (`TdarrDispatcher`, in `boot_worker`) agree on how
    // many on-demand sessions are actually active right now.
    let active_sessions = playarr_transcode::ActiveSessionCounter::new();
    // Composition-root-owned registry of configured *arr `SourceInstance`s,
    // shared between the API's request-submission/webhook routes and the
    // worker's reconciliation-poller spawner. Starts empty here -- it's
    // `boot_api` that hydrates it from the real `SourceInstanceRepo`
    // (persisted `SourceInstance` rows) right before constructing
    // `AppState`, so a restart no longer forgets every registered
    // instance. See `playarr_api::SourceInstanceRegistry`'s doc comment
    // for the split between this fast in-memory read path and the durable
    // repo behind it.
    let source_instances = Arc::new(playarr_api::SourceInstanceRegistry::new());

    // Encrypted server backups (docs/architecture/server-backups.md). Off
    // unless `PLAYARR_BACKUP_DIR` is set; a half-configured setup (no valid
    // recovery public key) stops startup rather than silently not backing up.
    let backup_service = match playarr_backup::BackupConfig::from_env()? {
        Some(mut backup_config) => {
            backup_config.artwork_dir = Some(playarr_artwork::artwork_cache_root());
            tracing::info!(
                destination = %backup_config.dir.display(),
                mode = ?backup_config.mode,
                interval_hours = backup_config.interval.map(|i| i.as_secs() / 3600),
                keep_last = backup_config.keep_last,
                offsite_bucket = backup_config.s3.as_ref().map(|s3| s3.bucket.as_str()),
                offsite_prefix = backup_config.s3.as_ref().map(|s3| s3.prefix.as_str()),
                "server backups enabled"
            );
            Some(Arc::new(playarr_backup::BackupService::new(
                backup_config,
                pool.clone(),
                env!("CARGO_PKG_VERSION"),
            )))
        }
        None => None,
    };
    if let (Some(service), true) = (&backup_service, config.role.runs_worker()) {
        // Scheduled runs happen on one node only, behind the leader gate.
        tokio::spawn(run_while_leader(
            coordinator.clone(),
            "server-backup",
            Duration::from_secs(60),
            service.as_ref().clone().run_schedule(),
        ));
    }

    // Connects `boot_api`'s `TranscodeOrchestrator` (an on-demand session
    // starting is the send side) to `boot_worker`'s `TdarrDispatcher` (the
    // receive side) -- see `playarr_transcode`'s module docs, "other
    // bridge" section, for why: it's what promotes a live, temporary
    // on-demand transcode into a durable, Tdarr-produced `Rendition` for
    // future requests. Constructed once here (not inside either `boot_*`
    // function) since both live in the same process for `PLAYARR_ROLE=all`
    // -- the only topology this local `mpsc` channel can bridge; a split
    // api/worker deployment needs a cross-node signal instead (same
    // limitation already noted on `TranscodeOrchestrator::active_children`),
    // not addressed here. If this process doesn't run the worker role, or
    // `TDARR_URL` isn't set, `tdarr_notify_rx` is simply dropped and every
    // `try_send` on the other end harmlessly fails closed.
    let (tdarr_notify_tx, tdarr_notify_rx) =
        tokio::sync::mpsc::channel::<playarr_transcode::MediaFileImportEvent>(64);

    // Playback-activity analytics plumbing, shared across roles the same
    // way `active_sessions`/`source_instances` above are: `analytics`
    // (backing every playback-session/event write) is used by `boot_api`'s
    // `AppState`, while the cluster-wide-singleton background jobs that
    // operate on the same store/registry (`RollupScheduler`,
    // `SessionReaper`, `RetentionSweeper`) run leader-gated inside
    // `boot_worker`. See `playarr_telemetry::analytics::collector`'s
    // module doc comment for the overall architecture.
    let analytics_store: Arc<dyn playarr_db::analytics::AnalyticsStore> =
        Arc::new(playarr_db::analytics::SqlxAnalyticsStore::new(pool.clone()));
    let session_registry: Arc<dyn playarr_telemetry::analytics::SessionRegistry> =
        Arc::new(playarr_telemetry::analytics::InMemorySessionRegistry::new());
    // Drained by `AnalyticsFlusher`, spawned inside `boot_api` -- see that
    // function for why the flusher lives there rather than here: only an
    // API-role process ever calls `AnalyticsCollector::on_event`/
    // `on_session_start` (there's no HTTP handler in the worker role), so
    // it's the only role that ever produces events into this channel.
    let (analytics_event_tx, analytics_event_rx) =
        tokio::sync::mpsc::channel::<playarr_model::PlaybackEvent>(4096);
    let analytics = Arc::new(playarr_telemetry::analytics::AnalyticsCollector::new(
        session_registry.clone(),
        analytics_store.clone(),
        analytics_event_tx,
    ));

    // `playarr-telemetry`'s own docs are explicit that `init` above only
    // covers logging -- the /metrics HTTP listener is real, tested code
    // that this composition root is documented as responsible for
    // spawning, and (until now) never actually did: every deployment
    // config (docker-compose, the Helm chart's Service/ServiceMonitor,
    // this file's own metrics_bind_addr) assumed :9090/metrics answers
    // requests, and it silently didn't -- nothing was listening on that
    // port at all. Spawned unconditionally, before the role branch below,
    // since both api and worker roles expose metrics per the Helm chart.
    let metrics_registry = playarr_telemetry::metrics::MetricsRegistry::new();
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
            coordinator.clone(),
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
                coordinator,
                backup_service,
            )
            .await
        } else {
            tracing::info!(
                "role does not run the public API router; serving only a minimal /healthz listener"
            );
            run_minimal_health_listener(&config).await
        }
    };

    application_listener.await?;

    Ok(())
}

/// Opens the SQLite connection pool for `config.database_url` and applies
/// the embedded migrations. A non-SQLite URL (including `postgres://`) is
/// rejected by `Config::from_env` and again by `playarr_db::connect`.
async fn connect_and_migrate(config: &Config) -> anyhow::Result<DbPool> {
    let pool = playarr_db::connect(&config.database_url).await?;
    playarr_db::run_migrations(&pool).await?;
    Ok(pool)
}

/// Cache + pub/sub backend: in-process (Playarr is SQLite-only, one process
/// per database).
async fn build_cache(_config: &Config) -> anyhow::Result<Arc<dyn playarr_cache::CacheAndPubSub>> {
    Ok(Arc::new(playarr_cache::InMemory::new()))
}

/// Coordination backend: always-leader, in-process locks.
async fn build_coordinator(
    _config: &Config,
) -> anyhow::Result<Arc<dyn playarr_coordination::ClusterCoordinator>> {
    Ok(Arc::new(playarr_coordination::SingleNodeCoordinator::new()))
}

/// Resolves the HS256 secret [`playarr_auth::JwtIssuer`] signs access
/// tokens with, from `PLAYARR_JWT_SECRET`. When it is missing or too short
/// the secret is *derived from this node's persisted identity seed*
/// (`node_identity`, stored in the database) rather than generated fresh at
/// boot, so a deployment that forgot to set the variable still keeps every
/// issued access token valid across restarts and rollouts. Setting
/// `PLAYARR_JWT_SECRET` explicitly stays the recommended configuration
/// (and is required for tokens to be honoured by several nodes).
fn jwt_secret_from_env(identity_seed: &str) -> String {
    match std::env::var("PLAYARR_JWT_SECRET") {
        Ok(secret) if secret.len() >= 32 => secret,
        Ok(_) => {
            tracing::warn!(
                "PLAYARR_JWT_SECRET is shorter than the required 32 bytes; ignoring it and \
                 deriving a stable secret from the persisted node identity instead"
            );
            derived_jwt_secret(identity_seed)
        }
        Err(_) => {
            tracing::warn!(
                "PLAYARR_JWT_SECRET not set; deriving a stable secret from the persisted node \
                 identity so sessions survive restarts. Set PLAYARR_JWT_SECRET explicitly for \
                 any deployment that must honour tokens across multiple nodes."
            );
            derived_jwt_secret(identity_seed)
        }
    }
}

/// Stable (restart-proof) HS256 secret derived from a persisted seed.
fn derived_jwt_secret(identity_seed: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(b"playarr/jwt-hs256-fallback/v1\0");
    hasher.update(identity_seed.as_bytes());
    hex::encode(hasher.finalize())
}

/// `PLAYARR_REFRESH_REUSE_GRACE_SECS`: how long a just-retired refresh
/// token is still honoured (a lost response retried, a second tab racing
/// the first). Defaults to [`playarr_auth::DEFAULT_REUSE_GRACE_SECS`];
/// `0` restores strict single-use rotation.
fn refresh_reuse_grace_from_env() -> chrono::Duration {
    let secs = std::env::var("PLAYARR_REFRESH_REUSE_GRACE_SECS")
        .ok()
        .and_then(|raw| raw.trim().parse::<i64>().ok())
        .filter(|secs| *secs >= 0)
        .unwrap_or(playarr_auth::DEFAULT_REUSE_GRACE_SECS);
    chrono::Duration::seconds(secs)
}

/// How long an on-demand [`playarr_transcode::TranscodeSession`] survives
/// without being accessed before it's eligible for cleanup -- an *idle*
/// deadline (every real manifest/segment request slides it forward, see
/// `TranscodeOrchestrator::lookup_session`'s doc comment), not a cap on how
/// long a single playback can run. `PLAYARR_TRANSCODE_SESSION_IDLE_TTL_SECS`,
/// defaulting to 60s -- long enough that normal HLS segment-fetch cadence
/// (a few seconds apart) never lapses it, short enough that a viewer who
/// closes the tab or loses their connection frees the ffmpeg process and
/// its capacity slot promptly rather than lingering for the lifetime of a
/// much longer default.
fn transcode_session_idle_ttl_from_env() -> std::time::Duration {
    const DEFAULT_SECS: u64 = 60;
    match std::env::var("PLAYARR_TRANSCODE_SESSION_IDLE_TTL_SECS") {
        Ok(raw) => match raw.parse::<u64>() {
            Ok(secs) if secs > 0 => std::time::Duration::from_secs(secs),
            _ => {
                tracing::warn!(
                    value = %raw,
                    "PLAYARR_TRANSCODE_SESSION_IDLE_TTL_SECS is not a positive integer; \
                     falling back to the default of {DEFAULT_SECS}s"
                );
                std::time::Duration::from_secs(DEFAULT_SECS)
            }
        },
        Err(_) => std::time::Duration::from_secs(DEFAULT_SECS),
    }
}

/// Node-local admission for on-demand FFmpeg processes, independent of
/// per-user policy. The semaphore holds each slot for the child lifetime.
fn transcode_max_concurrent_jobs_from_env() -> usize {
    positive_usize_from_env("PLAYARR_TRANSCODE_MAX_CONCURRENT_JOBS", 1)
}

/// Decoder, encoder and filter thread bound for each on-demand FFmpeg job.
fn ffmpeg_threads_from_env() -> usize {
    positive_usize_from_env("PLAYARR_FFMPEG_THREADS", 2)
}

fn positive_usize_from_env(name: &'static str, default: usize) -> usize {
    let Ok(raw) = std::env::var(name) else {
        return default;
    };
    parse_positive_usize(name, &raw, default)
}

fn parse_positive_usize(name: &'static str, raw: &str, default: usize) -> usize {
    match raw.parse::<usize>() {
        Ok(value) if value > 0 => value,
        _ => {
            tracing::warn!(
                variable = name,
                value = %raw,
                default,
                "configuration must be a positive integer; using the safe default"
            );
            default
        }
    }
}

/// How often each `PeerSyncPoller` (`docs/architecture/peer-groups.md`
/// §3.6) runs a full sync cycle against its one peer.
/// `PLAYARR_PEER_SYNC_INTERVAL_SECS`, defaulting to
/// [`playarr_peer_sync::DEFAULT_PEER_SYNC_INTERVAL_SECS`] (60s) -- read
/// here, at the boot boundary, rather than inside `playarr-peer-sync`
/// itself, matching every other `PLAYARR_*_SECS` var in this codebase
/// (e.g. [`transcode_session_idle_ttl_from_env`] just above) and
/// `PeerSyncPoller::new`'s own doc comment, which explains why it takes an
/// already-resolved `Duration` rather than reading the env var itself.
fn peer_sync_interval_secs_from_env() -> Duration {
    let default_secs = playarr_peer_sync::DEFAULT_PEER_SYNC_INTERVAL_SECS;
    match std::env::var("PLAYARR_PEER_SYNC_INTERVAL_SECS") {
        Ok(raw) => match raw.parse::<u64>() {
            Ok(secs) if secs > 0 => Duration::from_secs(secs),
            _ => {
                tracing::warn!(
                    value = %raw,
                    "PLAYARR_PEER_SYNC_INTERVAL_SECS is not a positive integer; falling back \
                     to the default of {default_secs}s"
                );
                Duration::from_secs(default_secs)
            }
        },
        Err(_) => Duration::from_secs(default_secs),
    }
}

/// How many consecutive full-cycle failures a `PeerSyncPoller` tolerates
/// before flipping its peer's `peer_nodes.status` to `Unreachable`
/// (§3.6). `PLAYARR_PEER_UNREACHABLE_THRESHOLD`, defaulting to
/// [`playarr_peer_sync::DEFAULT_PEER_UNREACHABLE_THRESHOLD`] (3) -- same
/// "read at the boot boundary" convention as
/// [`peer_sync_interval_secs_from_env`] just above.
fn peer_sync_unreachable_threshold_from_env() -> u32 {
    let default_threshold = playarr_peer_sync::DEFAULT_PEER_UNREACHABLE_THRESHOLD;
    match std::env::var("PLAYARR_PEER_UNREACHABLE_THRESHOLD") {
        Ok(raw) => match raw.parse::<u32>() {
            Ok(threshold) if threshold > 0 => threshold,
            _ => {
                tracing::warn!(
                    value = %raw,
                    "PLAYARR_PEER_UNREACHABLE_THRESHOLD is not a positive integer; falling \
                     back to the default of {default_threshold}"
                );
                default_threshold
            }
        },
        Err(_) => default_threshold,
    }
}

/// Resolves the id of the account `AuthMode::TrustedNetwork`'s
/// zero-credential auto-login binds to, from
/// `PLAYARR_DEFAULT_ADMIN_USER_ID`. `fallback` is the id
/// [`bootstrap_admin_if_needed`] resolved (either a freshly bootstrapped
/// admin, or the id of an existing admin/user already in the database) --
/// used whenever the env var is unset or doesn't parse.
///
/// Unlike the old boot-lifetime-random-UUID fallback this function used to
/// generate, `fallback` is guaranteed to actually resolve against
/// `AppState::user_directory` (`playarr_api::user_directory::
/// RepoBackedUserDirectory`, backed by the real `UserRepo` -- unlike the
/// in-memory stand-in it replaced, this one only ever resolves ids that are
/// genuinely persisted). A random, nothing-resolves-to-it id would make
/// trusted-network mode's auto-login fail every login attempt.
fn default_admin_user_id_from_env(fallback: uuid::Uuid) -> uuid::Uuid {
    match std::env::var("PLAYARR_DEFAULT_ADMIN_USER_ID") {
        Ok(raw) => match uuid::Uuid::parse_str(&raw) {
            Ok(id) => id,
            Err(err) => {
                tracing::warn!(
                    value = %raw,
                    %err,
                    "PLAYARR_DEFAULT_ADMIN_USER_ID is not a valid UUID; falling back to the \
                     resolved bootstrap admin id instead"
                );
                fallback
            }
        },
        Err(_) => fallback,
    }
}

/// Resolves the directory Playarr Server Admin's built static assets
/// (`index.html` + `assets/`) live in, so `boot_api` can co-host the UI on
/// the same origin/port as the API -- see [`playarr_api::build_router`]'s
/// `web_assets_dir` doc comment for why that's the goal (parity with how
/// every `*arr` app ships its own UI, rather than requiring a separately
/// hosted web client pointed at this API).
///
/// `PLAYARR_WEB_ASSETS_DIR` wins if set. Otherwise defaults to a `web/`
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
    let candidate = match std::env::var("PLAYARR_WEB_ASSETS_DIR") {
        Ok(raw) => std::path::PathBuf::from(raw),
        Err(_) => std::env::current_exe().ok()?.parent()?.join("web"),
    };

    if candidate.join("index.html").is_file() {
        Some(candidate)
    } else {
        tracing::info!(
            path = %candidate.display(),
            "no built web UI found at this path; serving API only. Set PLAYARR_WEB_ASSETS_DIR, \
             or build clients/tv-web/admin and place its dist/ output there, to co-host Playarr Server Admin."
        );
        None
    }
}

/// Resolves the directory holding the Playarr Web client built for server
/// hosting (`pnpm --filter @playarr-tv/web run build:server`), served at
/// `/tv/` by the server itself so a TV that can only reach an `http://`
/// server (VIDAA) loads the app over the same scheme -- no mixed content.
///
/// `PLAYARR_TV_ASSETS_DIR` wins if set; otherwise `web/tv/` next to the
/// executable (where the image and release tarball ship it, inside the web
/// dir). `None` (nothing mounted) when there is no `index.html`.
fn tv_assets_dir_from_env() -> Option<std::path::PathBuf> {
    let candidate = match std::env::var("PLAYARR_TV_ASSETS_DIR") {
        Ok(raw) => std::path::PathBuf::from(raw),
        Err(_) => std::env::current_exe()
            .ok()?
            .parent()?
            .join("web")
            .join("tv"),
    };
    candidate.join("index.html").is_file().then_some(candidate)
}

/// The page a TV's QR code / on-screen address points the approving phone at.
/// `PLAYARR_DEVICE_VERIFICATION_URI` wins. Otherwise, when the server serves the
/// web client itself (`/tv/`), the approval page is that server's own `/tv/link`,
/// which is same-origin with the server and so works over plain `http://` (an
/// https page cannot call an http server). Without the bundled client it stays
/// `/link` as before.
fn device_verification_base_uri(configured: Option<String>, tv_client_mounted: bool) -> String {
    configured.unwrap_or_else(|| {
        if tv_client_mounted {
            "/tv/link"
        } else {
            "/link"
        }
        .to_string()
    })
}

/// Resolves the operator's configured login trust tier
/// (`PLAYARR_AUTH_MODE` -- `full-account` (the default as of this pass)
/// or `trusted-network`, opt-in only) for `POST /api/v1/auth/login`.
///
/// **Why the default flipped from `trusted-network` to `full-account`:**
/// real username/password accounts now have a real, always-available,
/// durable persistence layer (`playarr_db::UserRepo`/`PolicyRepo`) and
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
/// explicitly opt in with `PLAYARR_AUTH_MODE=trusted-network` rather than
/// being handed out to anyone who reaches the socket by default.
fn auth_mode_from_env(admin_user_id: uuid::Uuid) -> playarr_auth::AuthMode {
    use playarr_auth::AuthMode;

    match std::env::var("PLAYARR_AUTH_MODE") {
        Ok(value) if value == "trusted-network" => trusted_network_auth_mode(admin_user_id),
        Ok(value) if value == "full-account" => {
            tracing::info!(
                "PLAYARR_AUTH_MODE=full-account: POST /api/v1/auth/login requires a real \
                 username/password for every login -- see bootstrap_admin_if_needed's doc \
                 comment for how this deployment's first admin account gets provisioned."
            );
            AuthMode::FullAccount
        }
        Ok(other) => {
            tracing::warn!(
                value = %other,
                "unrecognized PLAYARR_AUTH_MODE (expected full-account or trusted-network); \
                 falling back to full-account, the default"
            );
            AuthMode::FullAccount
        }
        Err(_) => {
            tracing::info!(
                "PLAYARR_AUTH_MODE not set; defaulting to full-account -- set \
                 PLAYARR_AUTH_MODE=trusted-network to opt into IP-based zero-credential \
                 auto-admin instead (see trusted_network_auth_mode's doc comment for the \
                 tradeoff before doing so)."
            );
            AuthMode::FullAccount
        }
    }
}

/// The RFC 1918 private-address ranges plus loopback -- what "trusted home
/// LAN" actually means. This, not `0.0.0.0/0`, is the default allowlist
/// [`trusted_network_auth_mode`] builds when `PLAYARR_TRUSTED_NETWORK_CIDR`
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
/// operator explicitly opts in with `PLAYARR_AUTH_MODE=trusted-network`
/// (see [`auth_mode_from_env`]'s doc comment for why this is no longer the
/// implicit default): `PLAYARR_TRUSTED_NETWORK_CIDR`, if set, replaces
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
/// operator. For those cases, narrow `PLAYARR_TRUSTED_NETWORK_CIDR` to
/// the actual trusted subnet, switch to `PLAYARR_AUTH_MODE=full-account`
/// (see that mode's own documented gap above), or put a real authenticating
/// reverse proxy in front of it.
fn trusted_network_auth_mode(admin_user_id: uuid::Uuid) -> playarr_auth::AuthMode {
    use playarr_auth::{AuthMode, TrustedNetwork};

    let configured_cidr = std::env::var("PLAYARR_TRUSTED_NETWORK_CIDR").ok();
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
        "PLAYARR_AUTH_MODE=trusted-network (explicitly opted into): every request whose \
         source IP falls inside this allowlist auto-logs in as the default admin user with \
         zero credentials -- see trusted_network_auth_mode's doc comment for the real security \
         implications before exposing this server beyond a genuinely trusted network"
    );

    AuthMode::TrustedNetwork { allowlist }
}

/// The bootstrap admin username used when `PLAYARR_BOOTSTRAP_ADMIN_USERNAME`
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
/// If [`playarr_db::UserRepo::list_all`] already returns at least one
/// row, this is a no-op: returns the id of an existing admin (found by
/// checking each user's `Policy::is_admin`), or, if none of them is an
/// admin, the first user found at all -- either way, [`default_admin_user_id_from_env`]
/// still has a real, resolvable fallback id for `AuthMode::TrustedNetwork`
/// to bind to if that mode is explicitly opted into.
///
/// Otherwise, provisions exactly one admin account: reads
/// `PLAYARR_BOOTSTRAP_ADMIN_USERNAME` (default `"admin"`) and
/// `PLAYARR_BOOTSTRAP_ADMIN_PASSWORD`. When the password env var is
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
    user_repo: &Arc<dyn playarr_db::UserRepo>,
    policy_repo: &Arc<dyn playarr_db::PolicyRepo>,
) -> anyhow::Result<uuid::Uuid> {
    let username = std::env::var("PLAYARR_BOOTSTRAP_ADMIN_USERNAME")
        .unwrap_or_else(|_| DEFAULT_BOOTSTRAP_ADMIN_USERNAME.to_string());
    let explicit_password = std::env::var("PLAYARR_BOOTSTRAP_ADMIN_PASSWORD").ok();
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
    user_repo: &Arc<dyn playarr_db::UserRepo>,
    policy_repo: &Arc<dyn playarr_db::PolicyRepo>,
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

    let policy = playarr_model::Policy {
        id: uuid::Uuid::new_v4(),
        name: "Bootstrap Admin".to_string(),
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
        // Deliberately no Playarr access -- this account exists to run
        // Playarr Server's own admin surface, not as a household viewer
        // account. See `Policy::can_stream`'s doc comment: `is_admin`
        // does not imply it. An operator who also wants to use Playarr
        // day to day should provision (or grant `can_stream` on) a
        // separate account via the Users admin screen.
        can_stream: false,
        is_admin: true,
    };
    policy_repo.upsert(&policy).await?;

    let user = playarr_model::User {
        id: uuid::Uuid::new_v4(),
        username: username.to_string(),
        display_name: username.to_string(),
        email: None,
        password_hash: playarr_model::Sensitive::new(playarr_auth::login::hash_password(&password)),
        policy_id: policy.id,
        created_at: chrono::Utc::now(),
        disabled: false,
        preferred_audio_language: playarr_model::DEFAULT_PREFERRED_AUDIO_LANGUAGE.to_string(),
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
            "bootstrap admin created using PLAYARR_BOOTSTRAP_ADMIN_PASSWORD from the \
             environment -- save it now if you haven't already, it will not be logged again"
        );
    }

    Ok(user_id)
}

/// A real, randomly generated bootstrap admin password: two concatenated
/// v4 UUIDs' hex digits (64 characters, the same generation idiom
/// this file already uses for the same
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

#[allow(clippy::too_many_arguments)]
async fn boot_api(
    config: &Config,
    pool: DbPool,
    source_instances: Arc<playarr_api::SourceInstanceRegistry>,
    active_sessions: playarr_transcode::ActiveSessionCounter,
    tdarr_notify_tx: tokio::sync::mpsc::Sender<playarr_transcode::MediaFileImportEvent>,
    analytics_store: Arc<dyn playarr_db::analytics::AnalyticsStore>,
    session_registry: Arc<dyn playarr_telemetry::analytics::SessionRegistry>,
    analytics: Arc<playarr_telemetry::analytics::AnalyticsCollector>,
    analytics_event_rx: tokio::sync::mpsc::Receiver<playarr_model::PlaybackEvent>,
    coordinator: Arc<dyn playarr_coordination::ClusterCoordinator>,
    backup_service: Option<Arc<playarr_backup::BackupService>>,
) -> anyhow::Result<()> {
    use playarr_api::user_directory::RepoBackedUserDirectory;
    use playarr_api::{
        admin_peer, AppState, ClientCompatibilityTable, ReadinessState, RepoBackedMediaFileLookup,
        VersionGateLayer, VersionState,
    };
    use playarr_auth::{
        DashMapDeviceFlowHandler, DeviceFlowConfig, DeviceFlowHandler, InMemoryAdminRegistry,
        InMemoryDeviceAuthorizationStore, JwtIssuer, RefreshTokenService, RefreshTokenStore,
        UserDirectory,
    };
    use playarr_db::repo::{
        seed_default_rails, seed_default_views, SqlxCreditRepo, SqlxDeviceRepo,
        SqlxDownloadTicketRepo, SqlxGroupLibraryRepo, SqlxLibraryViewRepo, SqlxMediaFileRepo,
        SqlxNodeIdentityRepo, SqlxPeerGroupRepo, SqlxPeerJoinTokenRepo,
        SqlxPeerLeafAvailabilityRepo, SqlxPeerNodeRepo, SqlxPeerSourceInstanceRepo,
        SqlxPeerSyncStateRepo, SqlxPlaylistRepo, SqlxPolicyRepo, SqlxProfilePinRepo,
        SqlxPushRegistrationRepo, SqlxRefreshTokenRepo, SqlxRenditionRepo, SqlxRoutingRuleRepo,
        SqlxSourceInstanceRepo, SqlxSyncConflictLogRepo, SqlxSystemSettingsRepo,
        SqlxTdarrConnectionRepo, SqlxUserInviteRepo, SqlxUserInviteRequestRepo, SqlxUserRepo,
        SqlxWatchProgressRepo, SqlxWorkRepo,
    };
    use playarr_db::{
        CreditRepo, DeviceRepo, DownloadTicketRepo, GroupLibraryRepo, LibraryViewRepo,
        MediaFileRepo, NodeIdentityRepo, PeerGroupRepo, PeerJoinTokenRepo,
        PeerLeafAvailabilityRepo, PeerNodeRepo, PeerSourceInstanceRepo, PeerSyncStateRepo,
        PlaylistRepo, PolicyRepo, ProfilePinRepo, PushRegistrationRepo, RenditionRepo,
        RoutingRuleRepo, SourceInstanceRepo, SyncConflictLogRepo, SystemSettingsRepo,
        TdarrConnectionRepo, UserInviteRepo, UserInviteRequestRepo, UserRepo, WatchProgressRepo,
        WorkRepo,
    };
    use playarr_model::{VersionEnvelope, DEFAULT_INSTANCE_NAME};

    let compatibility_table = ClientCompatibilityTable::from_toml_str(CLIENT_COMPATIBILITY_TOML)?;

    let version_envelope = VersionEnvelope {
        instance_name: DEFAULT_INSTANCE_NAME.to_string(),
        server_version: compatibility_table.server.version.clone(),
        api_version: compatibility_table.server.api_version.clone(),
        build_sha: option_env!("PLAYARR_BUILD_SHA").map(str::to_string),
        // The per-platform compatibility rows aren't projected from
        // `compatibility_table` into `playarr_model::CompatibilityEntry`
        // yet (that mapping needs the version-code-vs-semver comparison
        // logic `version_gate::evaluate` is also waiting on) — an empty
        // list here is honest about that rather than fabricating entries.
        compatibility: Vec::new(),
    };

    let readiness = ReadinessState::new();

    let cache = build_cache(config).await?;

    // Every write to these repositories also publishes a live event
    // (`GET /api/v1/events`, docs/architecture/live-events.md).
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
    let calendar_feed_token_repo: Arc<dyn playarr_db::CalendarFeedTokenRepo> =
        Arc::new(playarr_db::SqlxCalendarFeedTokenRepo::new(pool.clone()));
    let availability_event_repo: Arc<dyn playarr_db::AvailabilityEventRepo> =
        Arc::new(playarr_db::SqlxAvailabilityEventRepo::new(pool.clone()));
    let push_registration_repo: Arc<dyn PushRegistrationRepo> =
        Arc::new(SqlxPushRegistrationRepo::new(pool.clone()));
    let push_notifier: Arc<dyn playarr_api::notifications::PushNotifier> =
        match std::env::var("GOOGLE_APPLICATION_CREDENTIALS") {
            Ok(path) => Arc::new(
                playarr_api::notifications::FcmNotifier::from_service_account_file(path)
                    .map_err(anyhow::Error::msg)?,
            ),
            Err(_) => playarr_api::notifications::disabled_notifier(),
        };
    let firebase_web_config = std::env::var("PLAYARR_FIREBASE_WEB_CONFIG")
        .ok()
        .map(|value| serde_json::from_str(&value))
        .transpose()
        .map_err(|err| anyhow::anyhow!("invalid PLAYARR_FIREBASE_WEB_CONFIG JSON: {err}"))?;
    let profile_pin_repo: Arc<dyn ProfilePinRepo> = Arc::new(SqlxProfilePinRepo::new(pool.clone()));
    let household_repo = Arc::new(playarr_db::SqlxHouseholdRepo::new(pool.clone()));
    let household = Arc::new(playarr_api::household::HouseholdState::new(
        household_repo.clone(),
        household_repo.clone(),
        household_repo,
        Arc::new(playarr_api::household::SystemClock),
    ));
    let policy_repo: Arc<dyn PolicyRepo> = Arc::new(SqlxPolicyRepo::new(pool.clone()));
    let home_rails_cache = Arc::new(playarr_api::home_rails::HomeRailsCache::new(cache.clone()));
    let watch_progress: Arc<dyn WatchProgressRepo> =
        Arc::new(playarr_db::EventingWatchProgressRepo::new(
            Arc::new(playarr_api::home_rails::InvalidatingWatchProgressRepo::new(
                Arc::new(SqlxWatchProgressRepo::new(pool.clone())),
                home_rails_cache.clone(),
            )),
            live_events.clone(),
        ));
    let download_tickets: Arc<dyn DownloadTicketRepo> =
        Arc::new(playarr_db::EventingDownloadTicketRepo::new(
            Arc::new(SqlxDownloadTicketRepo::new(pool.clone())),
            live_events.clone(),
        ));
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
    let home_rail_repo: Arc<dyn playarr_db::HomeRailRepo> =
        Arc::new(playarr_db::SqlxHomeRailRepo::new(pool.clone()));
    // Idempotent: one default rail per (kind, library) where it makes sense,
    // never overwriting an admin's edits or ordering.
    if let Err(err) = seed_default_rails(home_rail_repo.as_ref()).await {
        tracing::error!(%err, "failed to seed default home rails; Home will show no server rails until this is investigated");
    }
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
    let request_sync = Arc::new(playarr_api::request_sync::RequestSync::new(
        Arc::new(playarr_db::SqlxMediaRequestRepo::new(pool.clone())),
        Arc::new(playarr_db::SqlxRequestIntegrationRepo::new(pool.clone())),
        user_repo.clone(),
        work_repo.clone(),
    ));
    for (kind, url_env, key_env) in [
        (
            playarr_model::requests::IntegrationKind::Ombi,
            "PLAYARR_OMBI_URL",
            "PLAYARR_OMBI_API_KEY",
        ),
        (
            playarr_model::requests::IntegrationKind::Seerr,
            "PLAYARR_SEERR_URL",
            "PLAYARR_SEERR_API_KEY",
        ),
    ] {
        if let Some(url) = std::env::var(url_env).ok().filter(|u| !u.trim().is_empty()) {
            match request_sync.ensure_declared(kind, &url, key_env).await {
                Ok(true) => tracing::info!(kind = kind.as_str(), "registered request integration"),
                Ok(false) => {}
                Err(err) => tracing::warn!(%err, "could not register request integration"),
            }
        }
    }
    let credit_repo: Arc<dyn CreditRepo> = Arc::new(SqlxCreditRepo::new(pool.clone()));
    let tdarr_connection_repo: Arc<dyn TdarrConnectionRepo> =
        Arc::new(SqlxTdarrConnectionRepo::new(pool.clone()));
    let system_settings_repo: Arc<dyn SystemSettingsRepo> =
        Arc::new(SqlxSystemSettingsRepo::new(pool.clone()));
    // Phase 1 of `docs/architecture/peer-groups.md` -- byte-for-byte inert
    // for a single, ungrouped node (every table nullable/empty until an
    // admin actually founds or joins a group via `playarr_api::admin_peer`).
    let node_identity_repo: Arc<dyn NodeIdentityRepo> =
        Arc::new(SqlxNodeIdentityRepo::new(pool.clone()));
    let peer_group_repo: Arc<dyn PeerGroupRepo> = Arc::new(SqlxPeerGroupRepo::new(pool.clone()));
    let peer_node_repo: Arc<dyn PeerNodeRepo> = Arc::new(SqlxPeerNodeRepo::new(pool.clone()));
    let peer_join_token_repo: Arc<dyn PeerJoinTokenRepo> =
        Arc::new(SqlxPeerJoinTokenRepo::new(pool.clone()));
    let group_library_repo: Arc<dyn GroupLibraryRepo> =
        Arc::new(SqlxGroupLibraryRepo::new(pool.clone()));
    // Operator-configured routing policy (`docs/architecture/
    // peer-groups.md` §2.4) -- `peer::routing_rules_handler`'s own read,
    // `routing_sync.rs` (`playarr-peer-sync`, wired below in
    // `boot_worker`) is the other side's writer.
    let routing_rule_repo: Arc<dyn RoutingRuleRepo> =
        Arc::new(SqlxRoutingRuleRepo::new(pool.clone()));
    // Read-only, per-peer leaf availability cache (`docs/architecture/
    // peer-groups.md` §2.3/§4.3) -- `availability_sync.rs`
    // (`playarr-peer-sync`) is its only writer; the API role only ever
    // reads it, both via `CatalogService`'s browse/get_by_id hydration
    // below and, directly off `AppState` (Phase 3), Playarr's own routing-
    // context gathering (`playarr_api::playback::
    // resolve_route_for_local_media_file`/`by_external_ref_playback_info_handler`,
    // §5.2) -- hence the clone before this `Arc` is moved into `catalog`.
    let peer_leaf_availability_repo: Arc<dyn PeerLeafAvailabilityRepo> =
        Arc::new(SqlxPeerLeafAvailabilityRepo::new(pool.clone()));
    let peer_source_instance_repo: Arc<dyn PeerSourceInstanceRepo> =
        Arc::new(SqlxPeerSourceInstanceRepo::new(pool.clone()));
    let peer_sync_state_repo: Arc<dyn PeerSyncStateRepo> =
        Arc::new(SqlxPeerSyncStateRepo::new(pool.clone()));
    let sync_conflict_log_repo: Arc<dyn SyncConflictLogRepo> =
        Arc::new(SqlxSyncConflictLogRepo::new(pool.clone()));
    let peer_leaf_availability_repo_for_state = peer_leaf_availability_repo.clone();
    // Mint (or load) this installation's own durable Ed25519 identity
    // before `state` (and therefore the router) is ever constructed -- the
    // same "guarantee it exists before serving traffic" treatment
    // `bootstrap_admin_if_needed` gives the bootstrap admin account below.
    // `ensure_node_identity` only ever mints a fresh `peer_id`/keypair when
    // no row exists yet; an existing row (including its `group_id`) is
    // always loaded as-is, never regenerated or overwritten -- a redeploy
    // must not desync group state. See `docs/architecture/peer-groups.md`
    // §2.1.
    let node_identity = admin_peer::ensure_node_identity(&node_identity_repo)
        .await
        .map_err(|err| anyhow::anyhow!("failed to ensure node identity: {}", err.body.message))?;
    tracing::info!(
        peer_id = %node_identity.peer_id,
        grouped = node_identity.group_id.is_some(),
        "node identity ready"
    );
    // Optional operator convenience: pre-fill `PUT /api/v1/admin/
    // peer-nodes/self`'s in-memory staging cell from `PLAYARR_NODE_NAME`
    // so a fresh install doesn't have to retype its own name before
    // founding/joining a group. Never written to `node_identity` itself
    // (that table has no name column -- see §2.1's schema) and never
    // consulted once this node is actually grouped (a real, persisted self
    // `PeerNode` row exists by then -- see `PendingSelfPeerProfile`'s doc
    // comment). Purely additive: unset (the default), this is exactly
    // `None`, identical to today's behavior.
    let pending_self_peer_profile = if node_identity.group_id.is_none() {
        std::env::var("PLAYARR_NODE_NAME")
            .ok()
            .filter(|name| !name.is_empty())
            .map(|name| admin_peer::PendingSelfPeerProfile {
                name,
                addresses: Vec::new(),
            })
    } else {
        None
    };
    // Durable, not `InMemoryRefreshTokenStore` -- see
    // `playarr_db::repo::refresh_token`'s doc comment: without this, a
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
    source_urls::reconcile_from_env(&source_instance_repo).await;
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

    let media_files: Arc<dyn playarr_api::MediaFileLookup> =
        Arc::new(RepoBackedMediaFileLookup::new(media_file_repo.clone()));

    // The API role only ever *reads* cached embeddings (`GET /api/v1/
    // catalog/{id}/similar` brute-force cosine-scans `embedding_repo`); it
    // never loads the actual `playarr_embeddings::Embedder` model itself
    // -- that's the worker role's job (see `spawn_poller_for`'s
    // `embedding_sync` wiring below). A work with no cached embedding yet
    // (not synced, or the worker hasn't loaded its model) just 404s from
    // `similar` (see that method's doc comment) -- there's nothing to
    // gate at boot here.
    let embedding_repo: Arc<dyn playarr_db::EmbeddingRepo> =
        Arc::new(playarr_db::repo::SqlxEmbeddingRepo::new(pool.clone()));
    let media_language_repo: Arc<dyn playarr_db::MediaLanguageRepo> =
        Arc::new(playarr_db::repo::SqlxMediaLanguageRepo::new(pool.clone()));
    let catalog = Arc::new(
        playarr_catalog::CatalogService::new(
            work_repo.clone(),
            media_file_repo.clone(),
            cache.clone(),
            pool.clone(),
            watch_progress.clone(),
        )
        .with_embedding_repo(embedding_repo)
        .with_media_language_repo(media_language_repo.clone())
        .with_peer_leaf_availability(peer_leaf_availability_repo, peer_node_repo.clone()),
    );

    let transcode = Arc::new(
        playarr_transcode::TranscodeOrchestrator::new(rendition_repo, cache, active_sessions)
            .with_output_root(std::env::temp_dir().join("playarr-transcode"))
            .with_session_ttl(transcode_session_idle_ttl_from_env())
            .with_max_concurrent_sessions(transcode_max_concurrent_jobs_from_env())
            .with_ffmpeg_threads(ffmpeg_threads_from_env())
            .with_tdarr_notify(tdarr_notify_tx),
    );

    let jwt_secret = jwt_secret_from_env(node_identity.private_key.expose_secret());
    // `with_group_identity` (`docs/architecture/peer-groups.md` §5.4):
    // switches this node's own access-token issuance to EdDSA (signed with
    // its `node_identity` Ed25519 keypair, `iss` = its own `peer_id`) once
    // `node_identity.group_id.is_some()`, and always wires `peer_node_repo`
    // so `verify_access_token` can resolve *other* peers' public keys for
    // tokens minted elsewhere in the group. Called unconditionally -- for
    // an ungrouped node this is a no-op for issuance (HS256 stays the
    // default, byte-for-byte today's behavior) and only pre-wires the repo
    // in case this node joins a group later without a restart.
    let jwt = Arc::new(
        JwtIssuer::new(
            jwt_secret.as_bytes(),
            "playarr",
            chrono::Duration::minutes(15),
        )
        .with_group_identity(&node_identity, peer_node_repo.clone()),
    );
    let refresh = Arc::new(
        RefreshTokenService::new(
            refresh_store,
            device_repo,
            jwt.clone(),
            chrono::Duration::days(30),
        )
        .with_reuse_grace(refresh_reuse_grace_from_env())
        // TASKS 115: refreshing a PIN-locked profile needs an unlock lease
        // (granted by login or the PIN unlock endpoint, slid by refresh).
        .with_pin_lease(profile_pin_repo.clone(), chrono::Duration::minutes(30)),
    );
    let device_flow: Arc<dyn DeviceFlowHandler> = Arc::new(DashMapDeviceFlowHandler::new(
        Arc::new(InMemoryDeviceAuthorizationStore::new()),
        refresh.clone(),
        DeviceFlowConfig {
            code_ttl: chrono::Duration::minutes(5),
            polling_interval: chrono::Duration::seconds(5),
            verification_base_uri: device_verification_base_uri(
                std::env::var("PLAYARR_DEVICE_VERIFICATION_URI").ok(),
                tv_assets_dir_from_env().is_some(),
            ),
            refresh_ttl: chrono::Duration::days(30),
        },
    ));

    // -- Real, durable user/policy persistence + login wiring --
    // `user_repo`/`policy_repo` (constructed above) replace the old
    // `playarr_auth::login::InMemoryUserDirectory`/`admin_registry`
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
    let webhook = Arc::new(playarr_arr_sync::WebhookReceiver::new(webhook_tx));

    // Phase 3 (`docs/architecture/peer-groups.md` §5.2/§5.3): one shared,
    // pooled `reqwest::Client` for every outbound node-to-node call this
    // process's *own request handlers* make directly (`playback::
    // forward_negotiation_to_peer`'s signed negotiation forward,
    // `media::proxy_stream_media_handler`'s signed `Range`-preserving byte
    // stream) -- constructed once here, not per request, same "construct
    // once, `Arc`-cheap-clone everywhere" treatment `boot_worker`'s own
    // `peer_http_client` already gets for its background `PeerSyncPoller`s.
    // Deliberately a *separate* `reqwest::Client` instance from that one:
    // this is the API role's own client, `boot_worker`'s is the worker
    // role's -- the same two-roles-can-run-in-different-processes split
    // `PLAYARR_ROLE=api`/`worker` already makes everywhere else.
    let peer_transport_routes = playarr_peer_sync::peer_client::PeerTransportRoutes::from_env()?;
    let peer_http = peer_transport_routes.build_client().await?;

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
        home_rail_repo,
        home_rails_cache,
        playlist_repo,
        watchlist_repo,
        resume_dismissals,
        discovery_requests_allow_all_users: std::env::var("PLAYARR_REQUESTS_ALLOW_ALL_USERS")
            .is_ok_and(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes")),
        request_sync: request_sync.clone(),
        work_repo,
        credit_repo,
        tdarr_connection_repo,
        system_settings_repo,
        backup: backup_service,
        media_files,
        watch_progress,
        download_tickets,
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
        household,
        policy_repo,
        sessions: refresh,
        refresh_ttl: chrono::Duration::days(30),
        node_id: uuid::Uuid::new_v4().to_string(),
        analytics_store: analytics_store.clone(),
        session_registry,
        playback_session_routes: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        analytics,
        node_identity_repo,
        peer_group_repo,
        peer_node_repo,
        peer_join_token_repo,
        pending_self_peer_profile: Arc::new(std::sync::Mutex::new(pending_self_peer_profile)),
        group_library_repo,
        media_file_repo,
        routing_rule_repo,
        peer_leaf_availability_repo: peer_leaf_availability_repo_for_state,
        peer_source_instance_repo,
        peer_sync_state_repo,
        sync_conflict_log_repo,
        coordinator,
        peer_http,
        peer_transport_routes,
        request_timing: Arc::new(playarr_telemetry::request_timing::RequestTimingRegistry::new()),
        remote_repo: Arc::new(playarr_db::repo::SqlxRemoteRepo::new(pool.clone())),
        live_events,
        calendar_cache: Arc::new(playarr_api::calendar::CalendarCache::new()),
        portability: Arc::new(playarr_api::portability::ExportRegistry::new()),
        calendar_feed_token_repo,
        availability_event_repo,
        folder_repo: Arc::new(playarr_db::SqlxFolderRepo::new(pool.clone())),
    };
    let version_gate = VersionGateLayer::new(compatibility_table);

    // Must run on every node that runs this (the API) role -- not
    // leader-gated. The event channel is a local, in-process `mpsc` fed
    // only by this same node's own `AnalyticsCollector` (via the playback
    // handlers this router just got wired with above), so each node has
    // its own buffered events that only it can flush; gating this behind
    // leadership would silently drop every non-leader node's events. See
    // `playarr_telemetry::analytics::flusher`'s module doc comment.
    let analytics_flusher = playarr_telemetry::analytics::AnalyticsFlusher::new(
        analytics_store,
        analytics_event_rx,
        std::time::Duration::from_secs(3),
        500,
    );
    tokio::spawn(analytics_flusher.run());

    // Audio/subtitle language index backfill (task 180): ffprobe for files
    // the *arr app could not describe, plus periodic sidecar subtitle scans.
    // Runs where the media is readable (the API role); idempotent, so
    // replicas may overlap. `PLAYARR_LANGUAGE_INDEXER=off` disables it.
    if !std::env::var("PLAYARR_LANGUAGE_INDEXER").is_ok_and(|v| v.eq_ignore_ascii_case("off")) {
        tokio::spawn(playarr_api::language_index::run_language_indexer(
            media_language_repo.clone(),
        ));
    }

    // Push complements the worker's normal pull pollers. Running it in the
    // API role gives a node with outbound-only connectivity a signed path to
    // publish its local changes to a reachable peer; that same node's worker
    // still pulls the peer's changes in the opposite direction.
    let push_identity = playarr_peer_sync::PeerIdentity::from_seed_b64(
        node_identity.peer_id,
        node_identity.private_key.expose_secret(),
    )
    .map_err(|err| anyhow::anyhow!("failed to load peer identity for push sync: {err}"))?;
    let push_client = playarr_peer_sync::PeerClient::new_with_routes(
        state.peer_http.clone(),
        push_identity,
        state.peer_transport_routes.clone(),
    );
    tokio::spawn(playarr_api::peer::run_push_sync_loop(
        state.clone(),
        push_client,
        peer_sync_interval_secs_from_env(),
    ));

    // Stop ffmpeg processes whose session went idle (closed tab, replaced
    // player session): the cache row expires on its own, the process does not.
    tokio::spawn(
        state
            .transcode
            .clone()
            .run_idle_reaper(std::time::Duration::from_secs(15)),
    );

    // Keep Dubarr dub-track lookups fresh by watching each instance's change feed.
    tokio::spawn(playarr_api::request_sync::run_scheduler(
        request_sync.clone(),
    ));
    tokio::spawn(playarr_api::dubarr_audio::run_change_poller(
        state.source_instances.clone(),
    ));

    // Unsorted folders: discover root folders from the sources and keep each
    // enabled root's scan cache current. Runs where the media is readable
    // (the API role); a per-root in-flight guard keeps overlapping scans out.
    tokio::spawn(playarr_api::folder_scan::run_folder_scanner(state.clone()));

    let (router, _openapi) = playarr_api::build_router_with_tv(
        state,
        version_gate,
        web_assets_dir_from_env(),
        tv_assets_dir_from_env(),
    );

    let relay_runtime = match &config.relay {
        Some(settings) => {
            let identity = playarr_peer_sync::PeerIdentity::from_seed_b64(
                node_identity.peer_id,
                node_identity.private_key.expose_secret(),
            )
            .map_err(|err| {
                anyhow::anyhow!("failed to load peer identity for relay registration: {err}")
            })?;
            let challenges = Arc::new(relay::ChallengeStore::default());
            let client = Arc::new(relay::RelayClient::new(
                &settings.base_url,
                settings.public_ipv4,
                identity,
                challenges.clone(),
            )?);
            Some(relay::RelayRuntime { challenges, client })
        }
        None => None,
    };

    serve_application_router(config, router, Some(readiness), relay_runtime).await
}

/// Serves an application router over exactly one configured transport:
/// automatic ACME HTTPS, static-certificate HTTPS, or plain HTTP. The ACME
/// state is continuously polled for the lifetime of the process, so renewed
/// certificates are installed into the shared rustls resolver without a
/// Playarr Server restart.
///
/// `POST /api/v1/auth/login`'s `AuthMode::TrustedNetwork` tier needs the
/// caller's real source IP (`ConnectInfo`) to decide whether to auto-login.
/// Every transport therefore uses `into_make_service_with_connect_info`.
async fn serve_application_router(
    config: &Config,
    router: axum::Router,
    readiness: Option<playarr_api::ReadinessState>,
    relay: Option<relay::RelayRuntime>,
) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind(config.http_bind_addr).await?;
    let router = match &relay {
        Some(runtime) => router.merge(relay::well_known_router(runtime.challenges.clone())),
        None => router,
    };
    if let Some(runtime) = &relay {
        let client = runtime.client.clone();
        tokio::spawn(async move {
            // Give the listener a moment to accept the Worker's callback.
            tokio::time::sleep(Duration::from_secs(2)).await;
            relay::run_registration_loop(client).await
        });
    }
    let relay_challenges = relay.as_ref().map(|runtime| runtime.challenges.clone());

    if let Some(acme) = config
        .acme
        .as_ref()
        .filter(|acme| acme.challenge == playarr_config::AcmeChallenge::RelayDns01)
    {
        let runtime = relay
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("relay-dns-01 requires relay registration"))?;
        if let Some(tls) = &config.tls {
            return serve_relay_dns01_with_static_tls(
                config, acme, tls, runtime, listener, router, readiness,
            )
            .await;
        }
        return serve_relay_dns01(config, acme, runtime, listener, router, readiness).await;
    }

    if let Some(acme) = &config.acme {
        use futures::StreamExt;
        use rustls_acme::{AcmeConfig, EventOk, UseChallenge};

        // HTTP-01 intentionally gets its own listener. It never exposes the
        // Playarr Server API over cleartext: challenge paths stay local and every
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
        )
        .with_relay_challenges(relay_challenges);
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
        // cert-manager (or any renewer) replaces these files in place; pick
        // the new certificate up without restarting the server.
        tokio::spawn(watch_static_tls(
            tls_config.clone(),
            tls.cert_path.clone(),
            tls.key_path.clone(),
            STATIC_TLS_RELOAD_INTERVAL,
        ));
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

/// How often the static certificate files are checked for replacement.
const STATIC_TLS_RELOAD_INTERVAL: Duration = Duration::from_secs(60);

/// Reads the certificate and key files and, when either differs from
/// `last`, reloads them into `config`. Returns whether a reload happened.
/// A missing, half-written or invalid pair keeps the previous certificate
/// serving and is retried on the next call, because a renewer may update the
/// two files at different moments.
async fn reload_static_tls_if_changed(
    config: &axum_server::tls_rustls::RustlsConfig,
    cert_path: &std::path::Path,
    key_path: &std::path::Path,
    last: &mut Option<(Vec<u8>, Vec<u8>)>,
) -> bool {
    let (cert, key) = match (
        tokio::fs::read(cert_path).await,
        tokio::fs::read(key_path).await,
    ) {
        (Ok(cert), Ok(key)) => (cert, key),
        (Err(err), _) | (_, Err(err)) => {
            tracing::warn!(error = %err, "cannot read static TLS files; keeping current certificate");
            return false;
        }
    };
    if last.as_ref().is_some_and(|(c, k)| *c == cert && *k == key) {
        return false;
    }
    match config.reload_from_pem(cert.clone(), key.clone()).await {
        Ok(()) => {
            tracing::info!("reloaded static TLS certificate");
            *last = Some((cert, key));
            true
        }
        Err(err) => {
            tracing::warn!(error = %err, "static TLS files are invalid; keeping current certificate");
            false
        }
    }
}

/// Polls the static certificate files for the lifetime of the process.
async fn watch_static_tls(
    config: axum_server::tls_rustls::RustlsConfig,
    cert_path: std::path::PathBuf,
    key_path: std::path::PathBuf,
    interval: Duration,
) {
    let mut last = match (
        tokio::fs::read(&cert_path).await,
        tokio::fs::read(&key_path).await,
    ) {
        (Ok(cert), Ok(key)) => Some((cert, key)),
        _ => None,
    };
    let mut ticker = tokio::time::interval(interval);
    ticker.tick().await;
    loop {
        ticker.tick().await;
        reload_static_tls_if_changed(&config, &cert_path, &key_path, &mut last).await;
    }
}

/// Serves HTTPS with the static (cert-manager) certificate as the active
/// transport and the relay certificate (ACME DNS-01 through the Worker) added
/// alongside it: a TLS SNI resolver presents the relay certificate for the
/// `v4-*` relay name and the static one for everything else. The listener is
/// HTTPS from the start (the static certificate exists), so there is no plain
/// HTTP phase; the Worker's callback is answered in cleartext for relay
/// challenge tokens only, as in the relay-only mode. Both certificates are
/// reloaded without a restart: the static files are polled and the relay
/// certificate is renewed in the background.
async fn serve_relay_dns01_with_static_tls(
    config: &Config,
    acme: &playarr_config::AcmeConfig,
    tls: &playarr_config::TlsConfig,
    runtime: &relay::RelayRuntime,
    listener: tokio::net::TcpListener,
    router: axum::Router,
    readiness: Option<playarr_api::ReadinessState>,
) -> anyhow::Result<()> {
    use axum_server::tls_rustls::{RustlsAcceptor, RustlsConfig};

    let resolver = Arc::new(multi_cert::SniCertResolver::new(acme.domain.clone()));
    let (cert, key) = (
        tokio::fs::read(&tls.cert_path).await?,
        tokio::fs::read(&tls.key_path).await?,
    );
    resolver.set_default(multi_cert::certified_key_from_pem(&cert, &key)?);

    tokio::spawn(watch_static_tls_into_resolver(
        resolver.clone(),
        tls.cert_path.clone(),
        tls.key_path.clone(),
        Some((cert, key)),
        STATIC_TLS_RELOAD_INTERVAL,
    ));

    let manager = Arc::new(relay_acme::CertificateManager::new(
        acme.domain.clone(),
        acme.environment.is_production(),
        acme.contact.clone(),
        acme_cache::SecureDirCache::new(acme.cache_dir.clone()),
        runtime.client.clone(),
    ));
    // Issuance and renewal never block the listener: the static certificate
    // already serves every other name.
    tokio::spawn(maintain_relay_certificate(manager, resolver.clone()));

    let mut server_config = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()?
    .with_no_client_auth()
    .with_cert_resolver(resolver);
    server_config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    let tls_config = RustlsConfig::from_config(Arc::new(server_config));
    tracing::info!(
        addr = %config.http_bind_addr,
        relay_domain = %acme.domain,
        "https server listening with static certificate and relay DNS-01 certificate (selected by SNI)"
    );

    let acceptor = HttpRedirectAcceptor::new(
        RustlsAcceptor::new(tls_config),
        https_origin(&acme.domain, config.http_bind_addr.port()),
    )
    .with_relay_challenges(Some(runtime.challenges.clone()));
    if let Some(readiness) = &readiness {
        readiness.set_ready(true);
    }
    axum_server::from_tcp(listener.into_std()?)?
        .acceptor(acceptor)
        .serve(router.into_make_service_with_connect_info::<std::net::SocketAddr>())
        .await
        .map_err(anyhow::Error::from)
}

/// Reloads the static certificate pair into the SNI resolver when either file
/// changes. An unreadable, half-written or invalid pair keeps the previous
/// certificate and is retried on the next tick.
async fn reload_static_tls_into_resolver_if_changed(
    resolver: &multi_cert::SniCertResolver,
    cert_path: &std::path::Path,
    key_path: &std::path::Path,
    last: &mut Option<(Vec<u8>, Vec<u8>)>,
) -> bool {
    let (cert, key) = match (
        tokio::fs::read(cert_path).await,
        tokio::fs::read(key_path).await,
    ) {
        (Ok(cert), Ok(key)) => (cert, key),
        (Err(err), _) | (_, Err(err)) => {
            tracing::warn!(error = %err, "cannot read static TLS files; keeping current certificate");
            return false;
        }
    };
    if last.as_ref().is_some_and(|(c, k)| *c == cert && *k == key) {
        return false;
    }
    match multi_cert::certified_key_from_pem(&cert, &key) {
        Ok(certified) => {
            resolver.set_default(certified);
            tracing::info!("reloaded static TLS certificate");
            *last = Some((cert, key));
            true
        }
        Err(err) => {
            tracing::warn!(error = %err, "static TLS files are invalid; keeping current certificate");
            false
        }
    }
}

async fn watch_static_tls_into_resolver(
    resolver: Arc<multi_cert::SniCertResolver>,
    cert_path: std::path::PathBuf,
    key_path: std::path::PathBuf,
    mut last: Option<(Vec<u8>, Vec<u8>)>,
    interval: Duration,
) {
    let mut ticker = tokio::time::interval(interval);
    ticker.tick().await;
    loop {
        ticker.tick().await;
        reload_static_tls_into_resolver_if_changed(&resolver, &cert_path, &key_path, &mut last)
            .await;
    }
}

/// Loads the cached relay certificate or issues one (retrying with backoff),
/// then renews it for the lifetime of the process, publishing every new
/// certificate to the SNI resolver.
async fn maintain_relay_certificate(
    manager: Arc<relay_acme::CertificateManager>,
    resolver: Arc<multi_cert::SniCertResolver>,
) {
    let publish =
        |certificate: &relay_acme::IssuedCertificate| match multi_cert::certified_key_from_pem(
            &certificate.pem,
            &certificate.pem,
        ) {
            Ok(key) => {
                resolver.set_relay(key);
                true
            }
            Err(error) => {
                tracing::error!(error = %error, "relay certificate could not be loaded");
                false
            }
        };
    let now = chrono::Utc::now().timestamp();
    let mut current = manager
        .load_cached()
        .await
        .filter(|certificate| !certificate.is_expired(now))
        .filter(|certificate| publish(certificate));
    if current.is_some() {
        tracing::info!("using cached relay certificate");
    }
    let mut delay = Duration::from_secs(30);
    loop {
        let due = current
            .as_ref()
            .is_none_or(|certificate| certificate.needs_renewal(chrono::Utc::now().timestamp()));
        if !due {
            tokio::time::sleep(Duration::from_secs(6 * 60 * 60)).await;
            continue;
        }
        match manager.issue().await {
            Ok(certificate) => {
                if publish(&certificate) {
                    tracing::info!("deployed relay certificate without restart");
                    current = Some(certificate);
                    delay = Duration::from_secs(30);
                    continue;
                }
            }
            Err(error) => {
                tracing::error!(error = %error, retry_in_secs = delay.as_secs(), "relay DNS-01 issuance failed");
            }
        }
        tokio::time::sleep(delay).await;
        delay = (delay * 2).min(Duration::from_secs(10 * 60));
    }
}

/// Serves the API with a certificate obtained through ACME DNS-01 and the
/// Playarr Worker as the DNS provider. Until the first certificate exists the
/// listener speaks plain HTTP (the Worker's callback needs it); afterwards it
/// is HTTPS-only, with plaintext requests redirected except for relay
/// challenge tokens. Renewals reload the certificate without a restart.
async fn serve_relay_dns01(
    config: &Config,
    acme: &playarr_config::AcmeConfig,
    runtime: &relay::RelayRuntime,
    listener: tokio::net::TcpListener,
    router: axum::Router,
    readiness: Option<playarr_api::ReadinessState>,
) -> anyhow::Result<()> {
    use axum_server::tls_rustls::{RustlsAcceptor, RustlsConfig};

    let manager = Arc::new(relay_acme::CertificateManager::new(
        acme.domain.clone(),
        acme.environment.is_production(),
        acme.contact.clone(),
        acme_cache::SecureDirCache::new(acme.cache_dir.clone()),
        runtime.client.clone(),
    ));
    let now = chrono::Utc::now().timestamp();
    let (certificate, listener) = match manager.load_cached().await.filter(|c| !c.is_expired(now)) {
        Some(certificate) => {
            tracing::info!(domain = %acme.domain, "using cached relay certificate");
            (certificate, listener)
        }
        None => {
            tracing::info!(
                domain = %acme.domain,
                "no valid certificate; serving plain HTTP on the relay port until DNS-01 issuance completes"
            );
            let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
            let plain = tokio::spawn(
                axum::serve(
                    listener,
                    router
                        .clone()
                        .into_make_service_with_connect_info::<std::net::SocketAddr>(),
                )
                .with_graceful_shutdown(async move {
                    let _ = stopped.await;
                })
                .into_future(),
            );
            let mut delay = Duration::from_secs(30);
            let certificate = loop {
                match manager.issue().await {
                    Ok(certificate) => break certificate,
                    Err(error) => {
                        tracing::error!(error = %error, retry_in_secs = delay.as_secs(), "relay DNS-01 issuance failed");
                        tokio::time::sleep(delay).await;
                        delay = (delay * 2).min(Duration::from_secs(10 * 60));
                    }
                }
            };
            let _ = stop.send(());
            if tokio::time::timeout(Duration::from_secs(10), plain)
                .await
                .is_err()
            {
                tracing::warn!("plain HTTP listener did not stop within 10 seconds; continuing");
            }
            let mut attempts = 0;
            let listener = loop {
                match tokio::net::TcpListener::bind(config.http_bind_addr).await {
                    Ok(listener) => break listener,
                    Err(error) if attempts < 20 => {
                        attempts += 1;
                        tracing::debug!(error = %error, "waiting to rebind the relay port");
                        tokio::time::sleep(Duration::from_millis(500)).await;
                    }
                    Err(error) => return Err(error.into()),
                }
            };
            (certificate, listener)
        }
    };

    let tls = RustlsConfig::from_pem(certificate.pem.clone(), certificate.pem.clone()).await?;
    tracing::info!(domain = %acme.domain, addr = %config.http_bind_addr, "automatic HTTPS enabled with Let's Encrypt ACME DNS-01 through the Playarr relay");

    let renewal = {
        let tls = tls.clone();
        let manager = manager.clone();
        async move {
            let mut current = certificate;
            loop {
                tokio::time::sleep(Duration::from_secs(6 * 60 * 60)).await;
                if !current.needs_renewal(chrono::Utc::now().timestamp()) {
                    continue;
                }
                match manager.issue().await {
                    Ok(renewed) => {
                        match tls
                            .reload_from_pem(renewed.pem.clone(), renewed.pem.clone())
                            .await
                        {
                            Ok(()) => {
                                tracing::info!(
                                    "deployed renewed relay certificate without restart"
                                );
                                current = renewed;
                            }
                            Err(error) => {
                                tracing::error!(error = %error, "renewed certificate could not be loaded")
                            }
                        }
                    }
                    Err(error) => {
                        tracing::error!(error = %error, "relay certificate renewal failed; will retry")
                    }
                }
            }
        }
    };

    let acceptor = HttpRedirectAcceptor::new(
        RustlsAcceptor::new(tls),
        https_origin(&acme.domain, config.http_bind_addr.port()),
    )
    .with_relay_challenges(Some(runtime.challenges.clone()));
    if let Some(readiness) = &readiness {
        readiness.set_ready(true);
    }
    let server = axum_server::from_tcp(listener.into_std()?)?
        .acceptor(acceptor)
        .serve(router.into_make_service_with_connect_info::<std::net::SocketAddr>());
    tokio::select! {
        result = server => result.map_err(anyhow::Error::from),
        () = renewal => Ok(()),
    }
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
fn spawn_poller_for(
    instance: &playarr_model::SourceInstance,
    source_instances: &Arc<playarr_api::SourceInstanceRegistry>,
    work_repo: Arc<dyn playarr_db::WorkRepo>,
    media_file_repo: Arc<dyn playarr_db::MediaFileRepo>,
    credit_repo: Arc<dyn playarr_db::CreditRepo>,
    artwork_prewarm: Option<playarr_arr_sync::ArtworkPrewarm>,
    embedding_sync: Option<playarr_arr_sync::EmbeddingSync>,
    pool: DbPool,
    coordinator: Arc<dyn playarr_coordination::ClusterCoordinator>,
) -> tokio::task::JoinHandle<()> {
    use playarr_arr_sync::{ArrClient, ReconciliationPoller};
    use playarr_telemetry::correlation::spawn::spawn_traced;

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
    let language_repo: Arc<dyn playarr_db::MediaLanguageRepo> =
        Arc::new(playarr_db::repo::SqlxMediaLanguageRepo::new(pool.clone()));
    let live_events = playarr_db::LiveEventPublisher::from_pool(pool.clone());
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
    // (Playarr Server Admin's "Tasks" screen).
    .with_status_reporter(source_instances.clone())
    // A no-op for every source kind except Radarr (see
    // `MediaSync::with_credit_repo`'s doc comment) -- passed unconditionally
    // rather than only for `SourceKind::Radarr` instances, since threading
    // it through unconditionally here is simpler than a kind-gated branch
    // and costs nothing extra for non-Radarr instances.
    .with_credit_repo(credit_repo)
    .with_language_repo(language_repo)
    .with_live_events(live_events);
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

/// Filters `peers` down to the ones not already present in
/// `spawned_peer_node_ids`, inserting each returned peer's id into that set
/// as it's kept -- the exact "newly discovered since the last check" rule
/// `boot_worker`'s peer-sync spawn loop applies on every tick, factored out
/// so that rule (in particular: an empty `peers` list must yield zero
/// results, so an ungrouped node's `peer_node_repo.list_others()` spawns
/// zero `PeerSyncPoller` tasks) is independently unit-testable without
/// booting the rest of `boot_worker`. See `docs/architecture/
/// peer-groups.md` §3.6.
fn newly_discovered_peers(
    peers: Vec<playarr_model::PeerNode>,
    spawned_peer_node_ids: &mut std::collections::HashSet<uuid::Uuid>,
) -> Vec<playarr_model::PeerNode> {
    peers
        .into_iter()
        .filter(|peer| spawned_peer_node_ids.insert(peer.id))
        .collect()
}

/// Spawns one [`playarr_peer_sync::PeerSyncPoller`] for `peer` -- the
/// `PeerSyncPoller` counterpart to [`spawn_poller_for`] above, same
/// "construct once per row, hand it its own clone of every shared repo,
/// spawn a traced detached task running `.run()` forever" shape. Each
/// poller internally wraps its own cycle in `coordinator.try_lock("peer-
/// sync:<peer_node_id>", ..)` (see that type's own doc comment) -- exactly
/// the same per-key coordination lock `ReconciliationPoller` already takes
/// for `"arr-sync:<source_instance_id>"`, so this function, unlike
/// [`spawn_poller_for`], does not need to wrap the spawned task in
/// `run_while_leader` itself.
#[allow(clippy::too_many_arguments)]
fn spawn_peer_sync_poller_for(
    peer: &playarr_model::PeerNode,
    self_identity: &playarr_peer_sync::PeerIdentity,
    http_client: reqwest::Client,
    transport_routes: playarr_peer_sync::peer_client::PeerTransportRoutes,
    poll_interval: Duration,
    unreachable_threshold: u32,
    coordinator: Arc<dyn playarr_coordination::ClusterCoordinator>,
    peer_node_repo: Arc<dyn playarr_db::PeerNodeRepo>,
    user_repo: Arc<dyn playarr_db::UserRepo>,
    policy_repo: Arc<dyn playarr_db::PolicyRepo>,
    group_library_repo: Arc<dyn playarr_db::GroupLibraryRepo>,
    source_instance_repo: Arc<dyn playarr_db::SourceInstanceRepo>,
    user_invite_repo: Arc<dyn playarr_db::UserInviteRepo>,
    user_invite_request_repo: Arc<dyn playarr_db::UserInviteRequestRepo>,
    work_repo: Arc<dyn playarr_db::WorkRepo>,
    availability_repo: Arc<dyn playarr_db::PeerLeafAvailabilityRepo>,
    routing_rule_repo: Arc<dyn playarr_db::RoutingRuleRepo>,
    sync_state_repo: Arc<dyn playarr_db::PeerSyncStateRepo>,
    conflict_log_repo: Arc<dyn playarr_db::SyncConflictLogRepo>,
) -> tokio::task::JoinHandle<()> {
    use playarr_peer_sync::{PeerClient, PeerSyncPoller};
    use playarr_telemetry::correlation::spawn::spawn_traced;

    let peer_client =
        PeerClient::new_with_routes(http_client, self_identity.clone(), transport_routes);
    let poller = PeerSyncPoller::new(
        self_identity.peer_id,
        peer.id,
        peer_client,
        poll_interval,
        unreachable_threshold,
        coordinator,
        peer_node_repo,
        user_repo,
        policy_repo,
        group_library_repo,
        source_instance_repo,
        user_invite_repo,
        user_invite_request_repo,
        work_repo,
        availability_repo,
        routing_rule_repo,
        sync_state_repo,
        conflict_log_repo,
    );
    // TODO: wire a real `SyncStatusReporter` through here (`.with_status_
    // reporter(...)`) once one backs `GET /api/v1/admin/peer-nodes/{id}/
    // sync-status` -- `admin_peer::PeerSyncStatusResponse::status`'s own
    // doc comment already flags this exact handler as the place that stub
    // gets replaced; not this change's scope.
    let span = tracing::info_span!(
        "peer_sync_poller",
        peer_node_id = %peer.id,
        peer_name = %peer.name,
    );
    spawn_traced(span, async move {
        poller.run().await;
    })
}

#[allow(clippy::too_many_arguments)]
async fn boot_worker(
    pool: DbPool,
    coordinator: Arc<dyn playarr_coordination::ClusterCoordinator>,
    source_instances: Arc<playarr_api::SourceInstanceRegistry>,
    active_sessions: playarr_transcode::ActiveSessionCounter,
    tdarr_notify_rx: tokio::sync::mpsc::Receiver<playarr_transcode::MediaFileImportEvent>,
    analytics_store: Arc<dyn playarr_db::analytics::AnalyticsStore>,
    session_registry: Arc<dyn playarr_telemetry::analytics::SessionRegistry>,
    analytics: Arc<playarr_telemetry::analytics::AnalyticsCollector>,
) -> anyhow::Result<Vec<tokio::task::JoinHandle<()>>> {
    use std::collections::HashSet;

    use playarr_db::repo::{
        SqlxCreditRepo, SqlxEmbeddingRepo, SqlxGroupLibraryRepo, SqlxMediaFileRepo,
        SqlxNodeIdentityRepo, SqlxPeerLeafAvailabilityRepo, SqlxPeerNodeRepo,
        SqlxPeerSyncStateRepo, SqlxPolicyRepo, SqlxRoutingRuleRepo, SqlxSourceInstanceRepo,
        SqlxSyncConflictLogRepo, SqlxUserInviteRepo, SqlxUserInviteRequestRepo, SqlxUserRepo,
        SqlxWorkRepo,
    };
    use playarr_db::{
        CreditRepo, EmbeddingRepo, GroupLibraryRepo, MediaFileRepo, NodeIdentityRepo,
        PeerLeafAvailabilityRepo, PeerNodeRepo, PeerSyncStateRepo, PolicyRepo, RoutingRuleRepo,
        SourceInstanceRepo, SyncConflictLogRepo, UserInviteRepo, UserInviteRequestRepo, UserRepo,
        WorkRepo,
    };

    let mut handles = Vec::new();

    // The worker role writes catalogue rows too (arr sync, peer sync); the
    // events land in the shared database and reach API-role streams through
    // their poll fallback even when the roles run as separate processes.
    let live_events = playarr_db::LiveEventPublisher::from_pool(pool.clone());
    let work_repo: Arc<dyn WorkRepo> = Arc::new(playarr_db::EventingWorkRepo::new(
        Arc::new(SqlxWorkRepo::new(pool.clone())),
        live_events.clone(),
    ));
    let media_file_repo: Arc<dyn MediaFileRepo> = Arc::new(playarr_db::EventingMediaFileRepo::new(
        Arc::new(SqlxMediaFileRepo::new(pool.clone())),
        live_events,
    ));
    let credit_repo: Arc<dyn CreditRepo> = Arc::new(SqlxCreditRepo::new(pool.clone()));
    // §9.1/§3.6 (`docs/architecture/peer-groups.md`): this function's own
    // 10s supervisor loop below is the sole spawn point for both
    // `SourceInstanceRepo`/`PeerNodeRepo` hydration and `PeerSyncPoller`
    // construction in a split api/worker deployment -- see that loop's own
    // comment for why these repos are constructed here rather than passed
    // in (mirrors every other repo on this function already doing the
    // same).
    let source_instance_repo: Arc<dyn SourceInstanceRepo> =
        Arc::new(SqlxSourceInstanceRepo::new(pool.clone()));
    let node_identity_repo: Arc<dyn NodeIdentityRepo> =
        Arc::new(SqlxNodeIdentityRepo::new(pool.clone()));
    let peer_node_repo: Arc<dyn PeerNodeRepo> = Arc::new(SqlxPeerNodeRepo::new(pool.clone()));
    let user_repo: Arc<dyn UserRepo> = Arc::new(SqlxUserRepo::new(pool.clone()));
    let policy_repo: Arc<dyn PolicyRepo> = Arc::new(SqlxPolicyRepo::new(pool.clone()));
    let group_library_repo: Arc<dyn GroupLibraryRepo> =
        Arc::new(SqlxGroupLibraryRepo::new(pool.clone()));
    let routing_rule_repo: Arc<dyn RoutingRuleRepo> =
        Arc::new(SqlxRoutingRuleRepo::new(pool.clone()));
    let user_invite_repo: Arc<dyn UserInviteRepo> = Arc::new(SqlxUserInviteRepo::new(pool.clone()));
    let user_invite_request_repo: Arc<dyn UserInviteRequestRepo> =
        Arc::new(SqlxUserInviteRequestRepo::new(pool.clone()));
    let peer_leaf_availability_repo: Arc<dyn PeerLeafAvailabilityRepo> =
        Arc::new(SqlxPeerLeafAvailabilityRepo::new(pool.clone()));
    let peer_sync_state_repo: Arc<dyn PeerSyncStateRepo> =
        Arc::new(SqlxPeerSyncStateRepo::new(pool.clone()));
    let sync_conflict_log_repo: Arc<dyn SyncConflictLogRepo> =
        Arc::new(SqlxSyncConflictLogRepo::new(pool.clone()));
    // One shared `reqwest::Client` (an `Arc`-backed connection pool
    // internally) reused across every `PeerSyncPoller` this process spawns,
    // rather than one per poller -- same "share, don't reconstruct per
    // task" reasoning as every other pooled resource in this function.
    let peer_transport_routes = playarr_peer_sync::peer_client::PeerTransportRoutes::from_env()?;
    let peer_http_client = peer_transport_routes.build_client().await?;
    let peer_sync_interval = peer_sync_interval_secs_from_env();
    let peer_sync_unreachable_threshold = peer_sync_unreachable_threshold_from_env();

    // Proactive artwork cache warming (see `playarr_arr_sync::
    // artwork_prewarm`'s doc comment) -- unconditional, no fallible setup,
    // so this is always `Some`.
    let artwork_prewarm = Some(playarr_arr_sync::ArtworkPrewarm::new(
        playarr_artwork::shared(),
    ));

    // Best-effort, same tradeoff `boot_api`'s own embedding-repo wiring
    // documents: `FastEmbedEmbedder::new()` downloads its model on first
    // use, so this must never fail worker startup. `None` here just means
    // `similar` stays empty-of-fresh-data (already-cached embeddings from
    // before this failure still serve fine) until a later restart
    // succeeds.
    let embedding_repo: Arc<dyn EmbeddingRepo> = Arc::new(SqlxEmbeddingRepo::new(pool.clone()));
    let embedding_sync = match tokio::task::spawn_blocking(
        playarr_embeddings::FastEmbedEmbedder::new,
    )
    .await
    {
        Ok(Ok(embedder)) => Some(playarr_arr_sync::EmbeddingSync::new(
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
    // Also the sole spawn point for `PeerSyncPoller` (`docs/architecture/
    // peer-groups.md` §3.6) -- one per non-self row `peer_node_repo.
    // list_others()` returns, discovered/spawned by this same loop for
    // exactly the same "don't require a restart" reason `SourceInstance`
    // registration already gets.
    //
    // §9.1: this closes the gap that used to exist for split `api`/`worker`
    // deployments, which run this function in a
    // *different* process than the one serving the admin endpoints, each
    // with its own empty `SourceInstanceRegistry` and (for peer-sync) no
    // in-memory registry at all. The first tick below hydrates straight
    // from `SourceInstanceRepo`/`PeerNodeRepo` -- the same durable source
    // `boot_api` already hydrates its own registry from before serving --
    // instead of assuming the snapshot this loop started with (empty, for
    // a worker-only process) was complete. `PLAYARR_ROLE=all` (worker and
    // api sharing one process/registry, e.g. `docker-compose.standalone.
    // yml`) just re-upserts what's already there, which is harmless.
    {
        let source_instances = source_instances.clone();
        let work_repo = work_repo.clone();
        let media_file_repo = media_file_repo.clone();
        let credit_repo = credit_repo.clone();
        let artwork_prewarm = artwork_prewarm.clone();
        let embedding_sync = embedding_sync.clone();
        let pool = pool.clone();
        let coordinator = coordinator.clone();
        let source_instance_repo = source_instance_repo.clone();
        let node_identity_repo = node_identity_repo.clone();
        let peer_node_repo = peer_node_repo.clone();
        let user_repo = user_repo.clone();
        let policy_repo = policy_repo.clone();
        let group_library_repo = group_library_repo.clone();
        let routing_rule_repo = routing_rule_repo.clone();
        let user_invite_repo = user_invite_repo.clone();
        let user_invite_request_repo = user_invite_request_repo.clone();
        let peer_leaf_availability_repo = peer_leaf_availability_repo.clone();
        let peer_sync_state_repo = peer_sync_state_repo.clone();
        let sync_conflict_log_repo = sync_conflict_log_repo.clone();
        let peer_http_client = peer_http_client.clone();
        let peer_transport_routes = peer_transport_routes.clone();
        let mut spawned_peer_node_ids: HashSet<uuid::Uuid> = HashSet::new();
        // Resolved lazily (below) and cached once found -- this node's own
        // signing identity may not exist yet the very first time a fresh,
        // worker-only process runs this loop (it's only ever minted by
        // `admin_peer::ensure_node_identity`, called from the API role's
        // boot path, see that function's doc comment). Same "keep checking
        // until it appears" shape this function's own Tdarr
        // connection-watch loop below already uses for a comparable
        // "not configured yet" gap.
        let mut self_peer_identity: Option<playarr_peer_sync::PeerIdentity> = None;
        handles.push(tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(10));
            interval.tick().await; // first tick fires immediately; hydrate from the DB below before the loop starts reacting to changes

            source_urls::reconcile_from_env(&source_instance_repo).await;
            match source_instance_repo.list_all().await {
                Ok(instances) => {
                    for instance in instances {
                        source_instances.upsert(instance);
                    }
                }
                Err(err) => {
                    tracing::error!(
                        %err,
                        "failed to hydrate SourceInstanceRegistry from the database in the \
                         worker role; this process's registry may stay empty (spawning no \
                         reconciliation pollers) until a later restart succeeds"
                    );
                }
            }

            loop {
                interval.tick().await;
                match source_instance_repo.list_all().await {
                    Ok(instances) => {
                        let active_ids: HashSet<uuid::Uuid> =
                            instances.iter().map(|instance| instance.id).collect();
                        for instance in instances {
                            source_instances.upsert(instance);
                        }
                        for existing in source_instances.all() {
                            if !active_ids.contains(&existing.id) {
                                source_instances.remove(existing.id);
                            }
                        }
                    }
                    Err(err) => tracing::error!(
                        %err,
                        "failed to refresh SourceInstanceRegistry from the database"
                    ),
                }
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

                if self_peer_identity.is_none() {
                    match node_identity_repo.get().await {
                        Ok(Some(identity)) => {
                            match playarr_peer_sync::PeerIdentity::from_seed_b64(
                                identity.peer_id,
                                identity.private_key.expose_secret(),
                            ) {
                                Ok(identity) => self_peer_identity = Some(identity),
                                Err(err) => tracing::error!(
                                    %err,
                                    "this node's persisted Ed25519 identity is corrupt; \
                                     peer-sync cannot start until this is investigated"
                                ),
                            }
                        }
                        // Byte-for-byte inert for a fresh, ungrouped node
                        // (`ensure_node_identity`'s own doc comment) -- not
                        // logged every 10s, that would be pure noise for
                        // the common case of a node that simply hasn't
                        // joined a group yet.
                        Ok(None) => {}
                        Err(err) => tracing::error!(
                            %err,
                            "failed to load this node's identity from the database; peer-sync \
                             stays inert until this is investigated"
                        ),
                    }
                }

                if let Some(self_identity) = &self_peer_identity {
                    match peer_node_repo.list_others().await {
                        Ok(peers) => {
                            let newly_discovered =
                                newly_discovered_peers(peers, &mut spawned_peer_node_ids);
                            if newly_discovered.is_empty() && spawned_peer_node_ids.is_empty() {
                                tracing::debug!(
                                    "no other peer nodes are known yet; PeerSyncPoller has \
                                     nothing to spawn (checked again every 10s, so joining a \
                                     group later doesn't need a process restart)"
                                );
                            }
                            for peer in newly_discovered {
                                tracing::info!(
                                    peer_node_id = %peer.id,
                                    peer_name = %peer.name,
                                    "peer node known; spawning its PeerSyncPoller now"
                                );
                                spawn_peer_sync_poller_for(
                                    &peer,
                                    self_identity,
                                    peer_http_client.clone(),
                                    peer_transport_routes.clone(),
                                    peer_sync_interval,
                                    peer_sync_unreachable_threshold,
                                    coordinator.clone(),
                                    peer_node_repo.clone(),
                                    user_repo.clone(),
                                    policy_repo.clone(),
                                    group_library_repo.clone(),
                                    source_instance_repo.clone(),
                                    user_invite_repo.clone(),
                                    user_invite_request_repo.clone(),
                                    work_repo.clone(),
                                    peer_leaf_availability_repo.clone(),
                                    routing_rule_repo.clone(),
                                    peer_sync_state_repo.clone(),
                                    sync_conflict_log_repo.clone(),
                                );
                            }
                        }
                        Err(err) => tracing::error!(
                            %err,
                            "failed to list peer nodes from the database; peer-sync spawning \
                             skipped this tick"
                        ),
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
        let rollup = playarr_telemetry::analytics::RollupScheduler::new(
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
        let reaper = playarr_telemetry::analytics::SessionReaper::new(
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
        let retention = playarr_telemetry::analytics::RetentionSweeper::new(
            pool.clone(),
            playarr_telemetry::analytics::RetentionPolicy::default(),
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
    // `playarr_api::tdarr`'s module doc comment) -- replaces the old
    // `TDARR_URL`/`TDARR_API_KEY`/`TDARR_DB_ID` env-var-only config, same
    // "durable, admin-registerable, not a restart-required env var"
    // upgrade `SourceInstance` already went through for `*arr` apps.
    let tdarr_connection_repo: Arc<dyn playarr_db::TdarrConnectionRepo> =
        Arc::new(playarr_db::repo::SqlxTdarrConnectionRepo::new(pool.clone()));
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
            // still needs a restart, same as changing `PLAYARR_AUTH_MODE`
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
/// persisted [`playarr_model::TdarrConnection`] -- the single spawn
/// point both `boot_worker`'s boot-time hydration and its registration
/// watch loop (see that function's body) call into, so the two paths
/// can't drift.
fn spawn_tdarr_dispatcher(
    connection: playarr_model::TdarrConnection,
    pool: DbPool,
    active_sessions: playarr_transcode::ActiveSessionCounter,
    tdarr_notify_rx: tokio::sync::mpsc::Receiver<playarr_transcode::MediaFileImportEvent>,
    coordinator: Arc<dyn playarr_coordination::ClusterCoordinator>,
) -> tokio::task::JoinHandle<()> {
    use playarr_db::repo::SqlxRenditionRepo;
    use playarr_db::RenditionRepo;

    let rendition_repo: Arc<dyn RenditionRepo> = Arc::new(SqlxRenditionRepo::new(pool));
    let tdarr = playarr_tdarr_client::TdarrClient::new(
        connection.base_url,
        connection.api_key_encrypted.expose_secret().clone(),
    );
    // `tdarr_notify_rx` is the receive side of the channel `boot_api`'s
    // `TranscodeOrchestrator` sends on every time it starts a live
    // on-demand session (see `playarr_transcode`'s module docs, "other
    // bridge" section) -- this is what turns "someone is watching this
    // file right now via a temporary session" into a durable,
    // Tdarr-produced `Rendition` for future requests. Real *arr
    // import/upgrade events aren't wired onto this same channel yet
    // (there's no `MediaFileRepo`-backed import pipeline outside
    // arr-sync's own reconciliation flow to source them from) -- a
    // separate, not-yet-addressed gap; the on-demand path above is real
    // and live today regardless.
    let dispatcher = playarr_transcode::TdarrDispatcher::new(
        tdarr,
        rendition_repo,
        active_sessions,
        tdarr_notify_rx,
        playarr_transcode::TdarrDispatcherConfig {
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
/// loops so only one node runs them" mechanism.
///
/// TODO(graceful-handoff): if renewal ever reports leadership lost mid-run
/// (not possible with `SingleNodeCoordinator`; kept for a future coordinator, e.g. if this node
/// stalled past the lease TTL and another node's campaign won), this only
/// logs loudly — it does not abort/hand off `task`, since neither
/// `TdarrDispatcher` nor `ReconciliationPoller` currently accept an
/// external cancellation signal to drain against. Threading one through is
/// future work; today's fallback (two nodes briefly both driving the same
/// loop until the stalled one's `task` naturally completes or the process
/// restarts) is safe for both loops' idempotent, upsert-shaped operations,
/// just not maximally clean.
async fn run_while_leader<Fut>(
    coordinator: Arc<dyn playarr_coordination::ClusterCoordinator>,
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

/// Binds `playarr_telemetry::metrics::http::router` (the real, tested
/// `/metrics` Prometheus-exposition-format handler that crate ships but
/// never wires up itself) to `metrics_bind_addr`, on its own listener
/// separate from the public API port -- so it can be firewalled off from
/// public-facing ingress without needing auth middleware of its own,
/// matching every deployment tier's existing assumption that this port is
/// a private/internal one (see infra/kubernetes/helm/playarr/values.yaml's
/// `metricsPort`, never exposed via an Ingress). Logged, not propagated
/// via `?`, since this runs detached via `tokio::spawn` -- a failure here
/// (e.g. the port already in use) shouldn't take the whole process down
/// when the public API/worker loops are otherwise healthy, but it must be
/// loud, not silent, since a metrics outage is still a real operational
/// problem worth seeing in the logs.
async fn spawn_metrics_listener(
    metrics_bind_addr: std::net::SocketAddr,
    registry: playarr_telemetry::metrics::MetricsRegistry,
) {
    let router = playarr_telemetry::metrics::http::router(registry);
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
    /// Never constructed yet -- `check_for_update`'s network call is still
    /// stubbed (see its doc comment), so this variant has no producer until
    /// that follow-up lands. The `update` match arm that consumes it is
    /// real and already correct.
    #[allow(dead_code)]
    UpdateAvailable {
        current_version: String,
        latest_version: String,
    },
}

async fn update(check: bool, yes: bool, channel: UpdateChannel) -> anyhow::Result<()> {
    let outcome = check_for_update(channel).await?;

    match outcome {
        UpdateCheckOutcome::UpToDate { current_version } => {
            println!("playarr {current_version} is up to date ({channel} channel)");
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
/// 2. `cosign verify-blob --key <playarr-release-pubkey> --signature
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
    anyhow::bail!("playarr update --yes is not implemented yet (would update to {target_version})");
}

#[cfg(test)]
mod bootstrap_tests {
    use super::*;
    use playarr_auth::PasswordVerifier as _;
    use playarr_db::repo::{SqlxPolicyRepo, SqlxUserRepo};
    use playarr_db::{DbPool, PolicyRepo, UserRepo};
    use std::sync::atomic::{AtomicU64, Ordering};

    #[test]
    fn device_verification_uri_points_at_the_servers_own_link_page_when_it_serves_the_client() {
        assert_eq!(device_verification_base_uri(None, true), "/tv/link");
        assert_eq!(device_verification_base_uri(None, false), "/link");
        assert_eq!(
            device_verification_base_uri(Some("https://example.test/link".into()), true),
            "https://example.test/link"
        );
    }

    #[test]
    fn transcode_resource_settings_require_positive_integers() {
        assert_eq!(parse_positive_usize("TEST", "1", 9), 1);
        assert_eq!(parse_positive_usize("TEST", "12", 9), 12);
        assert_eq!(parse_positive_usize("TEST", "0", 9), 9);
        assert_eq!(parse_positive_usize("TEST", "-1", 9), 9);
        assert_eq!(parse_positive_usize("TEST", "many", 9), 9);
    }

    /// Same private, migrated, in-memory SQLite pool idiom
    /// `playarr-api`'s `test_support::test_pool` and `playarr-catalog`'s
    /// own tests use -- a fresh, uniquely named `:memory:`-equivalent
    /// database per call.
    async fn test_pool() -> DbPool {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let url = format!("sqlite://playarr_bin_bootstrap_test_{n}?mode=memory&cache=shared");

        sqlx::any::install_default_drivers();
        let pool: DbPool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .expect("open in-memory sqlite pool");
        playarr_db::run_migrations(&pool)
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
            !playarr_auth::login::Argon2PasswordVerifier.verify(
                "definitely-not-the-generated-password",
                user.password_hash.expose_secret()
            ),
            "an arbitrary wrong password must never verify against the real hash"
        );
    }

    #[tokio::test]
    async fn create_admin_creates_then_resets_and_refuses_non_admins() {
        let pool = test_pool().await;
        let user_repo: Arc<dyn UserRepo> = Arc::new(SqlxUserRepo::new(pool.clone()));
        let policy_repo: Arc<dyn PolicyRepo> = Arc::new(SqlxPolicyRepo::new(pool));

        assert!(create_admin_with(&user_repo, &policy_repo, "ops", "short")
            .await
            .is_err());
        assert!(
            create_admin_with(&user_repo, &policy_repo, "ops", "first-password-123")
                .await
                .unwrap()
        );
        let user = user_repo.find_by_username("ops").await.unwrap().unwrap();
        let policy = policy_repo
            .find_by_id(user.policy_id)
            .await
            .unwrap()
            .unwrap();
        assert!(policy.is_admin && policy.can_stream);
        assert!(playarr_auth::login::Argon2PasswordVerifier
            .verify("first-password-123", user.password_hash.expose_secret()));

        // Second run resets the password on the same account.
        assert!(
            !create_admin_with(&user_repo, &policy_repo, "ops", "second-password-123")
                .await
                .unwrap()
        );
        assert_eq!(user_repo.list_all().await.unwrap().len(), 1);
        let user = user_repo.find_by_username("ops").await.unwrap().unwrap();
        assert!(playarr_auth::login::Argon2PasswordVerifier
            .verify("second-password-123", user.password_hash.expose_secret()));

        // A non-admin account of the same name is never promoted.
        let mut viewer_policy = policy.clone();
        viewer_policy.id = uuid::Uuid::new_v4();
        viewer_policy.is_admin = false;
        policy_repo.upsert(&viewer_policy).await.unwrap();
        let mut viewer = user.clone();
        viewer.id = uuid::Uuid::new_v4();
        viewer.username = "viewer".into();
        viewer.policy_id = viewer_policy.id;
        user_repo.upsert(&viewer).await.unwrap();
        assert!(
            create_admin_with(&user_repo, &policy_repo, "viewer", "third-password-123")
                .await
                .is_err()
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
        assert!(playarr_auth::login::Argon2PasswordVerifier.verify(
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

    fn test_peer_node(id: uuid::Uuid) -> playarr_model::PeerNode {
        let now = chrono::Utc::now();
        playarr_model::PeerNode {
            id,
            group_id: uuid::Uuid::new_v4(),
            name: format!("peer-{id}"),
            addresses: Vec::new(),
            public_key: "test-pubkey".to_string(),
            is_self: false,
            status: playarr_model::PeerNodeStatus::Active,
            last_seen_at: None,
            last_sync_error: None,
            joined_at: now,
            updated_at: now,
        }
    }

    /// The exact invariant §3.6/§9.1 requires and that a live boot must
    /// also demonstrate: an ungrouped node's `peer_node_repo.list_others()`
    /// is empty, and `boot_worker`'s peer-sync spawn loop must turn that
    /// into zero `PeerSyncPoller` tasks -- not "argued to be zero" but
    /// actually exercised here against `newly_discovered_peers`, the exact
    /// function that loop calls on every tick to decide what to spawn.
    #[test]
    fn an_empty_peer_list_yields_zero_newly_discovered_peers() {
        let mut spawned = std::collections::HashSet::new();
        let discovered = newly_discovered_peers(Vec::new(), &mut spawned);
        assert!(
            discovered.is_empty(),
            "an ungrouped node's empty peer_node_repo.list_others() must spawn zero PeerSyncPollers"
        );
        assert!(spawned.is_empty());
    }

    /// A peer already spawned on a previous tick must not be spawned again
    /// -- `boot_worker`'s loop re-lists `peer_node_repo.list_others()`
    /// every 10s (to pick up peers that join the group later, without a
    /// restart), so this filter is what keeps that idempotent rather than
    /// spawning a duplicate poller for the same peer on every tick.
    #[test]
    fn newly_discovered_peers_only_returns_each_peer_once_across_calls() {
        let mut spawned = std::collections::HashSet::new();
        let peer_a = test_peer_node(uuid::Uuid::new_v4());
        let peer_b = test_peer_node(uuid::Uuid::new_v4());

        let first_tick = newly_discovered_peers(vec![peer_a.clone(), peer_b.clone()], &mut spawned);
        assert_eq!(first_tick.len(), 2, "both peers are new on the first tick");

        let second_tick = newly_discovered_peers(vec![peer_a, peer_b], &mut spawned);
        assert!(
            second_tick.is_empty(),
            "already-spawned peers must not be returned again on a later tick"
        );

        let peer_c = test_peer_node(uuid::Uuid::new_v4());
        let third_tick = newly_discovered_peers(vec![peer_c.clone()], &mut spawned);
        assert_eq!(
            third_tick,
            vec![peer_c],
            "a peer that joins the group later is still picked up on a subsequent tick"
        );
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
    fn https_redirect_origin_keeps_nonstandard_playarr_port() {
        assert_eq!(
            https_origin("v4-203-0-113-10.relay.playarr.app", 8484),
            "https://v4-203-0-113-10.relay.playarr.app:8484"
        );
        assert_eq!(
            https_origin("playarr.example.com", 443),
            "https://playarr.example.com"
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

    fn write_self_signed(dir: &std::path::Path, name: &str) -> Vec<u8> {
        let key = rcgen::generate_simple_self_signed(vec![name.to_string()]).unwrap();
        std::fs::write(dir.join("tls.crt"), key.cert.pem()).unwrap();
        std::fs::write(dir.join("tls.key"), key.signing_key.serialize_pem()).unwrap();
        key.cert.der().to_vec()
    }

    #[tokio::test]
    async fn static_tls_reloads_only_when_files_change_and_survive_bad_input() {
        let dir = tempfile::tempdir().unwrap();
        let (cert, key) = (dir.path().join("tls.crt"), dir.path().join("tls.key"));
        write_self_signed(dir.path(), "first.example");
        let config = axum_server::tls_rustls::RustlsConfig::from_pem_file(&cert, &key)
            .await
            .unwrap();
        let mut last = Some((std::fs::read(&cert).unwrap(), std::fs::read(&key).unwrap()));

        // Unchanged files: no reload.
        assert!(!reload_static_tls_if_changed(&config, &cert, &key, &mut last).await);

        // Renewed pair: reloaded once, then stable.
        write_self_signed(dir.path(), "second.example");
        assert!(reload_static_tls_if_changed(&config, &cert, &key, &mut last).await);
        assert!(!reload_static_tls_if_changed(&config, &cert, &key, &mut last).await);

        // Invalid or missing files keep the last good state and are retried.
        let good = last.clone();
        std::fs::write(&cert, "not a certificate").unwrap();
        assert!(!reload_static_tls_if_changed(&config, &cert, &key, &mut last).await);
        assert_eq!(last, good);
        std::fs::remove_file(&key).unwrap();
        assert!(!reload_static_tls_if_changed(&config, &cert, &key, &mut last).await);
        assert_eq!(last, good);

        // A valid pair written afterwards is picked up.
        write_self_signed(dir.path(), "third.example");
        assert!(reload_static_tls_if_changed(&config, &cert, &key, &mut last).await);
    }

    #[tokio::test]
    async fn plaintext_relay_challenge_is_answered_but_other_requests_still_redirect() {
        use axum_server::accept::Accept as _;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let store = Arc::new(relay::ChallengeStore::default());
        store.publish("tok-1");
        for (request, expected) in [
            (
                "GET /.well-known/playarr-relay/tok-1 HTTP/1.1\r\nHost: 203.0.113.10:8484\r\n\r\n",
                "HTTP/1.1 200 OK\r\n",
            ),
            (
                "GET /.well-known/playarr-relay/unknown HTTP/1.1\r\nHost: 203.0.113.10:8484\r\n\r\n",
                "HTTP/1.1 308 Permanent Redirect\r\n",
            ),
        ] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let mut client = tokio::net::TcpStream::connect(address).await.unwrap();
            let (server, _) = listener.accept().await.unwrap();
            let acceptor = HttpRedirectAcceptor::new(
                axum_server::accept::DefaultAcceptor::new(),
                "https://v4-203-0-113-10.relay.playarr.app:8484".to_string(),
            )
            .with_relay_challenges(Some(store.clone()));
            let task = tokio::spawn(async move { acceptor.accept(server, ()).await.unwrap_err() });
            client.write_all(request.as_bytes()).await.unwrap();
            let mut response = String::new();
            client.read_to_string(&mut response).await.unwrap();
            task.await.unwrap();
            assert!(response.starts_with(expected), "{response}");
            if expected.contains("200") {
                assert!(response.ends_with("tok-1"));
            }
        }
    }
}
