//! Administrator read-only report of the optional external software and
//! hardware this node relies on (ffmpeg, ffprobe, key encoders, hardware
//! acceleration devices).
//!
//! Every probe is bounded by a short timeout and the assembled report is
//! cached briefly, so opening the admin page repeatedly never spawns a
//! stream of child processes. The report describes the node that serves the
//! request only: peers each run their own copy of this endpoint, and
//! aggregating them is deliberately not done here (see
//! `docs/architecture/peer-groups.md` for the existing peer fan-out used by
//! the Activity view, which this report does not need).

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use axum::extract::{Query, State};
use axum::Json;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tokio::sync::Mutex;
use utoipa::{IntoParams, ToSchema};

use crate::{AdminUser, ApiError, AppState};

/// How long a probe result is served before the binaries are queried again.
const CACHE_TTL: Duration = Duration::from_secs(30);
/// Upper bound for any single child process.
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// Encoders reported on, in display order. The `bool` marks encoders the
/// server's own transcode and thumbnail paths always request: without them
/// those features fail rather than merely slow down.
const KEY_ENCODERS: &[(&str, bool)] = &[
    ("libx264", true),
    ("aac", true),
    ("libx265", false),
    ("hevc_vaapi", false),
    ("hevc_nvenc", false),
    ("libsvtav1", false),
    ("libopus", false),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityStatus {
    Present,
    Missing,
    Degraded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityCategory {
    Binary,
    Encoder,
    Hardware,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CapabilityItem {
    /// Stable machine identifier, for example `ffmpeg` or `encoder.libx264`.
    pub id: String,
    pub name: String,
    pub category: CapabilityCategory,
    pub status: CapabilityStatus,
    /// `true` when playback features fail outright without this item.
    pub required: bool,
    /// Resolved binary path or device list, when found.
    pub path: Option<String>,
    pub version: Option<String>,
    /// Short factual note about what was observed.
    pub detail: Option<String>,
    /// Features that are broken or slowed while the item is not `present`.
    pub impact: String,
    pub install_hint: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CapabilitiesResponse {
    pub generated_at: DateTime<Utc>,
    /// `true` when this response came from the short-lived cache.
    pub cached: bool,
    pub items: Vec<CapabilityItem>,
}

#[derive(Debug, Default, Deserialize, IntoParams)]
pub struct CapabilitiesQuery {
    /// Bypass the short cache and probe again.
    #[serde(default)]
    pub refresh: bool,
}

/// What a single `-version` style invocation of a binary produced.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct BinaryProbe {
    pub requested: String,
    pub path: Option<PathBuf>,
    pub version: Option<String>,
    pub error: Option<String>,
}

/// Raw observations; [`build_items`] turns them into the report.
#[derive(Debug, Clone, Default)]
pub(crate) struct RawProbe {
    pub ffmpeg: BinaryProbe,
    pub ffprobe: BinaryProbe,
    pub hwaccels: Option<Vec<String>>,
    pub encoders: Option<BTreeSet<String>>,
    pub render_nodes: Vec<String>,
    pub nvidia_devices: Vec<String>,
}

/// Resolves `name` like a shell would: a value containing a path separator
/// is used as is, otherwise each `PATH` entry is searched.
pub(crate) fn resolve_binary(name: &str, path_var: Option<&str>) -> Option<PathBuf> {
    fn is_file(path: &Path) -> bool {
        path.metadata().map(|meta| meta.is_file()).unwrap_or(false)
    }
    if name.contains('/') {
        let path = PathBuf::from(name);
        return is_file(&path).then_some(path);
    }
    path_var?
        .split(':')
        .filter(|dir| !dir.is_empty())
        .map(|dir| Path::new(dir).join(name))
        .find(|candidate| is_file(candidate))
}

async fn run_capture(binary: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new(binary);
    command.args(args).kill_on_drop(true);
    let output = tokio::time::timeout(PROBE_TIMEOUT, command.output())
        .await
        .map_err(|_| format!("timed out after {}s", PROBE_TIMEOUT.as_secs()))?
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!("exited with {}", output.status));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Extracts the version token from `ffmpeg version 6.1.1 Copyright ...`.
pub(crate) fn parse_version(output: &str) -> Option<String> {
    let first = output.lines().next()?;
    let mut tokens = first.split_whitespace();
    tokens.find(|token| *token == "version")?;
    tokens.next().map(str::to_string)
}

/// Parses `ffmpeg -hwaccels`: a header line then one method per line.
pub(crate) fn parse_hwaccels(output: &str) -> Vec<String> {
    output
        .lines()
        .skip_while(|line| {
            !line
                .trim_start()
                .starts_with("Hardware acceleration methods")
        })
        .skip(1)
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

/// Parses `ffmpeg -encoders`: after the `------` separator each line is
/// `<flags> <name> <description>` where the flags start with `V`, `A` or `S`.
pub(crate) fn parse_encoders(output: &str) -> BTreeSet<String> {
    output
        .lines()
        .skip_while(|line| !line.trim_start().starts_with("------"))
        .skip(1)
        .filter_map(|line| {
            let mut tokens = line.split_whitespace();
            let flags = tokens.next()?;
            let name = tokens.next()?;
            (flags.len() == 6 && flags.chars().all(|c| c.is_ascii_alphabetic() || c == '.'))
                .then(|| name.to_string())
        })
        .collect()
}

async fn probe_binary(requested: &str, path_var: Option<&str>) -> BinaryProbe {
    let mut probe = BinaryProbe {
        requested: requested.to_string(),
        ..BinaryProbe::default()
    };
    let Some(path) = resolve_binary(requested, path_var) else {
        probe.error = Some(format!("`{requested}` was not found"));
        return probe;
    };
    match run_capture(&path, &["-hide_banner", "-version"]).await {
        Ok(output) => {
            probe.version = parse_version(&output);
        }
        Err(error) => probe.error = Some(format!("could not run `{}`: {error}", path.display())),
    }
    probe.path = Some(path);
    probe
}

fn list_devices(dir: &str, prefix: &str) -> Vec<String> {
    let mut devices: Vec<String> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| name.starts_with(prefix))
        .map(|name| format!("{dir}/{name}"))
        .collect();
    devices.sort();
    devices
}

async fn probe_node() -> RawProbe {
    let ffmpeg_name =
        std::env::var("PLAYARR_FFMPEG_BINARY").unwrap_or_else(|_| "ffmpeg".to_string());
    let ffprobe_name =
        std::env::var("PLAYARR_FFPROBE_BINARY").unwrap_or_else(|_| "ffprobe".to_string());
    let path_var = std::env::var("PATH").ok();
    let (ffmpeg, ffprobe) = tokio::join!(
        probe_binary(&ffmpeg_name, path_var.as_deref()),
        probe_binary(&ffprobe_name, path_var.as_deref()),
    );

    let (hwaccels, encoders) = match ffmpeg.path.as_deref().filter(|_| ffmpeg.error.is_none()) {
        Some(path) => {
            let (hw, enc) = tokio::join!(
                run_capture(path, &["-hide_banner", "-hwaccels"]),
                run_capture(path, &["-hide_banner", "-encoders"]),
            );
            (
                hw.ok().map(|out| parse_hwaccels(&out)),
                enc.ok().map(|out| parse_encoders(&out)),
            )
        }
        None => (None, None),
    };

    let render_nodes = list_devices("/dev/dri", "renderD");
    let mut nvidia_devices = list_devices("/dev", "nvidia");
    nvidia_devices.retain(|device| device != "/dev/nvidia-caps");

    RawProbe {
        ffmpeg,
        ffprobe,
        hwaccels,
        encoders,
        render_nodes,
        nvidia_devices,
    }
}

fn binary_item(
    id: &str,
    name: &str,
    probe: &BinaryProbe,
    impact: &str,
    env_name: &str,
    package: &str,
) -> CapabilityItem {
    let status = match (&probe.path, &probe.error) {
        (Some(_), None) => CapabilityStatus::Present,
        (Some(_), Some(_)) => CapabilityStatus::Degraded,
        _ => CapabilityStatus::Missing,
    };
    CapabilityItem {
        id: id.to_string(),
        name: name.to_string(),
        category: CapabilityCategory::Binary,
        status,
        required: true,
        path: probe.path.as_ref().map(|path| path.display().to_string()),
        version: probe.version.clone(),
        detail: probe.error.clone(),
        impact: impact.to_string(),
        install_hint: format!(
            "Install {package} on the host (Debian/Ubuntu: `apt-get install {package}`; Arch: \
             `pacman -S {package}`), or use a server image that bundles it (see \
             infra/docker/backend.Dockerfile). To use a binary outside PATH, set {env_name} to \
             its full path and restart the server."
        ),
    }
}

fn encoder_item(
    raw: &RawProbe,
    name: &str,
    required: bool,
    hardware_present: Option<bool>,
) -> CapabilityItem {
    let (status, detail) = match (&raw.encoders, &raw.ffmpeg.error, raw.ffmpeg.path.is_some()) {
        (Some(encoders), _, _) if encoders.contains(name) => match hardware_present {
            Some(false) => (
                CapabilityStatus::Degraded,
                Some(
                    "Compiled into ffmpeg, but no matching device was found on this node."
                        .to_string(),
                ),
            ),
            _ => (CapabilityStatus::Present, None),
        },
        (Some(_), _, _) => (
            CapabilityStatus::Missing,
            Some("This ffmpeg build does not include the encoder.".to_string()),
        ),
        (None, _, true) => (
            CapabilityStatus::Degraded,
            Some("The encoder list could not be read from ffmpeg.".to_string()),
        ),
        (None, _, false) => (
            CapabilityStatus::Missing,
            Some("Unavailable because ffmpeg is missing.".to_string()),
        ),
    };
    let (impact, hint) = encoder_copy(name);
    CapabilityItem {
        id: format!("encoder.{name}"),
        name: name.to_string(),
        category: CapabilityCategory::Encoder,
        status,
        required,
        path: None,
        version: None,
        detail,
        impact: impact.to_string(),
        install_hint: hint.to_string(),
    }
}

fn encoder_copy(name: &str) -> (&'static str, &'static str) {
    match name {
        "libx264" => (
            "H.264 transcodes, HLS streams, downloads and thumbnails cannot be produced; clients that cannot direct-play the original fail to start.",
            "Install an ffmpeg build with libx264 (the distribution `ffmpeg` package normally includes it).",
        ),
        "aac" => (
            "Audio cannot be transcoded to AAC, so transcoded and HLS playback has no usable audio for most clients.",
            "Use any complete ffmpeg build; the native AAC encoder ships with ffmpeg itself.",
        ),
        "libx265" => (
            "HEVC software encoding is unavailable; HEVC output for capable clients falls back to H.264 or is refused.",
            "Install an ffmpeg build with libx265 (Debian/Ubuntu `ffmpeg` includes it).",
        ),
        "hevc_vaapi" => (
            "HEVC hardware encoding through VA-API is unavailable; HEVC transcodes use the CPU and are slower.",
            "Needs an ffmpeg with VA-API, a GPU render node (/dev/dri/renderD*) passed into the container, and the matching driver (for example mesa-va-drivers or intel-media-va-driver).",
        ),
        "hevc_nvenc" => (
            "NVIDIA hardware HEVC encoding is unavailable; HEVC transcodes use the CPU and are slower.",
            "Needs an ffmpeg with NVENC, an NVIDIA GPU, and the NVIDIA container runtime exposing /dev/nvidia* to the pod.",
        ),
        "libsvtav1" => (
            "AV1 encoding is unavailable; AV1 output is not offered and falls back to other codecs.",
            "Install an ffmpeg build with libsvtav1 (recent Debian/Ubuntu `ffmpeg` includes it).",
        ),
        "libopus" => (
            "Opus audio output is unavailable; clients preferring Opus receive AAC instead.",
            "Install an ffmpeg build with libopus (distribution `ffmpeg` packages normally include it).",
        ),
        _ => ("Related transcodes may be unavailable.", "Install a complete ffmpeg build."),
    }
}

fn hardware_items(raw: &RawProbe) -> Vec<CapabilityItem> {
    let hwaccels = raw.hwaccels.as_ref();
    let hwaccel_list = hwaccels.map(|list| list.join(", "));
    let hwaccel_status = match hwaccels {
        Some(list) if !list.is_empty() => CapabilityStatus::Present,
        _ => CapabilityStatus::Missing,
    };
    let hwaccel_detail = match &hwaccel_list {
        Some(list) if !list.is_empty() => Some(format!("ffmpeg hwaccels: {list}")),
        Some(_) => Some("ffmpeg reports no hardware acceleration methods.".to_string()),
        None => Some("Unavailable because ffmpeg could not be queried.".to_string()),
    };
    vec![
        CapabilityItem {
            id: "hardware.ffmpeg-hwaccels".to_string(),
            name: "ffmpeg hardware acceleration methods".to_string(),
            category: CapabilityCategory::Hardware,
            status: hwaccel_status,
            required: false,
            path: None,
            version: None,
            detail: hwaccel_detail,
            impact: "Without a hardware method every transcode runs on the CPU, which is slower and limits concurrent streams.".to_string(),
            install_hint: "Use an ffmpeg build with VA-API, NVENC or QSV support and expose the GPU to the container.".to_string(),
        },
        CapabilityItem {
            id: "hardware.dri-render-node".to_string(),
            name: "GPU render node (/dev/dri)".to_string(),
            category: CapabilityCategory::Hardware,
            status: if raw.render_nodes.is_empty() {
                CapabilityStatus::Missing
            } else {
                CapabilityStatus::Present
            },
            required: false,
            path: (!raw.render_nodes.is_empty()).then(|| raw.render_nodes.join(", ")),
            version: None,
            detail: raw
                .render_nodes
                .is_empty()
                .then(|| "No /dev/dri/renderD* device is visible to the server.".to_string()),
            impact: "VA-API (Intel/AMD) hardware transcoding is unavailable; transcodes use the CPU.".to_string(),
            install_hint: "On Kubernetes mount the host /dev/dri into the pod (or use a device plugin) and add the container user to the render group. Not needed for direct play.".to_string(),
        },
        CapabilityItem {
            id: "hardware.nvidia".to_string(),
            name: "NVIDIA GPU devices".to_string(),
            category: CapabilityCategory::Hardware,
            status: if raw.nvidia_devices.is_empty() {
                CapabilityStatus::Missing
            } else {
                CapabilityStatus::Present
            },
            required: false,
            path: (!raw.nvidia_devices.is_empty()).then(|| raw.nvidia_devices.join(", ")),
            version: None,
            detail: raw
                .nvidia_devices
                .is_empty()
                .then(|| "No /dev/nvidia* device is visible to the server.".to_string()),
            impact: "NVENC hardware transcoding is unavailable; transcodes use the CPU.".to_string(),
            install_hint: "Install the NVIDIA driver and container toolkit on the node and request the GPU for the pod. Not needed for direct play.".to_string(),
        },
    ]
}

/// Turns raw observations into the ordered report items.
pub(crate) fn build_items(raw: &RawProbe) -> Vec<CapabilityItem> {
    let mut items = vec![
        binary_item(
            "ffmpeg",
            "ffmpeg",
            &raw.ffmpeg,
            "Transcoding, HLS streaming, downloads in other qualities and thumbnail generation fail with a 500 error.",
            "PLAYARR_FFMPEG_BINARY",
            "ffmpeg",
        ),
        binary_item(
            "ffprobe",
            "ffprobe",
            &raw.ffprobe,
            "Chapters, audio and subtitle track discovery, duration scans and media probing fail with a 500 error; transcode start-up is also affected.",
            "PLAYARR_FFPROBE_BINARY",
            "ffmpeg",
        ),
    ];
    let render = !raw.render_nodes.is_empty();
    let nvidia = !raw.nvidia_devices.is_empty();
    for (name, required) in KEY_ENCODERS {
        let hardware = match *name {
            "hevc_vaapi" => Some(render),
            "hevc_nvenc" => Some(nvidia),
            _ => None,
        };
        items.push(encoder_item(raw, name, *required, hardware));
    }
    items.extend(hardware_items(raw));
    items
}

type Cache = Mutex<Option<(Instant, CapabilitiesResponse)>>;

fn cache() -> &'static Cache {
    static CACHE: OnceLock<Cache> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/system/capabilities",
    tag = "admin",
    params(CapabilitiesQuery),
    responses(
        (status = 200, description = "Optional software and hardware available on this node", body = CapabilitiesResponse),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller is authenticated but not an admin")
    )
)]
pub async fn get_system_capabilities_handler(
    State(_state): State<AppState>,
    _admin: AdminUser,
    Query(query): Query<CapabilitiesQuery>,
) -> Result<Json<CapabilitiesResponse>, ApiError> {
    // Holding the lock across the probe makes concurrent callers share one
    // probe instead of each spawning their own child processes.
    let mut guard = cache().lock().await;
    if !query.refresh {
        if let Some((taken, response)) = guard.as_ref() {
            if taken.elapsed() < CACHE_TTL {
                let mut response = response.clone();
                response.cached = true;
                return Ok(Json(response));
            }
        }
    }
    let raw = probe_node().await;
    let response = CapabilitiesResponse {
        generated_at: Utc::now(),
        cached: false,
        items: build_items(&raw),
    };
    *guard = Some((Instant::now(), response.clone()));
    Ok(Json(response))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{bearer_header, mint_access_token, seed_admin_user, test_state};
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;
    use uuid::Uuid;

    const ENCODERS: &str = "Encoders:\n V..... = Video\n A..... = Audio\n ------\n V....D libx264              libx264 H.264\n V....D hevc_vaapi           H.265 (VAAPI)\n A....D aac                  AAC\n";

    fn present_binary(path: &str) -> BinaryProbe {
        BinaryProbe {
            requested: "ffmpeg".into(),
            path: Some(PathBuf::from(path)),
            version: Some("6.1.1".into()),
            error: None,
        }
    }

    fn item<'a>(items: &'a [CapabilityItem], id: &str) -> &'a CapabilityItem {
        items.iter().find(|item| item.id == id).unwrap()
    }

    #[test]
    fn parses_version_hwaccels_and_encoders() {
        assert_eq!(
            parse_version("ffmpeg version n9.0.1 Copyright (c) 2000"),
            Some("n9.0.1".to_string())
        );
        assert_eq!(parse_version("garbage"), None);
        assert_eq!(
            parse_hwaccels("Hardware acceleration methods:\nvaapi\ncuda\n"),
            vec!["vaapi", "cuda"]
        );
        let encoders = parse_encoders(ENCODERS);
        assert!(encoders.contains("libx264") && encoders.contains("aac"));
        assert!(!encoders.contains("libx265"));
        assert!(!encoders.contains("="));
    }

    #[test]
    fn resolves_binaries_from_path_or_explicit_path() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("fakebin");
        std::fs::write(&bin, "x").unwrap();
        let path_var = format!("/nonexistent:{}", dir.path().display());
        assert_eq!(
            resolve_binary("fakebin", Some(&path_var)),
            Some(bin.clone())
        );
        assert_eq!(resolve_binary(bin.to_str().unwrap(), None), Some(bin));
        assert_eq!(resolve_binary("absent", Some(&path_var)), None);
        assert_eq!(resolve_binary("absent", None), None);
    }

    #[test]
    fn missing_ffmpeg_marks_binaries_and_encoders_missing_with_guidance() {
        let raw = RawProbe {
            ffmpeg: BinaryProbe {
                requested: "ffmpeg".into(),
                error: Some("`ffmpeg` was not found".into()),
                ..BinaryProbe::default()
            },
            ..RawProbe::default()
        };
        let items = build_items(&raw);
        for id in ["ffmpeg", "ffprobe", "encoder.libx264", "encoder.aac"] {
            let found = item(&items, id);
            assert_eq!(found.status, CapabilityStatus::Missing, "{id}");
            assert!(found.required, "{id}");
            assert!(!found.impact.is_empty() && !found.install_hint.is_empty());
        }
        assert!(item(&items, "ffmpeg")
            .install_hint
            .contains("PLAYARR_FFMPEG_BINARY"));
        assert!(!item(&items, "encoder.libx265").required);
    }

    #[test]
    fn complete_install_without_gpu_is_present_with_degraded_hardware_encoder() {
        let raw = RawProbe {
            ffmpeg: present_binary("/usr/bin/ffmpeg"),
            ffprobe: present_binary("/usr/bin/ffprobe"),
            hwaccels: Some(vec!["vaapi".into()]),
            encoders: Some(parse_encoders(ENCODERS)),
            ..RawProbe::default()
        };
        let items = build_items(&raw);
        assert_eq!(item(&items, "ffmpeg").status, CapabilityStatus::Present);
        assert_eq!(item(&items, "ffmpeg").version.as_deref(), Some("6.1.1"));
        assert_eq!(
            item(&items, "encoder.libx264").status,
            CapabilityStatus::Present
        );
        assert_eq!(
            item(&items, "encoder.libx265").status,
            CapabilityStatus::Missing
        );
        assert_eq!(
            item(&items, "encoder.hevc_vaapi").status,
            CapabilityStatus::Degraded
        );
        assert_eq!(
            item(&items, "hardware.dri-render-node").status,
            CapabilityStatus::Missing
        );
        assert_eq!(
            item(&items, "hardware.ffmpeg-hwaccels").status,
            CapabilityStatus::Present
        );

        let with_gpu = RawProbe {
            render_nodes: vec!["/dev/dri/renderD128".into()],
            ..raw
        };
        let items = build_items(&with_gpu);
        assert_eq!(
            item(&items, "encoder.hevc_vaapi").status,
            CapabilityStatus::Present
        );
        assert_eq!(
            item(&items, "hardware.dri-render-node").status,
            CapabilityStatus::Present
        );
    }

    #[tokio::test]
    async fn probe_binary_reports_missing_and_broken_binaries() {
        let missing = probe_binary("definitely-not-installed", Some("/nonexistent")).await;
        assert!(missing.path.is_none() && missing.error.is_some());

        let dir = tempfile::tempdir().unwrap();
        let broken = dir.path().join("broken");
        std::fs::write(&broken, "not an executable").unwrap();
        let probe = probe_binary(broken.to_str().unwrap(), None).await;
        assert!(probe.path.is_some() && probe.error.is_some());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn probe_binary_reads_version_from_a_working_binary() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("fake-ffmpeg");
        std::fs::write(&fake, "#!/bin/sh\necho 'ffmpeg version 7.0 Copyright'\n").unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let probe = probe_binary(fake.to_str().unwrap(), None).await;
        assert_eq!(probe.version.as_deref(), Some("7.0"));
        assert!(probe.error.is_none());
    }

    #[tokio::test]
    async fn capabilities_require_an_admin() {
        let (router, _state) = test_state().await;
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/admin/system/capabilities")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn admin_receives_report_and_second_call_is_cached() {
        let (router, state) = test_state().await;
        let admin_id = Uuid::new_v4();
        seed_admin_user(&state, admin_id).await;
        let token = mint_access_token(&state, admin_id);
        let call = |refresh: bool| {
            let uri = format!("/api/v1/admin/system/capabilities?refresh={refresh}");
            let router = router.clone();
            let header = bearer_header(&token);
            async move {
                let response = router
                    .oneshot(
                        Request::builder()
                            .uri(uri)
                            .header("authorization", header)
                            .body(Body::empty())
                            .unwrap(),
                    )
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::OK);
                let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
                serde_json::from_slice::<CapabilitiesResponse>(&body).unwrap()
            }
        };
        let first = call(true).await;
        assert!(!first.cached);
        assert!(first.items.iter().any(|item| item.id == "ffmpeg"));
        assert!(first
            .items
            .iter()
            .any(|item| item.id == "encoder.hevc_nvenc"));
        let second = call(false).await;
        assert!(second.cached);
        assert_eq!(first.generated_at, second.generated_at);
    }
}
