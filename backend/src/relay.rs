//! Client side of the Playarr relay "phone-home".
//!
//! A Playarr Server with `PLAYARR_RELAY_REGISTER=true` tells the Playarr Worker
//! (`playarr.app`) which public IPv4 address it has. The Worker answers with a
//! short-lived challenge, calls this server back on
//! `GET /.well-known/playarr-relay/{token}` (port 8484, plain HTTP) and, if the
//! token comes back, publishes the DNS-only record
//! `v4-A-B-C-D.relay.playarr.app`. The same challenge handshake gates the ACME
//! DNS-01 TXT records, so no port 80 and no DNS server run on the cluster.
//! No streaming or API traffic ever passes through Cloudflare.
//!
//! Requests are signed with the node's existing Ed25519 identity
//! (`node_identity`); see `docs/deployment/playarr-relay.md` for the trust
//! model and its limits.

use std::{
    collections::HashMap,
    net::Ipv4Addr,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use anyhow::{anyhow, bail, Context};
use async_trait::async_trait;
use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::IntoResponse,
    routing::get,
    Router,
};
use playarr_peer_sync::PeerIdentity;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub const WELL_KNOWN_PREFIX: &str = "/.well-known/playarr-relay/";
const CHALLENGE_LIFETIME: Duration = Duration::from_secs(180);
/// How often the registration is refreshed even if the address is unchanged.
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(60 * 60);
/// How often the public address is re-checked for changes.
pub const IP_CHECK_INTERVAL: Duration = Duration::from_secs(5 * 60);
const FAILURE_BACKOFF_START: Duration = Duration::from_secs(60);
const FAILURE_BACKOFF_MAX: Duration = Duration::from_secs(15 * 60);

/// Challenge tokens this server has asked the Worker to verify. A token is
/// only ever answered while it is in here, and only for three minutes.
#[derive(Default)]
pub struct ChallengeStore {
    tokens: Mutex<HashMap<String, Instant>>,
}

impl ChallengeStore {
    pub fn publish(&self, token: &str) {
        let mut tokens = self
            .tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = Instant::now();
        tokens.retain(|_, expires| *expires > now);
        tokens.insert(token.to_string(), now + CHALLENGE_LIFETIME);
    }

    pub fn contains(&self, token: &str) -> bool {
        let tokens = self
            .tokens
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        tokens
            .get(token)
            .is_some_and(|expires| *expires > Instant::now())
    }
}

/// `GET /.well-known/playarr-relay/{token}` for the HTTP and HTTPS listeners.
pub fn well_known_router(store: Arc<ChallengeStore>) -> Router {
    async fn serve(
        State(store): State<Arc<ChallengeStore>>,
        Path(token): Path<String>,
    ) -> impl IntoResponse {
        if store.contains(&token) {
            (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
                    (header::CACHE_CONTROL, "no-store"),
                ],
                token,
            )
                .into_response()
        } else {
            StatusCode::NOT_FOUND.into_response()
        }
    }
    Router::new()
        .route("/.well-known/playarr-relay/{token}", get(serve))
        .with_state(store)
}

/// Answers a raw plaintext HTTP request on the TLS port with the challenge
/// token, when it is a `GET` for a published token. Anything else returns
/// `None` and is redirected to HTTPS as before.
pub fn plaintext_challenge_response(request: &[u8], store: &ChallengeStore) -> Option<String> {
    let line = std::str::from_utf8(request).ok()?.lines().next()?;
    let mut parts = line.split_ascii_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    let token = parts.next()?.strip_prefix(WELL_KNOWN_PREFIX)?;
    if token.is_empty() || token.contains(['/', '?', '#']) || !store.contains(token) {
        return None;
    }
    Some(format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{token}",
        token.len()
    ))
}

/// What the server wiring needs: the shared token store and the client.
pub struct RelayRuntime {
    pub challenges: Arc<ChallengeStore>,
    pub client: Arc<RelayClient>,
}

