//! `streamarr-config` — environment-driven configuration for every
//! Streamarr backend process (the combined `streamarr` binary, and any
//! future split API/worker binaries).
//!
//! Deliberately hand-rolled on top of `std::env` rather than a config
//! framework: this crate is loaded before `streamarr-telemetry` sets up
//! tracing, so a config error has to be reportable with nothing fancier
//! than `Display`, and we want zero surprise precedence rules (no
//! layered file+env+CLI merging) at the one layer where operators most
//! need predictability.

use std::env::VarError;
use std::fmt;
use std::net::{AddrParseError, SocketAddr};
use std::path::PathBuf;

/// Which responsibilities this process instance takes on. Set via
/// `STREAMARR_ROLE`; determines whether `streamarr-bin` boots the Axum
/// HTTP server, the background worker loops (arr-sync poller, transcode
/// dispatcher, analytics rollup), or both — see `Role::runs_api` /
/// `Role::runs_worker`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    /// Everything in one process. The default, and the only sane choice
    /// for [`DeploymentTier::SingleNode`].
    All,
    Api,
    Worker,
}

impl Role {
    fn parse(raw: &str) -> Result<Self, ConfigError> {
        match raw.to_ascii_lowercase().as_str() {
            "all" => Ok(Role::All),
            "api" => Ok(Role::Api),
            "worker" => Ok(Role::Worker),
            _ => Err(ConfigError::InvalidValue {
                var: "STREAMARR_ROLE".to_string(),
                value: raw.to_string(),
                reason: "expected one of: all, api, worker".to_string(),
            }),
        }
    }

    pub fn runs_api(self) -> bool {
        matches!(self, Role::All | Role::Api)
    }

    pub fn runs_worker(self) -> bool {
        matches!(self, Role::All | Role::Worker)
    }
}

impl fmt::Display for Role {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Role::All => "all",
            Role::Api => "api",
            Role::Worker => "worker",
        })
    }
}

/// How many nodes' worth of shared state this deployment needs to
/// coordinate across. Not read from its own env var — it's *derived* from
/// which of `DATABASE_URL` / `REDIS_URL` are configured, so it can't drift
/// out of sync with the actual connection settings. `streamarr-coordination`
/// and `streamarr-cache` use this to pick which trait implementation
/// (`SingleNodeCoordinator`/`PostgresCoordinator`, `InMemory`/`Redis`/
/// `PostgresListenNotify`) to wire up at startup.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DeploymentTier {
    /// SQLite `DATABASE_URL`, no Redis: single process, in-memory
    /// coordination and cache are always correct because there is no other
    /// node to coordinate with.
    SingleNode,
    /// Postgres `DATABASE_URL`, no `REDIS_URL`: multiple nodes coordinate
    /// via `pg_advisory_lock`/a heartbeat table and pub/sub via
    /// `LISTEN`/`NOTIFY` instead of a dedicated cache tier.
    MultiNodePostgres,
    /// Postgres `DATABASE_URL` and `REDIS_URL` both set: the full
    /// horizontally-scaled deployment, Redis used for caching and pub/sub.
    MultiNodePostgresRedis,
}

impl DeploymentTier {
    pub fn resolve(database_url: &str, redis_url: Option<&str>) -> Self {
        let is_postgres =
            database_url.starts_with("postgres://") || database_url.starts_with("postgresql://");
        match (is_postgres, redis_url.is_some()) {
            (true, true) => DeploymentTier::MultiNodePostgresRedis,
            (true, false) => DeploymentTier::MultiNodePostgres,
            (false, _) => DeploymentTier::SingleNode,
        }
    }
}

