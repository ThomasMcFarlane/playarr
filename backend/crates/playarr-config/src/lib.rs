//! `playarr-config` — environment-driven configuration for every
//! Playarr Server backend process (the combined `playarr` binary, and any
//! future split API/worker binaries).
//!
//! Deliberately hand-rolled on top of `std::env` rather than a config
//! framework: this crate is loaded before `playarr-telemetry` sets up
//! tracing, so a config error has to be reportable with nothing fancier
//! than `Display`, and we want zero surprise precedence rules (no
//! layered file+env+CLI merging) at the one layer where operators most
//! need predictability.

use std::env::VarError;
use std::fmt;
use std::net::{AddrParseError, Ipv4Addr, SocketAddr};
use std::path::PathBuf;

/// Which responsibilities this process instance takes on. Set via
/// `PLAYARR_ROLE`; determines whether `playarr-bin` boots the Axum
/// HTTP server, the background worker loops (arr-sync poller, transcode
/// dispatcher, analytics rollup), or both — see `Role::runs_api` /
/// `Role::runs_worker`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    /// Everything in one process. The default, and the only sane choice
    /// for single-process deployments.
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
                var: "PLAYARR_ROLE".to_string(),
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

/// Fully resolved process configuration. Construct with [`Config::from_env`]
/// at process startup, before initializing telemetry or opening the DB
/// pool — both of those take a `&Config`.
#[derive(Debug, Clone)]
pub struct Config {
    /// `DATABASE_URL` — required, and must be a `sqlite:` URL: SQLite is the
    /// only supported storage engine (ADR 0002).
    pub database_url: String,
    /// `PLAYARR_ROLE` — defaults to [`Role::All`].
    pub role: Role,
    /// `PLAYARR_LOG` — a `tracing-subscriber` `EnvFilter` directive
    /// string (e.g. `"info,playarr_api=debug"`). Defaults to `"info"`.
    pub log_filter: String,
    /// `PLAYARR_METRICS_BIND_ADDR` — where `playarr-telemetry::metrics`
    /// exposes its Prometheus-style scrape endpoint. Defaults to
    /// `0.0.0.0:9090` (matches the port baked into `infra/docker/backend.Dockerfile`,
    /// the Kubernetes Helm chart, and `infra/docker/observability/prometheus/prometheus.yml`).
    pub metrics_bind_addr: SocketAddr,
    /// `PLAYARR_HTTP_BIND_ADDR` — where `playarr-api`'s Axum router
    /// listens. Defaults to `0.0.0.0:8484`.
    pub http_bind_addr: SocketAddr,
    /// Optional native TLS certificate and private key. Both paths must be
    /// configured together; when absent, the listener serves plain HTTP.
    pub tls: Option<TlsConfig>,
    /// Optional automatic HTTPS configuration. Enabled by
    /// `PLAYARR_ACME_DOMAIN`; mutually exclusive with static TLS paths, except
    /// for the `relay-dns-01` challenge (both certificates, chosen by SNI).
    pub acme: Option<AcmeConfig>,
    /// Optional relay phone-home (`PLAYARR_RELAY_REGISTER=true`): the server
    /// tells the Playarr Worker its public IPv4 address so
    /// `v4-A-B-C-D.relay.playarr.app` resolves to it.
    pub relay: Option<RelayConfig>,
    /// `PLAYARR_OTLP_ENDPOINT` — optional OTLP collector endpoint; when
    /// unset, `playarr-telemetry::otel` is a no-op layer.
    pub otlp_endpoint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TlsConfig {
    pub cert_path: PathBuf,
    pub key_path: PathBuf,
}

/// Relay registration with the Playarr Worker.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelayConfig {
    /// `PLAYARR_RELAY_URL`, default `https://playarr.app`.
    pub base_url: String,
    /// `PLAYARR_PUBLIC_IPV4` override; otherwise the Worker reports the
    /// address it sees (`CF-Connecting-IP`).
    pub public_ipv4: Option<Ipv4Addr>,
}

