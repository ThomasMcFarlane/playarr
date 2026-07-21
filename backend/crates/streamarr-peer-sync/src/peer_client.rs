//! A signed HTTP client for calling another peer's `/api/v1/peer/*`
//! endpoints -- `docs/architecture/peer-groups.md` §3.3/§3.6.
//!
//! [`PeerClient`] attaches the `X-Streamarr-Peer-Id`/`-Signature`/
//! `-Timestamp`/`-Nonce` headers `streamarr-api::peer_extractor::
//! PeerSignedRequest` verifies (via [`crate::signing`]) to every request
//! except [`PeerClient::enroll`], which is bearer-authed by the one-shot
//! join token instead -- there is no `peer_nodes` row for the caller to
//! sign against yet (see `streamarr-api::peer::enroll_handler`'s own doc
//! comment). Every sync module (`membership_sync`/`account_sync`/
//! `availability_sync`) and `enroll.rs` call through this one client rather
//! than building their own `reqwest` calls, so the signing/header/error
//! handling lives in exactly one place.

use serde::de::DeserializeOwned;
use serde::Serialize;
use streamarr_model::PeerAddress;

use crate::signing::PeerIdentity;

pub const PEER_ID_HEADER: &str = "x-streamarr-peer-id";
pub const SIGNATURE_HEADER: &str = "x-streamarr-signature";
pub const TIMESTAMP_HEADER: &str = "x-streamarr-timestamp";
pub const NONCE_HEADER: &str = "x-streamarr-nonce";

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
}

impl PeerClient {
    pub fn new(http: reqwest::Client, identity: PeerIdentity) -> Self {
        Self { http, identity }
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
}