/// A DNS-01 TXT record provider for ACME.
#[async_trait]
pub trait Dns01Provider: Send + Sync {
    async fn set_txt(&self, name: &str, value: &str) -> anyhow::Result<()>;
    async fn clear_txt(&self, name: &str, value: &str) -> anyhow::Result<()>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Registration {
    pub hostname: String,
    pub ip: Ipv4Addr,
}

#[derive(Deserialize)]
struct IpResponse {
    ip: String,
}

#[derive(Deserialize)]
struct IssuedChallenge {
    ip: String,
    challenge: String,
    hostname: String,
}

pub struct RelayClient {
    http: reqwest::Client,
    base_url: String,
    identity: PeerIdentity,
    public_ipv4: Option<Ipv4Addr>,
    challenges: Arc<ChallengeStore>,
}

impl RelayClient {
    pub fn new(
        base_url: &str,
        public_ipv4: Option<Ipv4Addr>,
        identity: PeerIdentity,
        challenges: Arc<ChallengeStore>,
    ) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(concat!("playarr-server/", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(Self {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            identity,
            public_ipv4,
            challenges,
        })
    }

    /// The configured override, else whatever address the Worker sees.
    pub async fn detect_ip(&self) -> anyhow::Result<Ipv4Addr> {
        if let Some(ip) = self.public_ipv4 {
            return Ok(ip);
        }
        let response = self
            .http
            .get(format!("{}/api/relay/ip", self.base_url))
            .send()
            .await
            .context("relay IP discovery request failed")?;
        if !response.status().is_success() {
            bail!("relay IP discovery returned HTTP {}", response.status());
        }
        let body: IpResponse = response
            .json()
            .await
            .context("relay IP discovery response")?;
        body.ip.parse().map_err(|_| {
            anyhow!("relay reported an IPv4 address this server cannot use (is it IPv6-only?)")
        })
    }

    async fn signed(
        &self,
        method: reqwest::Method,
        path: &str,
        body: &Value,
    ) -> anyhow::Result<reqwest::Response> {
        let body = serde_json::to_vec(body)?;
        let timestamp = chrono::Utc::now().timestamp();
        let message = format!(
            "playarr-relay-v1|{method}|{path}|{}|{timestamp}",
            hex::encode(Sha256::digest(&body))
        );
        self.http
            .request(method, format!("{}{path}", self.base_url))
            .header("Content-Type", "application/json")
            .header("X-Playarr-Relay-Key", self.identity.public_key_b64())
            .header(
                "X-Playarr-Relay-Signature",
                self.identity.sign_message(message.as_bytes()),
            )
            .header("X-Playarr-Relay-Timestamp", timestamp.to_string())
            .body(body)
            .send()
            .await
            .context("relay request failed")
    }

    async fn error_for(response: reqwest::Response, action: &str) -> anyhow::Error {
        let status = response.status();
        let code = response
            .json::<Value>()
            .await
            .ok()
            .and_then(|body| body.get("error").and_then(Value::as_str).map(str::to_owned))
            .unwrap_or_else(|| "unknown".to_string());
        anyhow!("{action} was rejected with HTTP {status} ({code})")
    }

    /// Step one: ask the Worker for a challenge and publish it so the Worker's
    /// callback can read it.
    async fn issue_challenge(&self) -> anyhow::Result<IssuedChallenge> {
        let ip = self.detect_ip().await?;
        let response = self
            .signed(
                reqwest::Method::POST,
                "/api/relay/register",
                &json!({ "ip": ip.to_string() }),
            )
            .await?;
        if !response.status().is_success() {
            return Err(Self::error_for(response, "relay challenge request").await);
        }
        let issued: IssuedChallenge = response.json().await.context("relay challenge response")?;
        self.challenges.publish(&issued.challenge);
        Ok(issued)
    }

    /// Registers (or refreshes) `v4-A-B-C-D.relay.playarr.app`.
    pub async fn register(&self) -> anyhow::Result<Registration> {
        let issued = self.issue_challenge().await?;
        let response = self
            .signed(
                reqwest::Method::POST,
                "/api/relay/register",
                &json!({ "ip": issued.ip, "challenge": issued.challenge }),
            )
            .await?;
        if !response.status().is_success() {
            return Err(Self::error_for(response, "relay registration").await);
        }
        Ok(Registration {
            ip: issued
                .ip
                .parse()
                .context("relay returned an invalid address")?,
            hostname: issued.hostname,
        })
    }

    async fn acme_txt(
        &self,
        method: reqwest::Method,
        name: &str,
        value: &str,
    ) -> anyhow::Result<()> {
        let issued = self.issue_challenge().await?;
        let response = self
            .signed(
                method,
                "/api/relay/acme-challenge",
                &json!({ "ip": issued.ip, "challenge": issued.challenge, "name": name, "value": value }),
            )
            .await?;
        if !response.status().is_success() {
            return Err(Self::error_for(response, "relay DNS-01 request").await);
        }
        Ok(())
    }
}

#[async_trait]
impl Dns01Provider for RelayClient {
    async fn set_txt(&self, name: &str, value: &str) -> anyhow::Result<()> {
        self.acme_txt(reqwest::Method::POST, name, value).await
    }

