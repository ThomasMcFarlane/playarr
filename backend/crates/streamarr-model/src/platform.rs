//! Client platform identity and the version-compatibility contract served
//! at `/api/system/version` (see `streamarr-api`) and enforced by the
//! version-gate middleware, driven by `backend/config/client-compatibility.toml`.

use serde::{Deserialize, Serialize};

/// Every first-party client surface Streamarr ships. Kept as a closed enum
/// (rather than a free-form string) so the compatibility table, the
/// `X-Streamarr-Client-Platform` header parser, and policy's
/// `device_allow` list all agree on the same finite set.
///
/// `StreamarrAdmin` is the odd one out: every other variant is a Playarr
/// client (consumer streaming), but Streamarr's own admin UI is also a
/// real first-party client surface that authenticates through the same
/// `POST /api/v1/auth/login` endpoint, and `login_handler` needs a real,
/// honest way to tell the two apart so it knows whether to require
/// `Policy::can_stream` for this login attempt -- see that handler's doc
/// comment. Declaring `client_platform: "streamarr-admin"` doesn't grant
/// anything by itself (a caller can claim whatever platform it wants); it
/// only selects which check `login_handler` applies, and every *other*
/// endpoint still separately enforces the real, persisted `Policy`
/// regardless of what a login request once claimed.
///
/// `Cast` identifies the CAF Custom Web Receiver page, not a device the
/// user signs into directly -- it is provisioned via delegated device
/// authorization from an already-signed-in sender.
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
    Cast,
    TvFire,
    Xbox,
    HarmonyMobile,
    HarmonyTv,
    StreamarrAdmin,
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
            ClientPlatform::Cast => "cast",
            ClientPlatform::TvFire => "tv-fire",
            ClientPlatform::Xbox => "xbox",
            ClientPlatform::HarmonyMobile => "harmony-mobile",
            ClientPlatform::HarmonyTv => "harmony-tv",
            ClientPlatform::StreamarrAdmin => "streamarr-admin",
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
            "cast" => ClientPlatform::Cast,
            "tv-fire" => ClientPlatform::TvFire,
            "xbox" => ClientPlatform::Xbox,
            "harmony-mobile" => ClientPlatform::HarmonyMobile,
            "harmony-tv" => ClientPlatform::HarmonyTv,
            "streamarr-admin" => ClientPlatform::StreamarrAdmin,
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
    pub instance_name: String,
    pub server_version: String,
    pub api_version: String,
    pub build_sha: Option<String>,
    pub compatibility: Vec<CompatibilityEntry>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every [`ClientPlatform`] variant. [`exhaustiveness_guard`] below
    /// makes the compiler reject a new variant that isn't listed here too,
    /// so the round-trip test can never silently stop covering one.
    const ALL_PLATFORMS: &[ClientPlatform] = &[
        ClientPlatform::AndroidMobile,
        ClientPlatform::AndroidTv,
        ClientPlatform::Ios,
        ClientPlatform::Web,
        ClientPlatform::TvWebos,
        ClientPlatform::TvTizen,
        ClientPlatform::TvVidaa,
        ClientPlatform::Cast,
        ClientPlatform::TvFire,
        ClientPlatform::Xbox,
        ClientPlatform::HarmonyMobile,
        ClientPlatform::HarmonyTv,
        ClientPlatform::StreamarrAdmin,
    ];

    /// Not a test — a compile-time tripwire. Adding a variant to
    /// [`ClientPlatform`] makes this match non-exhaustive, and the
    /// resulting error lands here, next to `ALL_PLATFORMS`, which has to
    /// gain the same variant for the tests below to cover it.
    ///
    /// [`ClientPlatform::wire_name`] is already exhaustive and so
    /// self-enforcing, but [`ClientPlatform::from_wire_name`] ends in
    /// `_ => return None` and would otherwise accept a new variant
    /// silently — leaving it unparseable at every call site that decodes a
    /// stored or header-supplied platform.
    fn exhaustiveness_guard(platform: ClientPlatform) -> usize {
        match platform {
            ClientPlatform::AndroidMobile => 0,
            ClientPlatform::AndroidTv => 1,
            ClientPlatform::Ios => 2,
            ClientPlatform::Web => 3,
            ClientPlatform::TvWebos => 4,
            ClientPlatform::TvTizen => 5,
            ClientPlatform::TvVidaa => 6,
            ClientPlatform::Cast => 7,
            ClientPlatform::TvFire => 8,
            ClientPlatform::Xbox => 9,
            ClientPlatform::HarmonyMobile => 10,
            ClientPlatform::HarmonyTv => 11,
            ClientPlatform::StreamarrAdmin => 12,
        }
    }

    #[test]
    fn all_platforms_lists_every_variant() {
        assert_eq!(
            ALL_PLATFORMS.len(),
            exhaustiveness_guard(ClientPlatform::StreamarrAdmin) + 1,
            "ALL_PLATFORMS is missing a variant that exhaustiveness_guard knows about",
        );
    }

    #[test]
    fn every_variant_round_trips_through_its_wire_name() {
        for platform in ALL_PLATFORMS {
            assert_eq!(
                ClientPlatform::from_wire_name(platform.wire_name()),
                Some(*platform),
                "{platform:?} does not round-trip through from_wire_name",
            );
        }
    }

    /// `wire_name` is used for the `X-Streamarr-Client-Platform` header and
    /// the `client-compatibility.toml` table keys, while serde's
    /// container-level `rename_all = "kebab-case"` drives the JSON/OpenAPI
    /// representation. The two are written independently, so a variant
    /// whose PascalCase spelling kebab-cases differently from its hand-
    /// written wire name (`TvWebOS` would yield `tv-web-o-s`) would split
    /// the wire contract in half without this check.
    #[test]
    fn wire_names_match_the_serde_representation() {
        for platform in ALL_PLATFORMS {
            let encoded = serde_json::to_string(platform).expect("platform serialises");
            assert_eq!(
                encoded,
                format!("\"{}\"", platform.wire_name()),
                "{platform:?} serialises differently from its wire_name",
            );
        }
    }
}
