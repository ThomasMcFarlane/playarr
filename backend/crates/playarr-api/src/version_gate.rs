//! Version-enforcement middleware: reads the `X-Playarr-Client-Platform`
//! and `X-Playarr-Client-Version` headers a client sends on every
//! request, and (once fully implemented) rejects requests from a client
//! build older than that platform's configured floor with `426 Upgrade
//! Required`, loaded from `backend/config/client-compatibility.toml`.
//!
//! The `tower::Layer`/`tower::Service` pair here is real and wired into
//! the router in `crate::build_router` — every request genuinely passes
//! through it. The floor *comparison* in [`evaluate`] is deliberately a
//! stub that always passes: Android's version-code comparison and the
//! other platforms' semver comparison are different, non-trivial parsing
//! problems, and shipping the middleware's plumbing correctly (so nothing
//! downstream needs to change shape when the comparison lands) matters
//! more right now than the comparison logic itself.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use axum::body::Body;
use axum::http::{HeaderMap, HeaderValue, Request, Response, StatusCode};
use serde::Deserialize;
use tower::{Layer, Service};

pub const CLIENT_PLATFORM_HEADER: &str = "x-playarr-client-platform";
pub const CLIENT_VERSION_HEADER: &str = "x-playarr-client-version";

/// Mirrors `backend/config/client-compatibility.toml`'s schema. Android
/// platforms gate on an integer `versionCode` (Android's own monotonic
/// build counter); every other platform gates on a semver-shaped version
/// string — hence the two-variant [`ClientEntry`] rather than one shape
/// forced onto both.
#[derive(Debug, Clone, Deserialize)]
pub struct ClientCompatibilityTable {
    pub server: ServerSection,
    #[serde(rename = "android-mobile")]
    pub android_mobile: Option<ClientEntry>,
    #[serde(rename = "android-tv")]
    pub android_tv: Option<ClientEntry>,
    pub ios: Option<ClientEntry>,
    pub web: Option<ClientEntry>,
    #[serde(rename = "tv-webos")]
    pub tv_webos: Option<ClientEntry>,
    #[serde(rename = "tv-tizen")]
    pub tv_tizen: Option<ClientEntry>,
    #[serde(rename = "tv-vidaa")]
    pub tv_vidaa: Option<ClientEntry>,
    pub cast: Option<ClientEntry>,
    #[serde(rename = "tv-fire")]
    pub tv_fire: Option<ClientEntry>,
    pub xbox: Option<ClientEntry>,
    #[serde(rename = "harmony-mobile")]
    pub harmony_mobile: Option<ClientEntry>,
    #[serde(rename = "harmony-tv")]
    pub harmony_tv: Option<ClientEntry>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerSection {
    pub version: String,
    #[serde(rename = "apiVersion")]
    pub api_version: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum ClientEntry {
    VersionCode {
        #[serde(rename = "latestVersionCode")]
        latest_version_code: i64,
        #[serde(rename = "minSupportedVersionCode")]
        min_supported_version_code: i64,
        #[serde(rename = "deprecatedBelowVersionCode")]
        deprecated_below_version_code: Option<i64>,
        sunset: Option<String>,
    },
    Semver {
        #[serde(rename = "latestVersion")]
        latest_version: String,
        #[serde(rename = "minSupported")]
        min_supported: String,
        #[serde(rename = "deprecatedBelow")]
        deprecated_below: Option<String>,
        sunset: Option<String>,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum ClientCompatibilityError {
    #[error("failed to parse client-compatibility.toml: {0}")]
    Parse(#[from] toml::de::Error),
}

impl ClientCompatibilityTable {
    pub fn from_toml_str(raw: &str) -> Result<Self, ClientCompatibilityError> {
        Ok(toml::from_str(raw)?)
    }
}

enum VersionGateDecision {
    Pass,
    #[allow(dead_code)]
    Reject {
        minimum_version: String,
    },
}

/// The actual floor check. Always `Pass` for now — see the module doc
/// comment. Still consults the headers (rather than ignoring its
/// arguments outright) so the eventual real implementation is a change to
/// this function's body only, not to its signature or to how callers
/// invoke it.
fn evaluate(_table: &ClientCompatibilityTable, headers: &HeaderMap) -> VersionGateDecision {
    let _platform = headers.get(CLIENT_PLATFORM_HEADER);
    let _client_version = headers.get(CLIENT_VERSION_HEADER);
    VersionGateDecision::Pass
}

fn upgrade_required_response(minimum_version: &str) -> Response<Body> {
    let body = serde_json::json!({
        "error": "client_upgrade_required",
        "minimum_version": minimum_version,
    })
    .to_string();

    let mut response = Response::new(Body::from(body));
    *response.status_mut() = StatusCode::UPGRADE_REQUIRED;
    response.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    // RFC 7231 §6.5.15 requires a 426 response to carry an `Upgrade`
    // header naming what the client should upgrade to; we repurpose that
    // exact mechanism for "upgrade your app build" rather than a
    // protocol-level upgrade (HTTP/WebSocket), since it's the header RFC
    // 426 responses are specified to carry.
    if let Ok(value) = HeaderValue::from_str(&format!("playarr-client/{minimum_version}")) {
        response
            .headers_mut()
            .insert(axum::http::header::UPGRADE, value);
    }
    response
}

#[derive(Clone)]
pub struct VersionGateLayer {
    table: Arc<ClientCompatibilityTable>,
}

impl VersionGateLayer {
    pub fn new(table: ClientCompatibilityTable) -> Self {
        Self {
            table: Arc::new(table),
        }
    }
}

impl<S> Layer<S> for VersionGateLayer {
    type Service = VersionGateService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        VersionGateService {
            inner,
            table: self.table.clone(),
        }
    }
}

#[derive(Clone)]
pub struct VersionGateService<S> {
    inner: S,
    table: Arc<ClientCompatibilityTable>,
}

impl<S> Service<Request<Body>> for VersionGateService<S>
where
    S: Service<Request<Body>, Response = Response<Body>> + Clone + Send + 'static,
    S::Future: Send + 'static,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, request: Request<Body>) -> Self::Future {
        let table = self.table.clone();
        // tower::Service::call requires `&mut self` but returns a future
        // that must not borrow `self` — clone the inner service (Axum
        // services are cheaply `Clone`, typically an `Arc` handle
        // underneath) and move the clone into the async block instead.
        let mut inner = self.inner.clone();

        Box::pin(async move {
            match evaluate(&table, request.headers()) {
                VersionGateDecision::Pass => inner.call(request).await,
                VersionGateDecision::Reject { minimum_version } => {
                    Ok(upgrade_required_response(&minimum_version))
                }
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_TOML: &str = r#"
[server]
version = "1.4.0"
apiVersion = "1"

[android-mobile]
latestVersionCode = 140
minSupportedVersionCode = 120
deprecatedBelowVersionCode = 130
sunset = "2026-12-01"

[web]
latestVersion = "1.4.0"
minSupported = "1.2.0"
deprecatedBelow = "1.3.0"
"#;

    #[test]
    fn parses_mixed_version_code_and_semver_sections() {
        let table = ClientCompatibilityTable::from_toml_str(SAMPLE_TOML).unwrap();
        assert_eq!(table.server.version, "1.4.0");

        match table.android_mobile.unwrap() {
            ClientEntry::VersionCode {
                latest_version_code,
                min_supported_version_code,
                ..
            } => {
                assert_eq!(latest_version_code, 140);
                assert_eq!(min_supported_version_code, 120);
            }
            ClientEntry::Semver { .. } => panic!("expected VersionCode variant for android-mobile"),
        }

        match table.web.unwrap() {
            ClientEntry::Semver { latest_version, .. } => assert_eq!(latest_version, "1.4.0"),
            ClientEntry::VersionCode { .. } => panic!("expected Semver variant for web"),
        }

        assert!(table.ios.is_none());
    }

    /// The checked-in config file has to actually parse against the
    /// struct it's documented to match — this is the test that would
    /// break if the two drifted apart.
    #[test]
    fn shipped_client_compatibility_toml_parses() {
        let raw = include_str!("../../../config/client-compatibility.toml");
        let table = ClientCompatibilityTable::from_toml_str(raw).unwrap();
        // The served server version is the release version: keep it equal to the workspace version.
        assert_eq!(table.server.version, env!("CARGO_PKG_VERSION"));
        assert!(table.android_mobile.is_some());
        assert!(table.android_tv.is_some());
        assert!(table.ios.is_some());
        assert!(table.web.is_some());
        assert!(table.tv_webos.is_some());
        assert!(table.tv_tizen.is_some());
        assert!(table.tv_vidaa.is_some());
        assert!(table.cast.is_some());
        assert!(table.tv_fire.is_some());
        assert!(table.xbox.is_some());
        assert!(table.harmony_mobile.is_some());
        assert!(table.harmony_tv.is_some());
    }
}