/// Fully resolved process configuration. Construct with [`Config::from_env`]
/// at process startup, before initializing telemetry or opening the DB
/// pool — both of those take a `&Config`.
#[derive(Debug, Clone)]
pub struct Config {
    /// `DATABASE_URL` — required. `sqlite:...` for [`DeploymentTier::SingleNode`],
    /// `postgres://...`/`postgresql://...` otherwise.
    pub database_url: String,
    /// `REDIS_URL` — optional; presence is one of the two signals that
    /// determine [`Config::deployment_tier`].
    pub redis_url: Option<String>,
    /// `STREAMARR_ROLE` — defaults to [`Role::All`].
    pub role: Role,
    /// `STREAMARR_LOG` — a `tracing-subscriber` `EnvFilter` directive
    /// string (e.g. `"info,streamarr_api=debug"`). Defaults to `"info"`.
    pub log_filter: String,
    /// `STREAMARR_METRICS_BIND_ADDR` — where `streamarr-telemetry::metrics`
    /// exposes its Prometheus-style scrape endpoint. Defaults to
    /// `0.0.0.0:9090` (matches the port baked into `infra/docker/backend.Dockerfile`,
    /// the Kubernetes Helm chart, and `infra/docker/observability/prometheus/prometheus.yml`).
    pub metrics_bind_addr: SocketAddr,
    /// `STREAMARR_HTTP_BIND_ADDR` — where `streamarr-api`'s Axum router
    /// listens. Defaults to `0.0.0.0:8484`.
    pub http_bind_addr: SocketAddr,
    /// Optional native TLS certificate and private key. Both paths must be
    /// configured together; when absent, the listener serves plain HTTP.
    pub tls: Option<TlsConfig>,
    /// Optional authoritative DNS listener for deterministic
    /// `v4-A-B-C-D.relay.playarr.app` names. Disabled when unset.
    pub relay_dns_bind_addr: Option<SocketAddr>,
    /// `STREAMARR_OTLP_ENDPOINT` — optional OTLP collector endpoint; when
    /// unset, `streamarr-telemetry::otel` is a no-op layer.
    pub otlp_endpoint: Option<String>,
    pub deployment_tier: DeploymentTier,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TlsConfig {
    pub cert_path: PathBuf,
    pub key_path: PathBuf,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("missing required environment variable `{0}`")]
    MissingVar(String),
    #[error("invalid value for `{var}`: `{value}` ({reason})")]
    InvalidValue {
        var: String,
        value: String,
        reason: String,
    },
}

/// Signature matches `std::env::var` closely enough that `Config::from_env`
/// can pass it directly, but takes the lookup as a parameter
/// (`from_env_source`) so tests can exercise every branch (missing var,
/// bad role, bad socket addr, tier derivation) without mutating real
/// process environment state, which is inherently racy across parallel
/// `#[test]` threads.
type EnvLookup<'a> = dyn Fn(&str) -> Result<String, VarError> + 'a;

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_env_source(&|key| std::env::var(key))
    }

    pub fn from_env_source(lookup: &EnvLookup<'_>) -> Result<Self, ConfigError> {
        let database_url = required(lookup, "DATABASE_URL")?;
        let redis_url = optional(lookup, "REDIS_URL");

        let role = match optional(lookup, "STREAMARR_ROLE") {
            Some(raw) => Role::parse(&raw)?,
            None => Role::All,
        };

        let log_filter = optional(lookup, "STREAMARR_LOG").unwrap_or_else(|| "info".to_string());
        let metrics_bind_addr = parse_addr(lookup, "STREAMARR_METRICS_BIND_ADDR", "0.0.0.0:9090")?;
        let http_bind_addr = parse_addr(lookup, "STREAMARR_HTTP_BIND_ADDR", "0.0.0.0:8484")?;
        let tls = match (
            optional(lookup, "STREAMARR_TLS_CERT_PATH"),
            optional(lookup, "STREAMARR_TLS_KEY_PATH"),
        ) {
            (None, None) => None,
            (Some(cert_path), Some(key_path)) => Some(TlsConfig {
                cert_path: cert_path.into(),
                key_path: key_path.into(),
            }),
            (cert_path, key_path) => {
                return Err(ConfigError::InvalidValue {
                    var: "STREAMARR_TLS_CERT_PATH/STREAMARR_TLS_KEY_PATH".to_string(),
                    value: format!(
                        "cert={}, key={}",
                        if cert_path.is_some() { "set" } else { "unset" },
                        if key_path.is_some() { "set" } else { "unset" }
                    ),
                    reason: "both paths must be set together".to_string(),
                });
            }
        };
        let relay_dns_bind_addr = match optional(lookup, "STREAMARR_RELAY_DNS_BIND_ADDR") {
            Some(raw) => {
                Some(
                    raw.parse()
                        .map_err(|err: AddrParseError| ConfigError::InvalidValue {
                            var: "STREAMARR_RELAY_DNS_BIND_ADDR".to_string(),
                            value: raw,
                            reason: err.to_string(),
                        })?,
                )
            }
            None => None,
        };
        let otlp_endpoint = optional(lookup, "STREAMARR_OTLP_ENDPOINT");

        let deployment_tier = DeploymentTier::resolve(&database_url, redis_url.as_deref());

        Ok(Config {
            database_url,
            redis_url,
            role,
            log_filter,
            metrics_bind_addr,
            http_bind_addr,
            tls,
            relay_dns_bind_addr,
            otlp_endpoint,
            deployment_tier,
        })
    }
}

fn required(lookup: &EnvLookup<'_>, key: &str) -> Result<String, ConfigError> {
    match lookup(key) {
        Ok(value) if !value.is_empty() => Ok(value),
        _ => Err(ConfigError::MissingVar(key.to_string())),
    }
}

