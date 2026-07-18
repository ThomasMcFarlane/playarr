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
    /// `STREAMARR_INSTANCE_NAME` — the operator-facing name clients use to
    /// distinguish this Streamarr deployment. Defaults to `Streamarr`.
    pub instance_name: String,
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
    /// Optional automatic HTTPS configuration. Enabled by
    /// `STREAMARR_ACME_DOMAIN`; mutually exclusive with static TLS paths.
    pub acme: Option<AcmeConfig>,
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

/// Automatic certificate management using Let's Encrypt's ACME service and
/// a dedicated HTTP-01 challenge listener.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcmeConfig {
    pub domain: String,
    pub environment: AcmeEnvironment,
    pub contact: Option<String>,
    pub cache_dir: PathBuf,
    pub http01_bind_addr: SocketAddr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcmeEnvironment {
    Production,
    Staging,
}

impl AcmeEnvironment {
    fn parse(raw: &str) -> Result<Self, ConfigError> {
        match raw.to_ascii_lowercase().as_str() {
            "production" => Ok(Self::Production),
            "staging" => Ok(Self::Staging),
            _ => Err(ConfigError::InvalidValue {
                var: "STREAMARR_ACME_ENVIRONMENT".to_string(),
                value: raw.to_string(),
                reason: "expected one of: production, staging".to_string(),
            }),
        }
    }

    pub fn is_production(self) -> bool {
        matches!(self, Self::Production)
    }
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
        let instance_name = match optional(lookup, "STREAMARR_INSTANCE_NAME") {
            Some(raw) if raw.trim().is_empty() => {
                return Err(ConfigError::InvalidValue {
                    var: "STREAMARR_INSTANCE_NAME".to_string(),
                    value: raw,
                    reason: "must contain at least one non-whitespace character".to_string(),
                });
            }
            Some(raw) => raw.trim().to_string(),
            None => "Streamarr".to_string(),
        };

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
        let acme_domain = optional(lookup, "STREAMARR_ACME_DOMAIN");
        let acme_environment = optional(lookup, "STREAMARR_ACME_ENVIRONMENT");
        let acme_accept_terms = optional(lookup, "STREAMARR_ACME_ACCEPT_TERMS");
        let acme_contact = optional(lookup, "STREAMARR_ACME_CONTACT");
        let acme_cache_dir = optional(lookup, "STREAMARR_ACME_CACHE_DIR");
        let acme_http01_bind_addr = optional(lookup, "STREAMARR_ACME_HTTP01_BIND_ADDR");
        let acme = match acme_domain {
            Some(domain) => {
                if tls.is_some() {
                    return Err(ConfigError::InvalidValue {
                        var: "STREAMARR_ACME_DOMAIN/STREAMARR_TLS_CERT_PATH/STREAMARR_TLS_KEY_PATH"
                            .to_string(),
                        value: "ACME and static TLS both configured".to_string(),
                        reason: "automatic ACME HTTPS and static TLS are mutually exclusive"
                            .to_string(),
                    });
                }
                validate_acme_domain(&domain)?;
                let environment = acme_environment
                    .as_deref()
                    .ok_or_else(|| {
                        ConfigError::MissingVar("STREAMARR_ACME_ENVIRONMENT".to_string())
                    })
                    .and_then(AcmeEnvironment::parse)?;
                match acme_accept_terms.as_deref() {
                    Some("true") => {}
                    Some(value) => {
                        return Err(ConfigError::InvalidValue {
                            var: "STREAMARR_ACME_ACCEPT_TERMS".to_string(),
                            value: value.to_string(),
                            reason:
                                "must be exactly `true` to accept Let's Encrypt's terms of service"
                                    .to_string(),
                        });
                    }
                    None => {
                        return Err(ConfigError::MissingVar(
                            "STREAMARR_ACME_ACCEPT_TERMS".to_string(),
                        ));
                    }
                }
                let http01_bind_addr = acme_http01_bind_addr
                    .as_deref()
                    .unwrap_or("0.0.0.0:80")
                    .parse()
                    .map_err(|err: AddrParseError| ConfigError::InvalidValue {
                        var: "STREAMARR_ACME_HTTP01_BIND_ADDR".to_string(),
                        value: acme_http01_bind_addr
                            .clone()
                            .unwrap_or_else(|| "0.0.0.0:80".to_string()),
                        reason: err.to_string(),
                    })?;
                Some(AcmeConfig {
                    domain,
                    environment,
                    contact: acme_contact
                        .as_deref()
                        .map(normalize_acme_contact)
                        .transpose()?,
                    cache_dir: acme_cache_dir
                        .unwrap_or_else(|| "/var/lib/streamarr/acme".to_string())
                        .into(),
                    http01_bind_addr,
                })
            }
            None => {
                if acme_environment.is_some()
                    || acme_accept_terms.is_some()
                    || acme_contact.is_some()
                    || acme_cache_dir.is_some()
                    || acme_http01_bind_addr.is_some()
                {
                    return Err(ConfigError::InvalidValue {
                        var: "STREAMARR_ACME_DOMAIN".to_string(),
                        value: "unset".to_string(),
                        reason: "must be set when any other STREAMARR_ACME_* variable is set"
                            .to_string(),
                    });
                }
                None
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
            instance_name,
            database_url,
            redis_url,
            role,
            log_filter,
            metrics_bind_addr,
            http_bind_addr,
            tls,
            acme,
            relay_dns_bind_addr,
            otlp_endpoint,
            deployment_tier,
        })
    }
}

