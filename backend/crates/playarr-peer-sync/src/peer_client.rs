//! A signed HTTP client for calling another peer's `/api/v1/peer/*`
//! endpoints -- `docs/architecture/peer-groups.md` §3.3/§3.6.
//!
//! [`PeerClient`] attaches the `X-Playarr-Peer-Id`/`-Signature`/
//! `-Timestamp`/`-Nonce` headers `playarr-api::peer_extractor::
//! PeerSignedRequest` verifies (via [`crate::signing`]) to every request
//! except [`PeerClient::enroll`], which is bearer-authed by the one-shot
//! join token instead -- there is no `peer_nodes` row for the caller to
//! sign against yet (see `playarr-api::peer::enroll_handler`'s own doc
//! comment). Every sync module (`membership_sync`/`account_sync`/
//! `availability_sync`) and `enroll.rs` call through this one client rather
//! than building their own `reqwest` calls, so the signing/header/error
//! handling lives in exactly one place.

use std::net::SocketAddr;

use playarr_model::PeerAddress;
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::signing::PeerIdentity;

pub const PEER_ID_HEADER: &str = "x-playarr-peer-id";
pub const SIGNATURE_HEADER: &str = "x-playarr-signature";
pub const TIMESTAMP_HEADER: &str = "x-playarr-timestamp";
pub const NONCE_HEADER: &str = "x-playarr-nonce";
pub const INTERNAL_PEER_ROUTES_ENV: &str = "PLAYARR_PEER_INTERNAL_ROUTES";

/// An opt-in server-to-server route. The request URL keeps `tls_hostname`
/// (and therefore SNI and certificate verification) while DNS resolution is
/// directed to `service_host` inside the cluster.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InternalPeerRoute {
    pub peer_id: uuid::Uuid,
    pub tls_hostname: String,
    pub service_host: String,
    pub service_port: u16,
}

#[derive(Clone, Debug, Default)]
pub struct PeerTransportRoutes {
    routes: std::collections::HashMap<uuid::Uuid, InternalPeerRoute>,
}

#[derive(Debug, thiserror::Error)]
pub enum PeerTransportConfigError {
    #[error("invalid {INTERNAL_PEER_ROUTES_ENV} entry `{entry}`: {reason}")]
    InvalidEntry { entry: String, reason: String },
    #[error("failed resolving in-cluster peer service {host}:{port}: {source}")]
    Resolve {
        host: String,
        port: u16,
        #[source]
        source: std::io::Error,
    },
    #[error("in-cluster peer service {host}:{port} resolved to no addresses")]
    NoAddresses { host: String, port: u16 },
    #[error("failed to build peer HTTP client: {0}")]
    Client(#[from] reqwest::Error),
}

/// Parses comma-separated `peer-uuid=tls-host@service.namespace.svc.cluster.local:443` entries.
pub fn parse_internal_peer_routes(
    raw: &str,
) -> Result<Vec<InternalPeerRoute>, PeerTransportConfigError> {
    let mut routes = Vec::new();
    let mut peer_ids = std::collections::HashSet::new();
    let mut tls_hosts = std::collections::HashSet::new();
    for entry in raw
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
    {
        let invalid = |reason: &str| PeerTransportConfigError::InvalidEntry {
            entry: entry.to_string(),
            reason: reason.to_string(),
        };
        let (peer_id, endpoint) = entry
            .split_once('=')
            .ok_or_else(|| invalid("expected peer-uuid=tls-host@service:443"))?;
        let peer_id = peer_id
            .parse()
            .map_err(|_| invalid("peer id must be a UUID"))?;
        let (tls_hostname, service) = endpoint
            .split_once('@')
            .ok_or_else(|| invalid("expected TLS hostname and service separated by @"))?;
        let tls_url = reqwest::Url::parse(&format!("https://{tls_hostname}"))
            .map_err(|_| invalid("TLS hostname is not a valid DNS hostname"))?;
        if tls_url.host_str() != Some(tls_hostname) || tls_url.path() != "/" {
            return Err(invalid("TLS hostname must be a bare hostname"));
        }
        let service_url = reqwest::Url::parse(&format!("https://{service}"))
            .map_err(|_| invalid("service must be a DNS name and port"))?;
        let service_host = service_url.host_str().unwrap_or_default();
        let service_port = service_url.port().unwrap_or(443);
        if !service_host.ends_with(".svc.cluster.local")
            || service_url.path() != "/"
            || service_url.username() != ""
            || service_url.password().is_some()
            || service_port != 443
        {
            return Err(invalid(
                "service must be an in-cluster DNS name on port 443",
            ));
        }
        if !peer_ids.insert(peer_id) || !tls_hosts.insert(tls_hostname.to_ascii_lowercase()) {
            return Err(invalid("peer UUIDs and TLS hostnames must be unique"));
        }
        routes.push(InternalPeerRoute {
            peer_id,
            tls_hostname: tls_hostname.to_ascii_lowercase(),
            service_host: service_host.to_string(),
            service_port,
        });
    }
    Ok(routes)
}

impl PeerTransportRoutes {
    pub fn from_env() -> Result<Self, PeerTransportConfigError> {
        let raw = std::env::var(INTERNAL_PEER_ROUTES_ENV).unwrap_or_default();
        Ok(Self {
            routes: parse_internal_peer_routes(&raw)?
                .into_iter()
                .map(|route| (route.peer_id, route))
                .collect(),
        })
    }

