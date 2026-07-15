//! `streamarr` — the combined server binary and maintenance CLI.
//!
//! With no subcommand, boots the server: resolves [`streamarr_config::Config`]
//! from the environment, initializes [`streamarr_telemetry`], and (when
//! `STREAMARR_ROLE` is `all` or `api`) serves the Axum router built by
//! [`streamarr_api::build_router`]. `update` is a separate maintenance
//! subcommand for checking/applying binary updates out-of-band from a
//! running server.

use clap::{Parser, Subcommand, ValueEnum};

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
    let config = streamarr_config::Config::from_env()?;
    let _telemetry_guard = streamarr_telemetry::init(&config);

    tracing::info!(
        role = %config.role,
        deployment_tier = ?config.deployment_tier,
        "starting streamarr"
    );

    if config.role.runs_api() {
        boot_api(&config).await?;
    } else {
        // Worker-only role: no HTTP server. Background worker loops
        // (arr-sync reconciliation pollers, the Tdarr dispatcher, the
        // analytics rollup/retention schedulers) would be spawned here via
        // `streamarr_telemetry::correlation::spawn_traced`; wiring them in
        // is downstream of the trait/type shapes this crate defines, not
        // yet done. Block forever rather than exit 0, so a worker-only
        // process under a process supervisor reads as "running", not
        // "crashed".
        tracing::info!("role does not run the API server; idling as a worker-only process");
        std::future::pending::<()>().await;
    }

    Ok(())
}

async fn boot_api(config: &streamarr_config::Config) -> anyhow::Result<()> {
    use streamarr_api::{
        build_router, AppState, ClientCompatibilityTable, ReadinessState, VersionGateLayer,
        VersionState,
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
    let state = AppState {
        readiness: readiness.clone(),
        version: VersionState {
            envelope: version_envelope,
        },
    };
    let version_gate = VersionGateLayer::new(compatibility_table);

    let (router, _openapi) = build_router(state, version_gate);

    let listener = tokio::net::TcpListener::bind(config.http_bind_addr).await?;
    tracing::info!(addr = %config.http_bind_addr, "http server listening");

    // Only flip to ready once the listener is actually bound — a readiness
    // probe passing before this point would tell a load balancer to send
    // traffic to a port nothing is listening on yet.
    readiness.set_ready(true);

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