/// How an ACME certificate is proven.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcmeChallenge {
    /// HTTP-01 on a dedicated listener (default).
    Http01,
    /// DNS-01 through the Playarr Worker (`PLAYARR_ACME_CHALLENGE=relay-dns-01`),
    /// which needs no port 80.
    RelayDns01,
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
    pub challenge: AcmeChallenge,
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
                var: "PLAYARR_ACME_ENVIRONMENT".to_string(),
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
/// bad role, bad socket addr) without mutating real
/// process environment state, which is inherently racy across parallel
/// `#[test]` threads.
type EnvLookup<'a> = dyn Fn(&str) -> Result<String, VarError> + 'a;

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_env_source(&|key| std::env::var(key))
    }

    pub fn from_env_source(lookup: &EnvLookup<'_>) -> Result<Self, ConfigError> {
        let database_url = required(lookup, "DATABASE_URL")?;
        validate_database_url(&database_url)?;
        let role = match optional(lookup, "PLAYARR_ROLE") {
            Some(raw) => Role::parse(&raw)?,
            None => Role::All,
        };

        let log_filter = optional(lookup, "PLAYARR_LOG").unwrap_or_else(|| "info".to_string());
        let metrics_bind_addr = parse_addr(lookup, "PLAYARR_METRICS_BIND_ADDR", "0.0.0.0:9090")?;
        let http_bind_addr = parse_addr(lookup, "PLAYARR_HTTP_BIND_ADDR", "0.0.0.0:8484")?;
        let tls = match (
            optional(lookup, "PLAYARR_TLS_CERT_PATH"),
            optional(lookup, "PLAYARR_TLS_KEY_PATH"),
        ) {
            (None, None) => None,
            (Some(cert_path), Some(key_path)) => Some(TlsConfig {
                cert_path: cert_path.into(),
                key_path: key_path.into(),
            }),
            (cert_path, key_path) => {
                return Err(ConfigError::InvalidValue {
                    var: "PLAYARR_TLS_CERT_PATH/PLAYARR_TLS_KEY_PATH".to_string(),
                    value: format!(
                        "cert={}, key={}",
                        if cert_path.is_some() { "set" } else { "unset" },
                        if key_path.is_some() { "set" } else { "unset" }
                    ),
                    reason: "both paths must be set together".to_string(),
                });
            }
        };
        let acme_domain = optional(lookup, "PLAYARR_ACME_DOMAIN");
        let acme_environment = optional(lookup, "PLAYARR_ACME_ENVIRONMENT");
        let acme_accept_terms = optional(lookup, "PLAYARR_ACME_ACCEPT_TERMS");
        let acme_contact = optional(lookup, "PLAYARR_ACME_CONTACT");
        let acme_cache_dir = optional(lookup, "PLAYARR_ACME_CACHE_DIR");
        let acme_http01_bind_addr = optional(lookup, "PLAYARR_ACME_HTTP01_BIND_ADDR");
        let acme_challenge = optional(lookup, "PLAYARR_ACME_CHALLENGE");
        let acme = match acme_domain {
            Some(domain) => {
                // Static TLS may only be combined with the relay DNS-01
                // certificate (checked below): the server then holds both and
                // picks one by SNI. HTTP-01 ACME stays exclusive with it.
                if tls.is_some() && acme_challenge.as_deref() != Some("relay-dns-01") {
                    return Err(ConfigError::InvalidValue {
                        var: "PLAYARR_ACME_DOMAIN/PLAYARR_TLS_CERT_PATH/PLAYARR_TLS_KEY_PATH"
                            .to_string(),
                        value: "ACME and static TLS both configured".to_string(),
                        reason: "automatic ACME HTTPS and static TLS are mutually exclusive unless PLAYARR_ACME_CHALLENGE=relay-dns-01"
                            .to_string(),
                    });
                }
                validate_acme_domain(&domain)?;
                let environment = acme_environment
                    .as_deref()
                    .ok_or_else(|| ConfigError::MissingVar("PLAYARR_ACME_ENVIRONMENT".to_string()))
                    .and_then(AcmeEnvironment::parse)?;
                match acme_accept_terms.as_deref() {
                    Some("true") => {}
                    Some(value) => {
                        return Err(ConfigError::InvalidValue {
                            var: "PLAYARR_ACME_ACCEPT_TERMS".to_string(),
                            value: value.to_string(),
                            reason:
                                "must be exactly `true` to accept Let's Encrypt's terms of service"
                                    .to_string(),
                        });
                    }
                    None => {
                        return Err(ConfigError::MissingVar(
                            "PLAYARR_ACME_ACCEPT_TERMS".to_string(),
                        ));
                    }
                }
                let challenge = match acme_challenge.as_deref() {
                    None | Some("http-01") => AcmeChallenge::Http01,
                    Some("relay-dns-01") => AcmeChallenge::RelayDns01,
                    Some(value) => {
                        return Err(ConfigError::InvalidValue {
                            var: "PLAYARR_ACME_CHALLENGE".to_string(),
                            value: value.to_string(),
                            reason: "expected one of: http-01, relay-dns-01".to_string(),
                        });
                    }
                };
                if challenge == AcmeChallenge::RelayDns01
                    && !(domain.starts_with("v4-") && domain.ends_with(".relay.playarr.app"))
                {
                    return Err(ConfigError::InvalidValue {
                        var: "PLAYARR_ACME_DOMAIN".to_string(),
                        value: domain,
                        reason: "relay-dns-01 only issues v4-A-B-C-D.relay.playarr.app names"
                            .to_string(),
                    });
                }
                let http01_bind_addr = acme_http01_bind_addr
                    .as_deref()
                    .unwrap_or("0.0.0.0:80")
                    .parse()
                    .map_err(|err: AddrParseError| ConfigError::InvalidValue {
                        var: "PLAYARR_ACME_HTTP01_BIND_ADDR".to_string(),
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
                        .unwrap_or_else(|| "/var/lib/playarr/acme".to_string())
                        .into(),
                    http01_bind_addr,
                    challenge,
                })
            }
            None => {
                if acme_environment.is_some()
                    || acme_accept_terms.is_some()
                    || acme_contact.is_some()
                    || acme_cache_dir.is_some()
                    || acme_http01_bind_addr.is_some()
                    || acme_challenge.is_some()
                {
                    return Err(ConfigError::InvalidValue {
                        var: "PLAYARR_ACME_DOMAIN".to_string(),
                        value: "unset".to_string(),
                        reason: "must be set when any other PLAYARR_ACME_* variable is set"
                            .to_string(),
                    });
                }
                None
            }
        };
        let relay = parse_relay(lookup)?;
        if matches!(&acme, Some(acme) if acme.challenge == AcmeChallenge::RelayDns01)
            && relay.is_none()
        {
            return Err(ConfigError::InvalidValue {
                var: "PLAYARR_ACME_CHALLENGE".to_string(),
                value: "relay-dns-01".to_string(),
                reason: "requires PLAYARR_RELAY_REGISTER=true".to_string(),
            });
        }
        let relay_acme = matches!(&acme, Some(acme) if acme.challenge == AcmeChallenge::RelayDns01);
        if relay.is_some() && tls.is_some() && !relay_acme {
            return Err(ConfigError::InvalidValue {
                var: "PLAYARR_RELAY_REGISTER".to_string(),
                value: "true".to_string(),
                reason: "the relay callback needs the ACME or plain HTTP listener; it can only be combined with static TLS paths when PLAYARR_ACME_CHALLENGE=relay-dns-01".to_string(),
            });
        }
        let otlp_endpoint = optional(lookup, "PLAYARR_OTLP_ENDPOINT");

        Ok(Config {
            database_url,
            role,
            log_filter,
            metrics_bind_addr,
            http_bind_addr,
            tls,
            acme,
            relay,
            otlp_endpoint,
        })
    }
}