    /// Returns the configured internal TLS endpoint, if this peer has one.
    pub fn outbound_url(&self, peer_id: uuid::Uuid) -> Option<String> {
        self.routes
            .get(&peer_id)
            .map(|route| format!("https://{}:{}", route.tls_hostname, route.service_port))
    }

    pub async fn build_client(&self) -> Result<reqwest::Client, PeerTransportConfigError> {
        let mut builder = reqwest::Client::builder();
        if !self.routes.is_empty() {
            // An explicit in-cluster route must stay direct and must not
            // follow a redirect to a public relay. The client is used only
            // for server-to-server peer calls; peers without an explicit
            // route still use their advertised URLs directly.
            builder = builder
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none());
        }
        for route in self.routes.values() {
            let addrs: Vec<SocketAddr> =
                tokio::net::lookup_host((route.service_host.as_str(), route.service_port))
                    .await
                    .map_err(|source| PeerTransportConfigError::Resolve {
                        host: route.service_host.clone(),
                        port: route.service_port,
                        source,
                    })?
                    .collect();
            if addrs.is_empty() {
                return Err(PeerTransportConfigError::NoAddresses {
                    host: route.service_host.clone(),
                    port: route.service_port,
                });
            }
            builder = builder.resolve_to_addrs(&route.tls_hostname, &addrs);
        }
        Ok(builder.build()?)
    }
}

/// Builds the shared client with per-peer in-cluster socket routing. No TLS
/// verification options are changed; only DNS for each configured public
/// certificate hostname is overridden to the service's resolved addresses.

#[derive(Debug, thiserror::Error)]
pub enum PeerClientError {
    #[error("request to {url} failed: {source}")]
    Http {
        url: String,
        #[source]
        source: reqwest::Error,
    },
    #[error("{url} responded {status}: {body}")]
    Status {
        url: String,
        status: reqwest::StatusCode,
        body: String,
    },
    #[error("{url} sent an unreadable response: {source}")]
    Deserialize {
        url: String,
        #[source]
        source: reqwest::Error,
    },
    #[error("no address for this peer could be reached")]
    NoAddresses,
}

/// A signed client for one node's outbound calls to its peers. Cheap to
/// clone (`reqwest::Client` is itself a cheap `Arc`-backed handle) and
/// meant to be constructed once and shared across every `PeerSyncPoller`.
#[derive(Clone)]
pub struct PeerClient {
    http: reqwest::Client,
    identity: PeerIdentity,
    routes: PeerTransportRoutes,
}

impl PeerClient {
    pub fn new(http: reqwest::Client, identity: PeerIdentity) -> Self {
        Self::new_with_routes(http, identity, PeerTransportRoutes::default())
    }

    pub fn new_with_routes(
        http: reqwest::Client,
        identity: PeerIdentity,
        routes: PeerTransportRoutes,
    ) -> Self {
        Self {
            http,
            identity,
            routes,
        }
    }

    /// Configured in-cluster routes replace advertised peer addresses for
    /// server-to-server requests. There is intentionally no public fallback.
    pub fn addresses_for_peer(
        &self,
        peer_id: uuid::Uuid,
        addresses: &[PeerAddress],
    ) -> Vec<String> {
        if let Some(url) = self.routes.outbound_url(peer_id) {
            vec![url]
        } else {
            addresses_by_priority(addresses)
                .into_iter()
                .map(str::to_owned)
                .collect()
        }
    }

