//! Client platform identity and the version-compatibility contract served
//! at `/api/system/version` (see `streamarr-api`) and enforced by the
//! version-gate middleware, driven by `backend/config/client-compatibility.toml`.

use serde::{Deserialize, Serialize};

/// Every first-party client surface Streamarr ships. Kept as a closed enum
/// (rather than a free-form string) so the compatibility table, the
/// `X-Streamarr-Client-Platform` header parser, and policy's
/// `device_allow` list all agree on the same finite set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ClientPlatform {
    AndroidMobile,
    AndroidTv,
    Ios,
    Web,
    TvWebos,
    TvTizen,
    TvVidaa,
}

impl ClientPlatform {
    /// The header value / TOML table key used to identify this platform,
    /// e.g. `"android-tv"`. Kept as one function so the HTTP header parser
    /// in `streamarr-api` and the `client-compatibility.toml` loader can't
    /// silently drift apart.
    pub fn wire_name(self) -> &'static str {
        match self {
            ClientPlatform::AndroidMobile => "android-mobile",
            ClientPlatform::AndroidTv => "android-tv",
            ClientPlatform::Ios => "ios",
            ClientPlatform::Web => "web",
            ClientPlatform::TvWebos => "tv-webos",
            ClientPlatform::TvTizen => "tv-tizen",
            ClientPlatform::TvVidaa => "tv-vidaa",
        }
    }

    pub fn from_wire_name(name: &str) -> Option<Self> {
        Some(match name {
            "android-mobile" => ClientPlatform::AndroidMobile,
            "android-tv" => ClientPlatform::AndroidTv,
            "ios" => ClientPlatform::Ios,
            "web" => ClientPlatform::Web,
            "tv-webos" => ClientPlatform::TvWebos,
            "tv-tizen" => ClientPlatform::TvTizen,
            "tv-vidaa" => ClientPlatform::TvVidaa,
            _ => return None,
        })
    }
}

/// One platform's row in the compatibility table: what the latest client
/// build is, the floor below which the version-gate middleware rejects
/// requests outright, and the floor below which it should nag-but-allow.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct CompatibilityEntry {
    pub platform: ClientPlatform,
    pub latest_version: String,
    pub min_supported_version: String,
    pub deprecated_below: Option<String>,
    /// RFC 3339 timestamp after which `min_supported_version` will be
    /// ratcheted up; surfaced to clients so they can warn users ahead of
    /// time rather than being cut off with no notice.
    pub sunset: Option<String>,
}

/// Response body for `GET /api/system/version`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct VersionEnvelope {
    pub server_version: String,
    pub api_version: String,
    pub build_sha: Option<String>,
    pub compatibility: Vec<CompatibilityEntry>,
}