/// Playarr is SQLite-only (ADR 0002). Fail fast, with an actionable message,
/// on anything that is not a `sqlite:` URL; a Postgres URL gets a specific
/// explanation. The URL itself is never echoed (it may carry a password).
fn validate_database_url(database_url: &str) -> Result<(), ConfigError> {
    let lower = database_url.trim_start().to_ascii_lowercase();
    if lower.starts_with("sqlite:") {
        return Ok(());
    }
    let reason = if lower.starts_with("postgres://") || lower.starts_with("postgresql://") {
        "Postgres is no longer supported: Playarr is SQLite-only (see ADR 0002). \
         Use a `sqlite:` URL such as `sqlite:///data/playarr.db`"
    } else {
        "only `sqlite:` URLs are supported (see ADR 0002), for example `sqlite:///data/playarr.db`"
    };
    Err(ConfigError::InvalidValue {
        var: "DATABASE_URL".to_string(),
        value: "<redacted>".to_string(),
        reason: reason.to_string(),
    })
}

fn parse_relay(lookup: &EnvLookup<'_>) -> Result<Option<RelayConfig>, ConfigError> {
    let register = optional(lookup, "PLAYARR_RELAY_REGISTER");
    let url = optional(lookup, "PLAYARR_RELAY_URL");
    let public_ipv4 = optional(lookup, "PLAYARR_PUBLIC_IPV4");
    match register.as_deref() {
        Some("true") => {}
        Some("false") | None => {
            if url.is_some() || public_ipv4.is_some() {
                return Err(ConfigError::InvalidValue {
                    var: "PLAYARR_RELAY_REGISTER".to_string(),
                    value: register.unwrap_or_else(|| "unset".to_string()),
                    reason: "must be `true` when PLAYARR_RELAY_URL or PLAYARR_PUBLIC_IPV4 is set"
                        .to_string(),
                });
            }
            return Ok(None);
        }
        Some(value) => {
            return Err(ConfigError::InvalidValue {
                var: "PLAYARR_RELAY_REGISTER".to_string(),
                value: value.to_string(),
                reason: "expected `true` or `false`".to_string(),
            });
        }
    }
    let base_url = url
        .unwrap_or_else(|| "https://playarr.app".to_string())
        .trim_end_matches('/')
        .to_string();
    let local_test_url =
        base_url.starts_with("http://127.0.0.1") || base_url.starts_with("http://localhost");
    if !(base_url.starts_with("https://") || local_test_url)
        || base_url[base_url.find("//").unwrap() + 2..].contains('/')
    {
        return Err(ConfigError::InvalidValue {
            var: "PLAYARR_RELAY_URL".to_string(),
            value: base_url,
            reason: "expected an https origin without a path".to_string(),
        });
    }
    let public_ipv4 = public_ipv4
        .map(|raw| {
            raw.parse::<Ipv4Addr>()
                .map_err(|err| ConfigError::InvalidValue {
                    var: "PLAYARR_PUBLIC_IPV4".to_string(),
                    value: raw,
                    reason: err.to_string(),
                })
        })
        .transpose()?;
    Ok(Some(RelayConfig {
        base_url,
        public_ipv4,
    }))
}