fn validate_acme_domain(domain: &str) -> Result<(), ConfigError> {
    if is_valid_dns_name(domain) {
        Ok(())
    } else {
        Err(ConfigError::InvalidValue {
            var: "STREAMARR_ACME_DOMAIN".to_string(),
            value: domain.to_string(),
            reason: "expected a DNS hostname, without a scheme, port, path, or trailing dot"
                .to_string(),
        })
    }
}

fn is_valid_dns_name(domain: &str) -> bool {
    domain.len() <= 253
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && domain.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
}

fn normalize_acme_contact(contact: &str) -> Result<String, ConfigError> {
    let email = contact.strip_prefix("mailto:").unwrap_or(contact);
    let valid = !email.bytes().any(|byte| byte.is_ascii_whitespace())
        && email
            .split_once('@')
            .is_some_and(|(local, domain)| !local.is_empty() && is_valid_dns_name(domain));
    if valid {
        Ok(format!("mailto:{email}"))
    } else {
        Err(ConfigError::InvalidValue {
            var: "STREAMARR_ACME_CONTACT".to_string(),
            value: contact.to_string(),
            reason: "expected an email address or mailto: URI".to_string(),
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
        assert_eq!(config.instance_name, "Streamarr");
        assert_eq!(config.role, Role::All);
        assert_eq!(config.log_filter, "info");
        assert_eq!(config.http_bind_addr, "0.0.0.0:8484".parse().unwrap());
        assert_eq!(config.tls, None);
        assert_eq!(config.acme, None);
        assert_eq!(config.relay_dns_bind_addr, None);
    }

    #[test]
    fn instance_name_can_be_configured() {
        let lookup = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://streamarr.db"),
            ("STREAMARR_INSTANCE_NAME", "  Living Room  "),
        ]));
        let config = Config::from_env_source(&lookup).unwrap();
        assert_eq!(config.instance_name, "Living Room");
    }

    #[test]
    fn whitespace_only_instance_name_errors() {
        let lookup = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://streamarr.db"),
            ("STREAMARR_INSTANCE_NAME", "   "),
        ]));
        let err = Config::from_env_source(&lookup).unwrap_err();
        assert!(
            matches!(err, ConfigError::InvalidValue { var, .. } if var == "STREAMARR_INSTANCE_NAME")
        );
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
    fn acme_requires_an_explicit_environment() {
        let lookup = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://streamarr.db"),
            ("STREAMARR_ACME_DOMAIN", "v4-192-0-2-1.relay.playarr.app"),
            ("STREAMARR_ACME_ACCEPT_TERMS", "true"),
        ]));
        let err = Config::from_env_source(&lookup).unwrap_err();
        assert!(matches!(err, ConfigError::MissingVar(var) if var == "STREAMARR_ACME_ENVIRONMENT"));
    }

    #[test]
    fn acme_requires_explicit_terms_acceptance() {
        let missing = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://streamarr.db"),
            ("STREAMARR_ACME_DOMAIN", "streamarr.example.com"),
            ("STREAMARR_ACME_ENVIRONMENT", "production"),
        ]));
        let err = Config::from_env_source(&missing).unwrap_err();
        assert!(
            matches!(err, ConfigError::MissingVar(var) if var == "STREAMARR_ACME_ACCEPT_TERMS")
        );

        let rejected = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://streamarr.db"),
            ("STREAMARR_ACME_DOMAIN", "streamarr.example.com"),
            ("STREAMARR_ACME_ENVIRONMENT", "production"),
            ("STREAMARR_ACME_ACCEPT_TERMS", "false"),
        ]));
        let err = Config::from_env_source(&rejected).unwrap_err();
        assert!(
            matches!(err, ConfigError::InvalidValue { var, .. } if var == "STREAMARR_ACME_ACCEPT_TERMS")
        );
    }

    #[test]
    fn acme_defaults_cache_and_http01_listener() {
        let lookup = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://streamarr.db"),
            ("STREAMARR_ACME_DOMAIN", "v4-192-0-2-1.relay.playarr.app"),
            ("STREAMARR_ACME_ENVIRONMENT", "production"),
            ("STREAMARR_ACME_ACCEPT_TERMS", "true"),
        ]));
        let config = Config::from_env_source(&lookup).unwrap();
        assert_eq!(
            config.acme,
            Some(AcmeConfig {
                domain: "v4-192-0-2-1.relay.playarr.app".to_string(),
                environment: AcmeEnvironment::Production,
                contact: None,
                cache_dir: "/var/lib/streamarr/acme".into(),
                http01_bind_addr: "0.0.0.0:80".parse().unwrap(),
            })
        );
    }

    #[test]
    fn acme_staging_accepts_contact_and_custom_paths() {
        let lookup = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://streamarr.db"),
            ("STREAMARR_ACME_DOMAIN", "streamarr.example.com"),
            ("STREAMARR_ACME_ENVIRONMENT", "staging"),
            ("STREAMARR_ACME_ACCEPT_TERMS", "true"),
            ("STREAMARR_ACME_CONTACT", "operator@example.com"),
            ("STREAMARR_ACME_CACHE_DIR", "/tmp/streamarr-acme"),
            ("STREAMARR_ACME_HTTP01_BIND_ADDR", "127.0.0.1:8081"),
        ]));
        let config = Config::from_env_source(&lookup).unwrap();
        let acme = config.acme.unwrap();
        assert_eq!(acme.environment, AcmeEnvironment::Staging);
        assert_eq!(acme.contact.as_deref(), Some("mailto:operator@example.com"));
        assert_eq!(acme.cache_dir, PathBuf::from("/tmp/streamarr-acme"));
        assert_eq!(acme.http01_bind_addr, "127.0.0.1:8081".parse().unwrap());
    }

    #[test]
    fn acme_rejects_invalid_environment_and_domain() {
        let invalid_environment = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://streamarr.db"),
            ("STREAMARR_ACME_DOMAIN", "streamarr.example.com"),
            ("STREAMARR_ACME_ENVIRONMENT", "maybe"),
            ("STREAMARR_ACME_ACCEPT_TERMS", "true"),
        ]));
        let err = Config::from_env_source(&invalid_environment).unwrap_err();
        assert!(
            matches!(err, ConfigError::InvalidValue { var, .. } if var == "STREAMARR_ACME_ENVIRONMENT")
        );

        let invalid_domain = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://streamarr.db"),
            ("STREAMARR_ACME_DOMAIN", "https://streamarr.example.com"),
            ("STREAMARR_ACME_ENVIRONMENT", "staging"),
            ("STREAMARR_ACME_ACCEPT_TERMS", "true"),
        ]));
        let err = Config::from_env_source(&invalid_domain).unwrap_err();
        assert!(
            matches!(err, ConfigError::InvalidValue { var, .. } if var == "STREAMARR_ACME_DOMAIN")
        );

        let invalid_contact = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://streamarr.db"),
            ("STREAMARR_ACME_DOMAIN", "streamarr.example.com"),
            ("STREAMARR_ACME_ENVIRONMENT", "staging"),
            ("STREAMARR_ACME_ACCEPT_TERMS", "true"),
            ("STREAMARR_ACME_CONTACT", "https://example.com"),
        ]));
        let err = Config::from_env_source(&invalid_contact).unwrap_err();
        assert!(
            matches!(err, ConfigError::InvalidValue { var, .. } if var == "STREAMARR_ACME_CONTACT")
        );
    }

    #[test]
    fn acme_rejects_static_tls_and_partial_configuration() {
        let both = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://streamarr.db"),
            ("STREAMARR_TLS_CERT_PATH", "/tmp/cert.pem"),
            ("STREAMARR_TLS_KEY_PATH", "/tmp/key.pem"),
            ("STREAMARR_ACME_DOMAIN", "streamarr.example.com"),
            ("STREAMARR_ACME_ENVIRONMENT", "staging"),
            ("STREAMARR_ACME_ACCEPT_TERMS", "true"),
        ]));
        let err = Config::from_env_source(&both).unwrap_err();
        assert!(
            matches!(err, ConfigError::InvalidValue { reason, .. } if reason.contains("mutually exclusive"))
        );

        let missing_domain = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://streamarr.db"),
            ("STREAMARR_ACME_ENVIRONMENT", "staging"),
            ("STREAMARR_ACME_ACCEPT_TERMS", "true"),
        ]));
        let err = Config::from_env_source(&missing_domain).unwrap_err();
        assert!(
            matches!(err, ConfigError::InvalidValue { var, .. } if var == "STREAMARR_ACME_DOMAIN")
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