    async fn clear_txt(&self, name: &str, value: &str) -> anyhow::Result<()> {
        self.acme_txt(reqwest::Method::DELETE, name, value).await
    }
}

/// Decides when the next registration call is due. Pure, so it is unit tested
/// without a network or a clock.
pub struct RegistrationSchedule {
    last_ip: Option<Ipv4Addr>,
    last_registered: Option<Instant>,
}

impl RegistrationSchedule {
    pub fn new() -> Self {
        Self {
            last_ip: None,
            last_registered: None,
        }
    }

    pub fn is_due(&self, ip: Ipv4Addr, now: Instant) -> bool {
        self.last_ip != Some(ip)
            || self
                .last_registered
                .is_none_or(|at| now.duration_since(at) >= HEARTBEAT_INTERVAL)
    }

    pub fn record(&mut self, ip: Ipv4Addr, now: Instant) {
        self.last_ip = Some(ip);
        self.last_registered = Some(now);
    }
}

impl Default for RegistrationSchedule {
    fn default() -> Self {
        Self::new()
    }
}

/// One iteration of the phone-home loop: returns the next sleep.
pub async fn registration_tick(
    client: &RelayClient,
    schedule: &mut RegistrationSchedule,
    backoff: &mut Duration,
) -> Duration {
    let outcome = async {
        let ip = client.detect_ip().await?;
        if schedule.is_due(ip, Instant::now()) {
            let registration = client.register().await?;
            schedule.record(ip, Instant::now());
            tracing::info!(hostname = %registration.hostname, ip = %registration.ip, "registered relay hostname");
        }
        anyhow::Ok(())
    }
    .await;
    match outcome {
        Ok(()) => {
            *backoff = FAILURE_BACKOFF_START;
            IP_CHECK_INTERVAL
        }
        Err(error) => {
            let wait = *backoff;
            tracing::warn!(error = %error, retry_in_secs = wait.as_secs(), "relay registration failed");
            *backoff = (*backoff * 2).min(FAILURE_BACKOFF_MAX);
            wait
        }
    }
}

/// Registers on start, on IP change and hourly, for the life of the process.
pub async fn run_registration_loop(client: Arc<RelayClient>) {
    let mut schedule = RegistrationSchedule::new();
    let mut backoff = FAILURE_BACKOFF_START;
    loop {
        let wait = registration_tick(&client, &mut schedule, &mut backoff).await;
        tokio::time::sleep(wait).await;
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use axum::{
        body::Bytes,
        extract::State as AxumState,
        http::{HeaderMap, Method, Uri},
        routing::any,
    };
    use base64::Engine;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    use uuid::Uuid;

    use super::*;

    fn identity() -> PeerIdentity {
        let seed = base64::engine::general_purpose::STANDARD.encode([9u8; 32]);
        PeerIdentity::from_seed_b64(Uuid::new_v4(), &seed).unwrap()
    }

    #[derive(Clone, Default)]
    struct Mock {
        requests: Arc<Mutex<Vec<(String, String, Value)>>>,
        reject_register: Arc<std::sync::atomic::AtomicBool>,
        ip_calls: Arc<AtomicUsize>,
    }

    async fn mock_worker(mock: Mock) -> String {
        async fn handle(
            AxumState(mock): AxumState<Mock>,
            method: Method,
            uri: Uri,
            headers: HeaderMap,
            body: Bytes,
        ) -> axum::response::Response {
            if uri.path() == "/api/relay/ip" {
                mock.ip_calls.fetch_add(1, Ordering::SeqCst);
                return axum::Json(json!({ "ip": "203.0.113.10" })).into_response();
            }
            // Verify the signature exactly as the Worker does.
            let key = base64::engine::general_purpose::STANDARD
                .decode(headers["x-playarr-relay-key"].to_str().unwrap())
                .unwrap();
            let signature = base64::engine::general_purpose::STANDARD
                .decode(headers["x-playarr-relay-signature"].to_str().unwrap())
                .unwrap();
            let timestamp = headers["x-playarr-relay-timestamp"].to_str().unwrap();
            let message = format!(
                "playarr-relay-v1|{method}|{}|{}|{timestamp}",
                uri.path(),
                hex::encode(Sha256::digest(&body))
            );
            VerifyingKey::from_bytes(&key.try_into().unwrap())
                .unwrap()
                .verify(
                    message.as_bytes(),
                    &Signature::from_bytes(&signature.try_into().unwrap()),
                )
                .expect("request signature must verify");
            let parsed: Value = serde_json::from_slice(&body).unwrap();
            mock.requests.lock().unwrap().push((
                method.to_string(),
                uri.path().to_string(),
                parsed.clone(),
            ));
            if parsed.get("challenge").is_none() {
                return axum::Json(json!({
                    "ip": parsed["ip"],
                    "challenge": "tok-123",
                    "hostname": "v4-203-0-113-10.relay.playarr.app",
                }))
                .into_response();
            }
            if mock.reject_register.load(Ordering::SeqCst) {
                return (
                    StatusCode::FORBIDDEN,
                    axum::Json(json!({ "error": "callback_failed" })),
                )
                    .into_response();
            }
            axum::Json(json!({ "ok": true })).into_response()
        }
        let router = Router::new().fallback(any(handle)).with_state(mock);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        format!("http://{address}")
    }

    fn client(base: &str, store: Arc<ChallengeStore>, ip: Option<Ipv4Addr>) -> RelayClient {
        RelayClient::new(base, ip, identity(), store).unwrap()
    }

    #[tokio::test]
    async fn register_discovers_the_ip_signs_both_calls_and_publishes_the_challenge() {
        let mock = Mock::default();
        let base = mock_worker(mock.clone()).await;
        let store = Arc::new(ChallengeStore::default());
        let registration = client(&base, store.clone(), None).register().await.unwrap();

        assert_eq!(
            registration,
            Registration {
                hostname: "v4-203-0-113-10.relay.playarr.app".to_string(),
                ip: "203.0.113.10".parse().unwrap(),
            }
        );
        assert!(
            store.contains("tok-123"),
            "token must be served while the Worker calls back"
        );
        let requests = mock.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].2, json!({ "ip": "203.0.113.10" }));
        assert_eq!(
            requests[1].2,
            json!({ "ip": "203.0.113.10", "challenge": "tok-123" })
        );
        assert_eq!(mock.ip_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn the_configured_public_ipv4_overrides_discovery() {
        let mock = Mock::default();
        let base = mock_worker(mock.clone()).await;
        let store = Arc::new(ChallengeStore::default());
        let override_ip: Ipv4Addr = "203.0.113.20".parse().unwrap();
        client(&base, store, Some(override_ip))
            .register()
            .await
            .unwrap();
        assert_eq!(mock.ip_calls.load(Ordering::SeqCst), 0);
        assert_eq!(
            mock.requests.lock().unwrap()[0].2,
            json!({ "ip": "203.0.113.20" })
        );
    }

    #[tokio::test]
    async fn a_rejected_registration_reports_the_worker_error_code_but_not_the_token() {
        let mock = Mock::default();
        mock.reject_register.store(true, Ordering::SeqCst);
        let base = mock_worker(mock).await;
        let error = client(&base, Arc::new(ChallengeStore::default()), None)
            .register()
            .await
            .unwrap_err()
            .to_string();
        assert!(
            error.contains("403") && error.contains("callback_failed"),
            "{error}"
        );
        assert!(!error.contains("tok-123"));
    }

    #[tokio::test]
    async fn dns01_provider_sets_and_clears_txt_through_the_worker() {
        let mock = Mock::default();
        let base = mock_worker(mock.clone()).await;
        let store = Arc::new(ChallengeStore::default());
        let provider = client(&base, store, None);
        let name = "_acme-challenge.v4-203-0-113-10.relay.playarr.app";
        provider
            .set_txt(name, "value-value-value-value-value")
            .await
            .unwrap();
        provider
            .clear_txt(name, "value-value-value-value-value")
            .await
            .unwrap();

        let requests = mock.requests.lock().unwrap();
        let acme: Vec<_> = requests
            .iter()
            .filter(|(_, path, _)| path == "/api/relay/acme-challenge")
            .collect();
        assert_eq!(acme.len(), 2);
        assert_eq!(acme[0].0, "POST");
        assert_eq!(acme[1].0, "DELETE");
        for (_, _, body) in acme {
            assert_eq!(body["name"], name);
            assert_eq!(body["value"], "value-value-value-value-value");
            assert_eq!(body["challenge"], "tok-123");
        }
    }

    #[tokio::test]
    async fn the_well_known_endpoint_only_serves_published_tokens() {
        use tower::ServiceExt;

        let store = Arc::new(ChallengeStore::default());
        store.publish("abc.def_ghi-123");
        let router = well_known_router(store);
        let ok = router
            .clone()
            .oneshot(
                axum::http::Request::get("/.well-known/playarr-relay/abc.def_ghi-123")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ok.status(), StatusCode::OK);
        let body = axum::body::to_bytes(ok.into_body(), 1024).await.unwrap();
        assert_eq!(&body[..], b"abc.def_ghi-123");

        let missing = router
            .oneshot(
                axum::http::Request::get("/.well-known/playarr-relay/other")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn plaintext_challenge_answers_only_get_for_published_tokens() {
        let store = ChallengeStore::default();
        store.publish("tok");
        let response = plaintext_challenge_response(
            b"GET /.well-known/playarr-relay/tok HTTP/1.1\r\nHost: x\r\n\r\n",
            &store,
        )
        .unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(response.ends_with("\r\n\r\ntok"));
        assert!(response.contains("Content-Length: 3\r\n"));
        for rejected in [
            &b"GET /.well-known/playarr-relay/nope HTTP/1.1\r\n\r\n"[..],
            b"POST /.well-known/playarr-relay/tok HTTP/1.1\r\n\r\n",
            b"GET /.well-known/playarr-relay/tok/extra HTTP/1.1\r\n\r\n",
            b"GET /api/system/health HTTP/1.1\r\n\r\n",
            b"GET /.well-known/playarr-relay/ HTTP/1.1\r\n\r\n",
            b"garbage",
        ] {
            assert!(plaintext_challenge_response(rejected, &store).is_none());
        }
    }

    #[test]
    fn registration_is_due_on_start_ip_change_and_hourly_heartbeat() {
        let first: Ipv4Addr = "203.0.113.10".parse().unwrap();
        let second: Ipv4Addr = "203.0.113.20".parse().unwrap();
        let start = Instant::now();
        let mut schedule = RegistrationSchedule::new();
        assert!(schedule.is_due(first, start), "on start");
        schedule.record(first, start);
        assert!(!schedule.is_due(first, start + Duration::from_secs(300)));
        assert!(
            schedule.is_due(second, start + Duration::from_secs(300)),
            "IP changed"
        );
        assert!(
            schedule.is_due(first, start + HEARTBEAT_INTERVAL),
            "hourly heartbeat"
        );
    }

    #[tokio::test]
    async fn the_tick_registers_once_then_only_checks_the_address_and_backs_off_on_failure() {
        let mock = Mock::default();
        let base = mock_worker(mock.clone()).await;
        let relay = client(&base, Arc::new(ChallengeStore::default()), None);
        let mut schedule = RegistrationSchedule::new();
        let mut backoff = FAILURE_BACKOFF_START;

        assert_eq!(
            registration_tick(&relay, &mut schedule, &mut backoff).await,
            IP_CHECK_INTERVAL
        );
        assert_eq!(
            registration_tick(&relay, &mut schedule, &mut backoff).await,
            IP_CHECK_INTERVAL
        );
        assert_eq!(
            mock.requests.lock().unwrap().len(),
            2,
            "one challenge and one confirmation only"
        );
        assert_eq!(mock.ip_calls.load(Ordering::SeqCst), 3);

        mock.reject_register.store(true, Ordering::SeqCst);
        let mut failing = RegistrationSchedule::new();
        assert_eq!(
            registration_tick(&relay, &mut failing, &mut backoff).await,
            Duration::from_secs(60)
        );
        assert_eq!(
            registration_tick(&relay, &mut failing, &mut backoff).await,
            Duration::from_secs(120)
        );
    }
}