fn validate_acme_domain(domain: &str) -> Result<(), ConfigError> {
    if is_valid_dns_name(domain) {
        Ok(())
    } else {
        Err(ConfigError::InvalidValue {
            var: "PLAYARR_ACME_DOMAIN".to_string(),
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
            var: "PLAYARR_ACME_CONTACT".to_string(),
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
    fn sqlite_url_is_accepted_with_defaults() {
        let lookup = lookup_from(HashMap::from([("DATABASE_URL", "sqlite://playarr.db")]));
        let config = Config::from_env_source(&lookup).unwrap();
        assert_eq!(config.role, Role::All);
        assert_eq!(config.log_filter, "info");
        assert_eq!(config.http_bind_addr, "0.0.0.0:8484".parse().unwrap());
        assert_eq!(config.tls, None);
        assert_eq!(config.acme, None);
        assert_eq!(config.relay, None);
    }

    #[test]
    fn tls_paths_must_be_configured_together() {
        let lookup = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://playarr.db"),
            ("PLAYARR_TLS_CERT_PATH", "/etc/playarr/tls/fullchain.pem"),
        ]));
        let err = Config::from_env_source(&lookup).unwrap_err();
        assert!(matches!(err, ConfigError::InvalidValue { var, .. } if var.contains("TLS")));
    }

    #[test]
    fn tls_paths_enable_native_tls() {
        let lookup = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://playarr.db"),
            ("PLAYARR_TLS_CERT_PATH", "/etc/playarr/tls/fullchain.pem"),
            ("PLAYARR_TLS_KEY_PATH", "/etc/playarr/tls/privkey.pem"),
        ]));
        let config = Config::from_env_source(&lookup).unwrap();
        assert_eq!(
            config.tls,
            Some(TlsConfig {
                cert_path: "/etc/playarr/tls/fullchain.pem".into(),
                key_path: "/etc/playarr/tls/privkey.pem".into(),
            })
        );
    }

    #[test]
    fn acme_requires_an_explicit_environment() {
        let lookup = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://playarr.db"),
            ("PLAYARR_ACME_DOMAIN", "v4-192-0-2-1.relay.playarr.app"),
            ("PLAYARR_ACME_ACCEPT_TERMS", "true"),
        ]));
        let err = Config::from_env_source(&lookup).unwrap_err();
        assert!(matches!(err, ConfigError::MissingVar(var) if var == "PLAYARR_ACME_ENVIRONMENT"));
    }

    #[test]
    fn acme_requires_explicit_terms_acceptance() {
        let missing = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://playarr.db"),
            ("PLAYARR_ACME_DOMAIN", "playarr.example.com"),
            ("PLAYARR_ACME_ENVIRONMENT", "production"),
        ]));
        let err = Config::from_env_source(&missing).unwrap_err();
        assert!(matches!(err, ConfigError::MissingVar(var) if var == "PLAYARR_ACME_ACCEPT_TERMS"));

        let rejected = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://playarr.db"),
            ("PLAYARR_ACME_DOMAIN", "playarr.example.com"),
            ("PLAYARR_ACME_ENVIRONMENT", "production"),
            ("PLAYARR_ACME_ACCEPT_TERMS", "false"),
        ]));
        let err = Config::from_env_source(&rejected).unwrap_err();
        assert!(
            matches!(err, ConfigError::InvalidValue { var, .. } if var == "PLAYARR_ACME_ACCEPT_TERMS")
        );
    }

    #[test]
    fn acme_defaults_cache_and_http01_listener() {
        let lookup = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://playarr.db"),
            ("PLAYARR_ACME_DOMAIN", "v4-192-0-2-1.relay.playarr.app"),
            ("PLAYARR_ACME_ENVIRONMENT", "production"),
            ("PLAYARR_ACME_ACCEPT_TERMS", "true"),
        ]));
        let config = Config::from_env_source(&lookup).unwrap();
        assert_eq!(
            config.acme,
            Some(AcmeConfig {
                domain: "v4-192-0-2-1.relay.playarr.app".to_string(),
                environment: AcmeEnvironment::Production,
                contact: None,
                cache_dir: "/var/lib/playarr/acme".into(),
                http01_bind_addr: "0.0.0.0:80".parse().unwrap(),
                challenge: AcmeChallenge::Http01,
            })
        );
    }

    #[test]
    fn acme_staging_accepts_contact_and_custom_paths() {
        let lookup = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://playarr.db"),
            ("PLAYARR_ACME_DOMAIN", "playarr.example.com"),
            ("PLAYARR_ACME_ENVIRONMENT", "staging"),
            ("PLAYARR_ACME_ACCEPT_TERMS", "true"),
            ("PLAYARR_ACME_CONTACT", "operator@example.com"),
            ("PLAYARR_ACME_CACHE_DIR", "/tmp/playarr-acme"),
            ("PLAYARR_ACME_HTTP01_BIND_ADDR", "127.0.0.1:8081"),
        ]));
        let config = Config::from_env_source(&lookup).unwrap();
        let acme = config.acme.unwrap();
        assert_eq!(acme.environment, AcmeEnvironment::Staging);
        assert_eq!(acme.contact.as_deref(), Some("mailto:operator@example.com"));
        assert_eq!(acme.cache_dir, PathBuf::from("/tmp/playarr-acme"));
        assert_eq!(acme.http01_bind_addr, "127.0.0.1:8081".parse().unwrap());
    }

    #[test]
    fn acme_rejects_invalid_environment_and_domain() {
        let invalid_environment = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://playarr.db"),
            ("PLAYARR_ACME_DOMAIN", "playarr.example.com"),
            ("PLAYARR_ACME_ENVIRONMENT", "maybe"),
            ("PLAYARR_ACME_ACCEPT_TERMS", "true"),
        ]));
        let err = Config::from_env_source(&invalid_environment).unwrap_err();
        assert!(
            matches!(err, ConfigError::InvalidValue { var, .. } if var == "PLAYARR_ACME_ENVIRONMENT")
        );

        let invalid_domain = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://playarr.db"),
            ("PLAYARR_ACME_DOMAIN", "https://playarr.example.com"),
            ("PLAYARR_ACME_ENVIRONMENT", "staging"),
            ("PLAYARR_ACME_ACCEPT_TERMS", "true"),
        ]));
        let err = Config::from_env_source(&invalid_domain).unwrap_err();
        assert!(
            matches!(err, ConfigError::InvalidValue { var, .. } if var == "PLAYARR_ACME_DOMAIN")
        );

        let invalid_contact = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://playarr.db"),
            ("PLAYARR_ACME_DOMAIN", "playarr.example.com"),
            ("PLAYARR_ACME_ENVIRONMENT", "staging"),
            ("PLAYARR_ACME_ACCEPT_TERMS", "true"),
            ("PLAYARR_ACME_CONTACT", "https://example.com"),
        ]));
        let err = Config::from_env_source(&invalid_contact).unwrap_err();
        assert!(
            matches!(err, ConfigError::InvalidValue { var, .. } if var == "PLAYARR_ACME_CONTACT")
        );
    }

    #[test]
    fn acme_rejects_static_tls_and_partial_configuration() {
        let both = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://playarr.db"),
            ("PLAYARR_TLS_CERT_PATH", "/tmp/cert.pem"),
            ("PLAYARR_TLS_KEY_PATH", "/tmp/key.pem"),
            ("PLAYARR_ACME_DOMAIN", "playarr.example.com"),
            ("PLAYARR_ACME_ENVIRONMENT", "staging"),
            ("PLAYARR_ACME_ACCEPT_TERMS", "true"),
        ]));
        let err = Config::from_env_source(&both).unwrap_err();
        assert!(
            matches!(err, ConfigError::InvalidValue { reason, .. } if reason.contains("mutually exclusive"))
        );

        let missing_domain = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://playarr.db"),
            ("PLAYARR_ACME_ENVIRONMENT", "staging"),
            ("PLAYARR_ACME_ACCEPT_TERMS", "true"),
        ]));
        let err = Config::from_env_source(&missing_domain).unwrap_err();
        assert!(
            matches!(err, ConfigError::InvalidValue { var, .. } if var == "PLAYARR_ACME_DOMAIN")
        );
    }

    #[test]
    fn relay_dns01_coexists_with_static_tls_but_http01_and_bare_relay_do_not() {
        let base = [
            ("PLAYARR_TLS_CERT_PATH", "/tls/tls.crt"),
            ("PLAYARR_TLS_KEY_PATH", "/tls/tls.key"),
        ];
        let relay = [
            ("PLAYARR_RELAY_REGISTER", "true"),
            ("PLAYARR_ACME_DOMAIN", "v4-203-0-113-10.relay.playarr.app"),
            ("PLAYARR_ACME_ENVIRONMENT", "staging"),
            ("PLAYARR_ACME_ACCEPT_TERMS", "true"),
            ("PLAYARR_ACME_CHALLENGE", "relay-dns-01"),
        ];
        let both: Vec<_> = base.iter().chain(relay.iter()).copied().collect();
        let config = relay_env(&both).unwrap();
        assert!(config.tls.is_some());
        assert_eq!(config.acme.unwrap().challenge, AcmeChallenge::RelayDns01);
        assert!(config.relay.is_some());

        // Static TLS plus registration without the relay certificate is still rejected.
        let bare: Vec<_> = base
            .iter()
            .copied()
            .chain([("PLAYARR_RELAY_REGISTER", "true")])
            .collect();
        assert!(relay_env(&bare).is_err());

        // HTTP-01 ACME stays exclusive with static TLS.
        let http01: Vec<_> = base
            .iter()
            .copied()
            .chain([
                ("PLAYARR_ACME_DOMAIN", "playarr.example.com"),
                ("PLAYARR_ACME_ENVIRONMENT", "staging"),
                ("PLAYARR_ACME_ACCEPT_TERMS", "true"),
            ])
            .collect();
        assert!(relay_env(&http01).is_err());
    }

    fn relay_env(extra: &[(&'static str, &'static str)]) -> Result<Config, ConfigError> {
        let mut vars = HashMap::from([("DATABASE_URL", "sqlite://playarr.db")]);
        vars.extend(extra.iter().copied());
        Config::from_env_source(&lookup_from(vars))
    }

    #[test]
    fn relay_registration_is_opt_in_and_defaults_to_playarr_app() {
        assert_eq!(relay_env(&[]).unwrap().relay, None);
        assert_eq!(
            relay_env(&[("PLAYARR_RELAY_REGISTER", "true")])
                .unwrap()
                .relay,
            Some(RelayConfig {
                base_url: "https://playarr.app".to_string(),
                public_ipv4: None,
            })
        );
    }

    #[test]
    fn relay_accepts_an_ipv4_override_and_rejects_bad_settings() {
        assert_eq!(
            relay_env(&[
                ("PLAYARR_RELAY_REGISTER", "true"),
                ("PLAYARR_PUBLIC_IPV4", "203.0.113.10"),
                ("PLAYARR_RELAY_URL", "https://playarr.app/"),
            ])
            .unwrap()
            .relay,
            Some(RelayConfig {
                base_url: "https://playarr.app".to_string(),
                public_ipv4: Some("203.0.113.10".parse().unwrap()),
            })
        );
        for (var, extra) in [
            ("PLAYARR_PUBLIC_IPV4", vec![("PLAYARR_PUBLIC_IPV4", "::1")]),
            (
                "PLAYARR_RELAY_URL",
                vec![("PLAYARR_RELAY_URL", "http://example.com")],
            ),
            (
                "PLAYARR_RELAY_URL",
                vec![("PLAYARR_RELAY_URL", "https://playarr.app/api")],
            ),
        ] {
            let mut vars = vec![("PLAYARR_RELAY_REGISTER", "true")];
            vars.extend(extra);
            let err = relay_env(&vars).unwrap_err();
            assert!(
                matches!(err, ConfigError::InvalidValue { var: found, .. } if found == var),
                "{var}"
            );
        }
        for stray in [
            ("PLAYARR_PUBLIC_IPV4", "203.0.113.10"),
            ("PLAYARR_RELAY_URL", "https://playarr.app"),
        ] {
            let err = relay_env(&[stray]).unwrap_err();
            assert!(
                matches!(err, ConfigError::InvalidValue { var, .. } if var == "PLAYARR_RELAY_REGISTER")
            );
        }
    }

    #[test]
    fn relay_dns01_needs_registration_and_a_relay_name() {
        let acme = [
            ("PLAYARR_ACME_ENVIRONMENT", "production"),
            ("PLAYARR_ACME_ACCEPT_TERMS", "true"),
            ("PLAYARR_ACME_CHALLENGE", "relay-dns-01"),
        ];
        let mut base = vec![("PLAYARR_ACME_DOMAIN", "v4-203-0-113-10.relay.playarr.app")];
        base.extend(acme);
        let err = relay_env(&base).unwrap_err();
        assert!(
            matches!(err, ConfigError::InvalidValue { var, .. } if var == "PLAYARR_ACME_CHALLENGE")
        );

        base.push(("PLAYARR_RELAY_REGISTER", "true"));
        let config = relay_env(&base).unwrap();
        assert_eq!(config.acme.unwrap().challenge, AcmeChallenge::RelayDns01);

        let mut other = vec![
            ("PLAYARR_ACME_DOMAIN", "playarr.example.com"),
            ("PLAYARR_RELAY_REGISTER", "true"),
        ];
        other.extend(acme);
        let err = relay_env(&other).unwrap_err();
        assert!(
            matches!(err, ConfigError::InvalidValue { var, .. } if var == "PLAYARR_ACME_DOMAIN")
        );
    }

    #[test]
    fn unknown_acme_challenges_are_rejected_and_the_former_relay_dns_variables_are_gone() {
        let err = relay_env(&[
            ("PLAYARR_ACME_DOMAIN", "playarr.example.com"),
            ("PLAYARR_ACME_ENVIRONMENT", "production"),
            ("PLAYARR_ACME_ACCEPT_TERMS", "true"),
            ("PLAYARR_ACME_CHALLENGE", "tls-alpn-01"),
        ])
        .unwrap_err();
        assert!(
            matches!(err, ConfigError::InvalidValue { var, .. } if var == "PLAYARR_ACME_CHALLENGE")
        );
        // The in-process authoritative DNS server was removed: the variables are ignored.
        assert_eq!(
            relay_env(&[("PLAYARR_RELAY_DNS_BIND_ADDR", "0.0.0.0:53")])
                .unwrap()
                .relay,
            None
        );
    }

    #[test]
    fn postgres_urls_are_rejected_with_a_clear_error() {
        for url in [
            "postgres://user:secret@localhost/playarr",
            "postgresql://user:secret@localhost/playarr",
            "POSTGRES://user:secret@localhost/playarr",
        ] {
            let lookup = lookup_from(HashMap::from([("DATABASE_URL", url)]));
            let err = Config::from_env_source(&lookup).unwrap_err();
            let message = err.to_string();
            assert!(
                matches!(&err, ConfigError::InvalidValue { var, .. } if var == "DATABASE_URL"),
                "{message}"
            );
            assert!(message.contains("SQLite-only"), "{message}");
            assert!(
                !message.contains("secret"),
                "must not echo the URL: {message}"
            );
        }
    }

    #[test]
    fn non_sqlite_urls_are_rejected() {
        let lookup = lookup_from(HashMap::from([(
            "DATABASE_URL",
            "mysql://localhost/playarr",
        )]));
        let err = Config::from_env_source(&lookup).unwrap_err();
        assert!(err.to_string().contains("only `sqlite:` URLs"));
    }

    #[test]
    fn invalid_role_errors() {
        let lookup = lookup_from(HashMap::from([
            ("DATABASE_URL", "sqlite://playarr.db"),
            ("PLAYARR_ROLE", "nonsense"),
        ]));
        let err = Config::from_env_source(&lookup).unwrap_err();
        assert!(matches!(err, ConfigError::InvalidValue { var, .. } if var == "PLAYARR_ROLE"));
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