fn optional(lookup: &EnvLookup<'_>, key: &str) -> Option<String> {
    lookup(key).ok().filter(|value| !value.is_empty())
}

fn parse_addr(lookup: &EnvLookup<'_>, key: &str, default: &str) -> Result<SocketAddr, ConfigError> {
    let raw = optional(lookup, key).unwrap_or_else(|| default.to_string());
    raw.parse()
        .map_err(|err: AddrParseError| ConfigError::InvalidValue {
            var: key.to_string(),
            value: raw.clone(),
            reason: err.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn lookup_from(
        map: HashMap<&'static str, &'static str>,
    ) -> impl Fn(&str) -> Result<String, VarError> {
        move |key| {
            map.get(key)
                .map(|v| v.to_string())
                .ok_or(VarError::NotPresent)
        }
    }

    #[test]
    fn missing_database_url_errors() {
        let lookup = lookup_from(HashMap::new());
        let err = Config::from_env_source(&lookup).unwrap_err();
        assert!(matches!(err, ConfigError::MissingVar(var) if var == "DATABASE_URL"));
    }

    #[test]
    fn sqlite_url_resolves_single_node() {
        let lookup = lookup_from(HashMap::from([("DATABASE_URL", "sqlite://streamarr.db")]));
        let config = Config::from_env_source(&lookup).unwrap();
        assert_eq!(config.deployment_tier, DeploymentTier::SingleNode);
        assert_eq!(config.role, Role::All);
        assert_eq!(config.log_filter, "info");
        assert_eq!(config.http_bind_addr, "0.0.0.0:8484".parse().unwrap());
        assert_eq!(config.tls, None);
        assert_eq!(config.relay_dns_bind_addr, None);
    }

    #[test]
    fn tls_paths_must_be_configured_together() {
        let lookup = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://streamarr.db"),
            (
                "STREAMARR_TLS_CERT_PATH",
                "/etc/streamarr/tls/fullchain.pem",
            ),
        ]));
        let err = Config::from_env_source(&lookup).unwrap_err();
        assert!(matches!(err, ConfigError::InvalidValue { var, .. } if var.contains("TLS")));
    }

    #[test]
    fn tls_paths_enable_native_tls() {
        let lookup = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://streamarr.db"),
            (
                "STREAMARR_TLS_CERT_PATH",
                "/etc/streamarr/tls/fullchain.pem",
            ),
            ("STREAMARR_TLS_KEY_PATH", "/etc/streamarr/tls/privkey.pem"),
        ]));
        let config = Config::from_env_source(&lookup).unwrap();
        assert_eq!(
            config.tls,
            Some(TlsConfig {
                cert_path: "/etc/streamarr/tls/fullchain.pem".into(),
                key_path: "/etc/streamarr/tls/privkey.pem".into(),
            })
        );
    }

    #[test]
    fn relay_dns_listener_is_opt_in() {
        let lookup = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://streamarr.db"),
            ("STREAMARR_RELAY_DNS_BIND_ADDR", "0.0.0.0:53"),
        ]));
        let config = Config::from_env_source(&lookup).unwrap();
        assert_eq!(
            config.relay_dns_bind_addr,
            Some("0.0.0.0:53".parse().unwrap())
        );
    }

    #[test]
    fn postgres_without_redis_resolves_multi_node_postgres() {
        let lookup = lookup_from(HashMap::from([(
            "DATABASE_URL",
            "postgres://user:pass@localhost/streamarr",
        )]));
        let config = Config::from_env_source(&lookup).unwrap();
        assert_eq!(config.deployment_tier, DeploymentTier::MultiNodePostgres);
    }

    #[test]
    fn postgres_with_redis_resolves_multi_node_postgres_redis() {
        let lookup = lookup_from(HashMap::from([
            ("DATABASE_URL", "postgresql://user:pass@localhost/streamarr"),
            ("REDIS_URL", "redis://localhost:6379"),
        ]));
        let config = Config::from_env_source(&lookup).unwrap();
        assert_eq!(
            config.deployment_tier,
            DeploymentTier::MultiNodePostgresRedis
        );
    }

    #[test]
    fn invalid_role_errors() {
        let lookup = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://streamarr.db"),
            ("STREAMARR_ROLE", "nonsense"),
        ]));
        let err = Config::from_env_source(&lookup).unwrap_err();
        assert!(matches!(err, ConfigError::InvalidValue { var, .. } if var == "STREAMARR_ROLE"));
    }

    #[test]
    fn role_predicates() {
        assert!(Role::All.runs_api());
        assert!(Role::All.runs_worker());
        assert!(Role::Api.runs_api());
        assert!(!Role::Api.runs_worker());
        assert!(!Role::Worker.runs_api());
        assert!(Role::Worker.runs_worker());
    }
}