    /// This client's own peer identity -- callers building request bodies
    /// that carry `peer_id`/`public_key` (e.g. [`crate::enroll`]) read it
    /// from here rather than needing a second copy threaded through.
    pub fn identity(&self) -> &PeerIdentity {
        &self.identity
    }

    /// `POST {base_url}{path}` with a signed body, deserializing a JSON
    /// response. `path` must be the exact request-target this node's
    /// `reqwest::Url` will send (no scheme/host) -- it, not the full URL, is
    /// what's covered by the signature (see [`crate::signing::
    /// canonical_string`]).
    pub async fn signed_post<Req: Serialize, Resp: DeserializeOwned>(
        &self,
        base_url: &str,
        path: &str,
        body: &Req,
    ) -> Result<Resp, PeerClientError> {
        let body_bytes = serde_json::to_vec(body).expect("peer sync request DTOs always serialize");
        self.signed_request("POST", base_url, path, body_bytes)
            .await
    }

    /// `POST {base_url}{path}` with a signed body, accepting a successful
    /// response with no body (typically `204 No Content`).
    pub async fn signed_post_no_content<Req: Serialize>(
        &self,
        base_url: &str,
        path: &str,
        body: &Req,
    ) -> Result<(), PeerClientError> {
        let body = serde_json::to_vec(body).expect("peer sync request DTOs always serialize");
        let url = format!("{}{path}", base_url.trim_end_matches('/'));
        let headers = self.identity.sign_request("POST", path, &body);
        let response = self
            .http
            .post(&url)
            .header(PEER_ID_HEADER, headers.peer_id.to_string())
            .header(SIGNATURE_HEADER, headers.signature_b64)
            .header(TIMESTAMP_HEADER, headers.timestamp.to_string())
            .header(NONCE_HEADER, headers.nonce)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body)
            .send()
            .await
            .map_err(|source| PeerClientError::Http {
                url: url.clone(),
                source,
            })?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(PeerClientError::Status { url, status, body });
        }
        Ok(())
    }

    /// `GET {base_url}{path}`, signed with an empty body (a bodyless `GET`
    /// hashes the same as any other empty input, matching the receiving
    /// extractor's own handling).
    pub async fn signed_get<Resp: DeserializeOwned>(
        &self,
        base_url: &str,
        path: &str,
    ) -> Result<Resp, PeerClientError> {
        self.signed_request("GET", base_url, path, Vec::new()).await
    }

    /// `DELETE {base_url}{path}`, signed with an empty body. This is kept
    /// separate from [`Self::signed_request`] because a successful leave
    /// notification returns `204 No Content`, not a JSON response.
    pub async fn signed_delete(&self, base_url: &str, path: &str) -> Result<(), PeerClientError> {
        let url = format!("{}{path}", base_url.trim_end_matches('/'));
        let headers = self.identity.sign_request("DELETE", path, &[]);
        let response = self
            .http
            .delete(&url)
            .header(PEER_ID_HEADER, headers.peer_id.to_string())
            .header(SIGNATURE_HEADER, headers.signature_b64)
            .header(TIMESTAMP_HEADER, headers.timestamp.to_string())
            .header(NONCE_HEADER, headers.nonce)
            .send()
            .await
            .map_err(|source| PeerClientError::Http {
                url: url.clone(),
                source,
            })?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(PeerClientError::Status { url, status, body });
        }
        Ok(())
    }

    async fn signed_request<Resp: DeserializeOwned>(
        &self,
        method: &str,
        base_url: &str,
        path: &str,
        body: Vec<u8>,
    ) -> Result<Resp, PeerClientError> {
        let url = format!("{}{path}", base_url.trim_end_matches('/'));
        let headers = self.identity.sign_request(method, path, &body);

        let mut request = match method {
            "GET" => self.http.get(&url),
            "POST" => self.http.post(&url),
            other => unreachable!("peer_client only deserializes GET/POST, got {other}"),
        };
        request = request
            .header(PEER_ID_HEADER, headers.peer_id.to_string())
            .header(SIGNATURE_HEADER, headers.signature_b64)
            .header(TIMESTAMP_HEADER, headers.timestamp.to_string())
            .header(NONCE_HEADER, headers.nonce);
        if !body.is_empty() {
            request = request
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(body);
        }

        let response = request
            .send()
            .await
            .map_err(|source| PeerClientError::Http {
                url: url.clone(),
                source,
            })?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(PeerClientError::Status { url, status, body });
        }
        response
            .json::<Resp>()
            .await
            .map_err(|source| PeerClientError::Deserialize { url, source })
    }

    /// `POST {base_url}/api/v1/peer/enroll` -- the one endpoint in this
    /// protocol that is bearer-authed by the join token in the body itself,
    /// not by a signed-request header set (see this module's own doc
    /// comment).
    pub async fn enroll<Req: Serialize, Resp: DeserializeOwned>(
        &self,
        base_url: &str,
        request: &Req,
    ) -> Result<Resp, PeerClientError> {
        let url = format!("{}/api/v1/peer/enroll", base_url.trim_end_matches('/'));
        let response = self
            .http
            .post(&url)
            .json(request)
            .send()
            .await
            .map_err(|source| PeerClientError::Http {
                url: url.clone(),
                source,
            })?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(PeerClientError::Status { url, status, body });
        }
        response
            .json::<Resp>()
            .await
            .map_err(|source| PeerClientError::Deserialize { url, source })
    }
}

/// `addresses`, priority-ordered (lower sorts first -- same convention as
/// `SourceInstance::priority`) -- the order every sync module tries a
/// peer's known addresses in, per `docs/architecture/peer-groups.md` §3.6's
/// "tries the next address in that peer's `addresses` list before giving up
/// the cycle."
pub fn addresses_by_priority(addresses: &[PeerAddress]) -> Vec<&str> {
    let mut sorted: Vec<&PeerAddress> = addresses.iter().collect();
    sorted.sort_by_key(|address| address.priority);
    sorted
        .into_iter()
        .map(|address| address.url.as_str())
        .collect()
}

#[cfg(test)]
mod tests {
    use base64::Engine;
    use serde::Deserialize;
    use serde_json::json;
    use uuid::Uuid;
    use wiremock::matchers::{body_json, header_exists, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::signing::PeerIdentity;

    fn identity() -> PeerIdentity {
        let seed_b64 = base64::engine::general_purpose::STANDARD.encode([3u8; 32]);
        PeerIdentity::from_seed_b64(Uuid::new_v4(), &seed_b64).unwrap()
    }

    #[derive(Debug, Deserialize, PartialEq)]
    struct Pong {
        pong: bool,
    }

    #[tokio::test]
    async fn signed_get_attaches_every_signing_header() {
        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/peer/nodes"))
            .and(header_exists(PEER_ID_HEADER))
            .and(header_exists(SIGNATURE_HEADER))
            .and(header_exists(TIMESTAMP_HEADER))
            .and(header_exists(NONCE_HEADER))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"pong": true})))
            .mount(&mock)
            .await;

        let client = PeerClient::new(reqwest::Client::new(), identity());
        let result: Pong = client
            .signed_get(&mock.uri(), "/api/v1/peer/nodes")
            .await
            .expect("signed GET succeeds");
        assert_eq!(result, Pong { pong: true });
    }

    #[tokio::test]
    async fn signed_post_signs_over_the_exact_body_sent() {
        let mock = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/v1/peer/accounts"))
            .and(body_json(json!({"since": "cursor-1"})))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"pong": true})))
            .mount(&mock)
            .await;

        let client = PeerClient::new(reqwest::Client::new(), identity());
        let result: Pong = client
            .signed_post(
                &mock.uri(),
                "/api/v1/peer/accounts",
                &json!({"since": "cursor-1"}),
            )
            .await
            .expect("signed POST succeeds");
        assert_eq!(result, Pong { pong: true });
    }

    #[tokio::test]
    async fn signed_delete_attaches_every_signing_header() {
        let mock = MockServer::start().await;
        let peer_id = identity().peer_id;
        Mock::given(method("DELETE"))
            .and(path(format!("/api/v1/peer/nodes/{peer_id}")))
            .and(header_exists(PEER_ID_HEADER))
            .and(header_exists(SIGNATURE_HEADER))
            .and(header_exists(TIMESTAMP_HEADER))
            .and(header_exists(NONCE_HEADER))
            .respond_with(ResponseTemplate::new(204))
            .mount(&mock)
            .await;

        let client = PeerClient::new(reqwest::Client::new(), identity());
        client
            .signed_delete(&mock.uri(), &format!("/api/v1/peer/nodes/{peer_id}"))
            .await
            .expect("signed DELETE succeeds");
    }

    #[tokio::test]
    async fn non_success_status_surfaces_as_status_error() {
        let mock = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/peer/nodes"))
            .respond_with(ResponseTemplate::new(401).set_body_string("unauthorized"))
            .mount(&mock)
            .await;

        let client = PeerClient::new(reqwest::Client::new(), identity());
        let result: Result<Pong, _> = client.signed_get(&mock.uri(), "/api/v1/peer/nodes").await;
        match result {
            Err(PeerClientError::Status { status, .. }) => {
                assert_eq!(status, reqwest::StatusCode::UNAUTHORIZED);
            }
            other => panic!("expected Status error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn enroll_is_unsigned_and_bearer_authed_by_the_join_token_in_the_body() {
        let mock = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/v1/peer/enroll"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"pong": true})))
            .mount(&mock)
            .await;

        let client = PeerClient::new(reqwest::Client::new(), identity());
        let result: Pong = client
            .enroll(&mock.uri(), &json!({"join_token": "abc"}))
            .await
            .expect("enroll succeeds");
        assert_eq!(result, Pong { pong: true });
    }

    #[test]
    fn addresses_by_priority_sorts_lowest_first() {
        let addresses = vec![
            PeerAddress {
                url: "https://wan.example.com".to_string(),
                priority: 1,
                label: "wan".to_string(),
                client_reachable: true,
            },
            PeerAddress {
                url: "http://lan.example.com".to_string(),
                priority: 0,
                label: "lan".to_string(),
                client_reachable: false,
            },
        ];
        assert_eq!(
            addresses_by_priority(&addresses),
            vec!["http://lan.example.com", "https://wan.example.com"]
        );
    }

    #[test]
    fn addresses_by_priority_empty_for_no_addresses() {
        assert!(addresses_by_priority(&[]).is_empty());
    }

    #[test]
    fn internal_routes_preserve_tls_hostname_and_replace_public_targets_without_fallback() {
        let peer_id = Uuid::new_v4();
        let parsed = parse_internal_peer_routes(&format!(
            "{peer_id}=playarr-b.example.com@playarr-b.playarr.svc.cluster.local:443"
        ))
        .unwrap();
        let routes = PeerTransportRoutes {
            routes: parsed
                .into_iter()
                .map(|route| (route.peer_id, route))
                .collect(),
        };

        assert_eq!(
            routes.outbound_url(peer_id).as_deref(),
            Some("https://playarr-b.example.com:443")
        );
        let public_address = PeerAddress {
            url: "https://public-relay.example.net".to_string(),
            priority: 0,
            label: "relay".to_string(),
            client_reachable: true,
        };
        let client = PeerClient::new_with_routes(reqwest::Client::new(), identity(), routes);
        assert_eq!(
            client.addresses_for_peer(peer_id, std::slice::from_ref(&public_address)),
            vec!["https://playarr-b.example.com:443"]
        );
        assert_eq!(
            client.addresses_for_peer(Uuid::new_v4(), std::slice::from_ref(&public_address)),
            vec!["https://public-relay.example.net"]
        );
        assert_eq!(public_address.url, "https://public-relay.example.net");
    }

    #[test]
    fn omitted_internal_routes_keep_advertised_address_fallback() {
        let peer_id = Uuid::new_v4();
        let public_address = PeerAddress {
            url: "https://public-relay.example.net".to_string(),
            priority: 0,
            label: "relay".to_string(),
            client_reachable: true,
        };
        let client = PeerClient::new(reqwest::Client::new(), identity());

        assert_eq!(
            client.addresses_for_peer(peer_id, std::slice::from_ref(&public_address)),
            vec!["https://public-relay.example.net"]
        );
    }

    #[test]
    fn internal_route_parser_rejects_non_service_or_non_tls_targets() {
        let peer_id = Uuid::new_v4();
        assert!(parse_internal_peer_routes(&format!(
            "{peer_id}=peer.example.net@peer.example.net:443"
        ))
        .is_err());
        assert!(parse_internal_peer_routes(&format!(
            "{peer_id}=peer.example.net@peer.playarr.svc.cluster.local:80"
        ))
        .is_err());
    }
}
