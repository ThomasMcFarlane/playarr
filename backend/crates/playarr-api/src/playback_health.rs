//! Playback health and compatibility report (TASK 58-61,
//! `docs/architecture/playback-health.md`).
//!
//! Joins what the server decided when it negotiated a session (the stored
//! [`PlaybackSession`]) with what the client reports and measures, labels every
//! fact as `measured`, `reported` or `unknown`, and produces readable findings
//! plus a redacted export. Nothing here runs on the playback hot path.

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::Response;
use axum::Json;
use chrono::Utc;
use playarr_model::{PlayMethod, PlaybackSession, TranscodeReason};
use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tokio::sync::Semaphore;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth_extractor::{forbidden, StreamingUser};
use crate::error::ApiError;
use crate::AppState;

const MAX_LIST: usize = 16;
const MAX_TEXT: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum HealthProvenance {
    /// Observed on this session.
    Measured,
    /// Declared by the client; never proof that the feature works.
    Reported,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum HealthSource {
    Server,
    Client,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum HealthSeverity {
    Ok,
    Info,
    Warning,
    Problem,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DynamicRange {
    Sdr,
    Hdr10,
    Hlg,
    DolbyVision,
}

impl DynamicRange {
    fn wire(self) -> &'static str {
        match self {
            Self::Sdr => "sdr",
            Self::Hdr10 => "hdr10",
            Self::Hlg => "hlg",
            Self::DolbyVision => "dolby_vision",
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::Sdr => "SDR",
            Self::Hdr10 => "HDR10",
            Self::Hlg => "HLG",
            Self::DolbyVision => "Dolby Vision",
        }
    }
    fn is_hdr(self) -> bool {
        self != Self::Sdr
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, ToSchema)]
pub struct ReportedCapabilities {
    #[serde(default)]
    pub video_codecs: Vec<String>,
    #[serde(default)]
    pub audio_codecs: Vec<String>,
    /// Decoder-side HDR formats: `hdr10`, `hlg`, `dolby_vision`.
    #[serde(default)]
    pub hdr_formats: Vec<String>,
    /// HDR formats the connected display advertises.
    #[serde(default)]
    pub display_hdr_formats: Vec<String>,
    /// Audio output the device advertises, e.g. `stereo`, `surround`,
    /// `passthrough`.
    #[serde(default)]
    pub audio_output: Option<String>,
    #[serde(default)]
    pub max_height: Option<u32>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, ToSchema)]
pub struct MeasuredPlayback {
    #[serde(default)]
    pub video_codec: Option<String>,
    /// `hardware` or `software`.
    #[serde(default)]
    pub decoder_kind: Option<String>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    /// Only `Some(true)` when the player confirmed an HDR output mode.
    #[serde(default)]
    pub hdr_active: Option<bool>,
    #[serde(default)]
    pub audio_codec: Option<String>,
    #[serde(default)]
    pub audio_channels: Option<u32>,
    /// Only `Some(true)` when the player confirmed bitstream passthrough.
    #[serde(default)]
    pub audio_passthrough: Option<bool>,
    #[serde(default)]
    pub dropped_frames: Option<u64>,
    #[serde(default)]
    pub rebuffer_count: Option<u32>,
    #[serde(default)]
    pub rebuffer_ms: Option<u64>,
    #[serde(default)]
    pub throughput_bps: Option<u64>,
}

impl MeasuredPlayback {
    fn is_empty(&self) -> bool {
        self.video_codec.is_none()
            && self.decoder_kind.is_none()
            && self.width.is_none()
            && self.hdr_active.is_none()
            && self.audio_codec.is_none()
            && self.dropped_frames.is_none()
            && self.rebuffer_count.is_none()
            && self.throughput_bps.is_none()
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, ToSchema)]
pub struct ClientPlaybackReport {
    #[serde(default)]
    pub reported: ReportedCapabilities,
    #[serde(default)]
    pub measured: MeasuredPlayback,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct HealthFact {
    pub key: String,
    pub label: String,
    pub value: Option<String>,
    pub provenance: HealthProvenance,
    pub source: Option<HealthSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct HealthFinding {
    pub code: String,
    pub severity: HealthSeverity,
    pub title: String,
    pub detail: String,
    pub next_action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct HealthQualification {
    /// `not_assessed` until the hardware qualification matrix (TASK 40)
    /// exists. Hardware advertisements never move this to a pass.
    pub status: String,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct HealthExportFact {
    pub key: String,
    pub value: Option<String>,
    pub provenance: HealthProvenance,
}

/// Redacted evidence safe to copy or share: no identifiers, titles, paths,
/// URLs, addresses or tokens.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PlaybackHealthExport {
    pub schema: String,
    pub generated_at: chrono::DateTime<Utc>,
    pub client_platform: String,
    pub client_version: String,
    pub play_method: PlayMethod,
    pub transcode_reason: Option<String>,
    pub facts: Vec<HealthExportFact>,
    pub finding_codes: Vec<String>,
    pub redaction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PlaybackHealthReport {
    pub headline: String,
    pub severity: HealthSeverity,
    pub play_method: PlayMethod,
    pub facts: Vec<HealthFact>,
    pub findings: Vec<HealthFinding>,
    pub qualification: HealthQualification,
    pub export: PlaybackHealthExport,
}

// ---------------------------------------------------------------------------
// Sanitising
// ---------------------------------------------------------------------------

fn looks_sensitive(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    if lower.contains("://")
        || lower.contains('@')
        || lower.contains("token")
        || lower.contains("bearer")
        || lower.contains("password")
        || lower.contains("secret")
        || lower.contains("key=")
        || lower.contains('\\')
    {
        return true;
    }
    // IPv4-like or IPv6-like or UUID-like runs.
    let dots = text.matches('.').count();
    if dots >= 3
        && text
            .split('.')
            .filter(|p| !p.is_empty())
            .all(|p| p.chars().all(|c| c.is_ascii_digit()))
    {
        return true;
    }
    if text.matches(':').count() >= 2 && text.chars().all(|c| c.is_ascii_hexdigit() || c == ':') {
        return true;
    }
    if text.len() >= 32 && Uuid::parse_str(text).is_ok() {
        return true;
    }
    // Long opaque blobs (tokens, hashes).
    text.len() > 24
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Keeps short, printable, non-sensitive client text; everything else is
/// dropped (not masked) so nothing partial leaks.
pub(crate) fn sanitise_text(raw: &str) -> Option<String> {
    let trimmed: String = raw
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .chars()
        .take(MAX_TEXT)
        .collect();
    if trimmed.is_empty() || looks_sensitive(&trimmed) {
        None
    } else {
        Some(trimmed)
    }
}

fn sanitise_list(raw: &[String]) -> Vec<String> {
    raw.iter()
        .filter_map(|v| sanitise_text(v))
        .map(|v| v.to_ascii_lowercase())
        .take(MAX_LIST)
        .collect()
}

fn sanitise_opt(raw: &Option<String>) -> Option<String> {
    raw.as_deref().and_then(sanitise_text)
}

fn cap_report(report: &ClientPlaybackReport) -> ClientPlaybackReport {
    ClientPlaybackReport {
        reported: ReportedCapabilities {
            video_codecs: sanitise_list(&report.reported.video_codecs),
            audio_codecs: sanitise_list(&report.reported.audio_codecs),
            hdr_formats: sanitise_list(&report.reported.hdr_formats),
            display_hdr_formats: sanitise_list(&report.reported.display_hdr_formats),
            audio_output: sanitise_opt(&report.reported.audio_output)
                .map(|v| v.to_ascii_lowercase()),
            max_height: report.reported.max_height,
        },
        measured: MeasuredPlayback {
            video_codec: sanitise_opt(&report.measured.video_codec).map(|v| v.to_ascii_lowercase()),
            decoder_kind: sanitise_opt(&report.measured.decoder_kind)
                .map(|v| v.to_ascii_lowercase())
                .filter(|v| v == "hardware" || v == "software"),
            audio_codec: sanitise_opt(&report.measured.audio_codec).map(|v| v.to_ascii_lowercase()),
            ..report.measured.clone()
        },
    }
}

// ---------------------------------------------------------------------------
// Source probing
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct ProbeVideo {
    #[serde(default)]
    streams: Vec<ProbeVideoStream>,
}

#[derive(Debug, Deserialize)]
struct ProbeVideoStream {
    #[serde(default)]
    color_transfer: Option<String>,
    #[serde(default)]
    side_data_list: Vec<ProbeSideData>,
}

#[derive(Debug, Deserialize)]
struct ProbeSideData {
    #[serde(default)]
    side_data_type: String,
}

/// Classifies ffprobe JSON for the first video stream. `None` means the
/// output could not be read; an unrecognised transfer is reported as SDR only
/// when ffprobe returned a stream.
pub(crate) fn parse_dynamic_range(stdout: &[u8]) -> Option<DynamicRange> {
    let parsed: ProbeVideo = serde_json::from_slice(stdout).ok()?;
    let stream = parsed.streams.into_iter().next()?;
    if stream
        .side_data_list
        .iter()
        .any(|d| d.side_data_type.to_ascii_lowercase().contains("dovi"))
    {
        return Some(DynamicRange::DolbyVision);
    }
    Some(match stream.color_transfer.as_deref() {
        Some("smpte2084") => DynamicRange::Hdr10,
        Some("arib-std-b67") => DynamicRange::Hlg,
        _ => DynamicRange::Sdr,
    })
}

async fn probe_dynamic_range(path: &std::path::Path) -> Option<DynamicRange> {
    let binary = std::env::var("PLAYARR_FFPROBE_BINARY").unwrap_or_else(|_| "ffprobe".to_string());
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        Command::new(binary)
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-read_intervals",
                "%+#1",
                "-show_entries",
                "stream=color_transfer:stream_side_data=side_data_type",
                "-of",
                "json",
                "-i",
            ])
            .arg(path)
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_dynamic_range(&output.stdout)
}

// ---------------------------------------------------------------------------
// Report building
// ---------------------------------------------------------------------------

/// Server-side inputs, separated from I/O so the rules are unit-testable.
pub(crate) struct ReportInputs<'a> {
    pub session: &'a PlaybackSession,
    pub source_range: Option<DynamicRange>,
    pub source_audio_codec: Option<String>,
    pub source_audio_channels: Option<u32>,
    pub client: &'a ClientPlaybackReport,
}

fn fact(
    key: &str,
    label: &str,
    value: Option<String>,
    provenance: HealthProvenance,
    source: Option<HealthSource>,
) -> HealthFact {
    let (provenance, source) = if value.is_none() {
        (HealthProvenance::Unknown, None)
    } else {
        (provenance, source)
    };
    HealthFact {
        key: key.into(),
        label: label.into(),
        value,
        provenance,
        source,
    }
}

fn finding(
    code: &str,
    severity: HealthSeverity,
    title: &str,
    detail: impl Into<String>,
    next_action: Option<&str>,
) -> HealthFinding {
    HealthFinding {
        code: code.into(),
        severity,
        title: title.into(),
        detail: detail.into(),
        next_action: next_action.map(Into::into),
    }
}

fn reason_code(reason: &TranscodeReason) -> String {
    match reason {
        TranscodeReason::ContainerNotSupported => "container_not_supported".into(),
        TranscodeReason::VideoCodecNotSupported => "video_codec_not_supported".into(),
        TranscodeReason::AudioCodecNotSupported => "audio_codec_not_supported".into(),
        TranscodeReason::VideoBitrateExceedsLimit => "video_bitrate_exceeds_limit".into(),
        TranscodeReason::ResolutionExceedsLimit => "resolution_exceeds_limit".into(),
        TranscodeReason::SubtitleBurnInRequired => "subtitle_burn_in_required".into(),
        TranscodeReason::ServerPolicy => "server_policy".into(),
        TranscodeReason::Other(code) => sanitise_text(code).unwrap_or_else(|| "other".into()),
    }
}

fn is_passthrough_codec(codec: &str) -> bool {
    matches!(
        codec,
        "ac3" | "eac3" | "dts" | "dca" | "truehd" | "mlp" | "dts-hd" | "dtshd"
    )
}

pub(crate) fn build_report(inputs: ReportInputs<'_>) -> PlaybackHealthReport {
    let ReportInputs {
        session,
        source_range,
        source_audio_codec,
        source_audio_channels,
        client,
    } = inputs;
    let transcoding = session.play_method == PlayMethod::Transcode;
    let m = &client.measured;
    let r = &client.reported;
    let mut facts = Vec::new();
    let mut findings = Vec::new();
    let srv = Some(HealthSource::Server);
    let cli = Some(HealthSource::Client);
    let measured = HealthProvenance::Measured;
    let reported = HealthProvenance::Reported;

    // --- How it is delivered
    facts.push(fact(
        "play_method",
        "Delivery",
        Some(
            match session.play_method {
                PlayMethod::DirectPlay => "Direct play",
                PlayMethod::DirectStream => "Direct stream",
                PlayMethod::Transcode => "Transcoding",
            }
            .into(),
        ),
        measured,
        srv,
    ));
    facts.push(fact(
        "transcode_reason",
        "Reason",
        session.transcode_reason.as_ref().map(reason_code),
        measured,
        srv,
    ));
    facts.push(fact(
        "source_video",
        "Source video",
        Some(format!(
            "{} in {}",
            playarr_transcode::normalise_codec(&session.source_codec),
            session.source_container
        )),
        measured,
        srv,
    ));
    facts.push(fact(
        "delivered_video",
        "Delivered video",
        Some(format!(
            "{} in {}",
            playarr_transcode::normalise_codec(&session.target_codec),
            session.target_container
        )),
        measured,
        srv,
    ));
    facts.push(fact(
        "source_bitrate_bps",
        "Source bitrate",
        session.source_bitrate.map(|b| b.to_string()),
        measured,
        srv,
    ));
    facts.push(fact(
        "target_bitrate_bps",
        "Delivered bitrate",
        session.target_bitrate.map(|b| b.to_string()),
        measured,
        srv,
    ));
    facts.push(fact(
        "decoder_video_codec",
        "Codec decoded by the player",
        m.video_codec.clone(),
        measured,
        cli,
    ));
    facts.push(fact(
        "decoder_kind",
        "Decoder",
        m.decoder_kind.clone(),
        measured,
        cli,
    ));
    facts.push(fact(
        "rendered_size",
        "Rendered size",
        match (m.width, m.height) {
            (Some(w), Some(h)) if w > 0 && h > 0 => Some(format!("{w}x{h}")),
            _ => None,
        },
        measured,
        cli,
    ));
    facts.push(fact(
        "client_video_codecs",
        "Video codecs the device reports",
        (!r.video_codecs.is_empty()).then(|| r.video_codecs.join(", ")),
        reported,
        cli,
    ));

    // --- Dynamic range
    let delivered_range = match (transcoding, source_range) {
        (true, _) => Some(DynamicRange::Sdr),
        (false, range) => range,
    };
    facts.push(fact(
        "source_dynamic_range",
        "Source dynamic range",
        source_range.map(|d| d.wire().into()),
        measured,
        srv,
    ));
    facts.push(fact(
        "delivered_dynamic_range",
        "Dynamic range sent",
        delivered_range.map(|d| d.wire().into()),
        measured,
        srv,
    ));
    facts.push(fact(
        "hdr_output",
        "HDR output confirmed by the player",
        m.hdr_active
            .map(|a| if a { "yes" } else { "no" }.to_string()),
        measured,
        cli,
    ));
    facts.push(fact(
        "display_hdr_formats",
        "HDR formats the display reports",
        (!r.display_hdr_formats.is_empty()).then(|| r.display_hdr_formats.join(", ")),
        reported,
        cli,
    ));
    facts.push(fact(
        "decoder_hdr_formats",
        "HDR formats the decoder reports",
        (!r.hdr_formats.is_empty()).then(|| r.hdr_formats.join(", ")),
        reported,
        cli,
    ));

    // --- Audio
    let delivered_audio = if transcoding {
        Some("aac".to_string())
    } else {
        source_audio_codec.clone()
    };
    facts.push(fact(
        "source_audio",
        "Source audio (default track)",
        source_audio_codec
            .clone()
            .map(|c| match source_audio_channels {
                Some(ch) => format!("{c}, {ch} ch"),
                None => c,
            }),
        measured,
        srv,
    ));
    facts.push(fact(
        "delivered_audio",
        "Audio sent",
        delivered_audio.clone(),
        measured,
        srv,
    ));
    facts.push(fact(
        "decoder_audio",
        "Audio decoded by the player",
        m.audio_codec.clone().map(|c| match m.audio_channels {
            Some(ch) => format!("{c}, {ch} ch"),
            None => c,
        }),
        measured,
        cli,
    ));
    facts.push(fact(
        "audio_passthrough",
        "Audio passthrough confirmed by the player",
        m.audio_passthrough
            .map(|p| if p { "yes" } else { "no" }.to_string()),
        measured,
        cli,
    ));
    facts.push(fact(
        "audio_output",
        "Audio output the device reports",
        r.audio_output.clone(),
        reported,
        cli,
    ));

    // --- Connection
    facts.push(fact(
        "buffering_events",
        "Buffering events (server count)",
        Some(session.buffering_events.to_string()),
        measured,
        srv,
    ));
    facts.push(fact(
        "buffering_ms_total",
        "Time spent buffering (server count)",
        Some(session.buffering_ms_total.to_string()),
        measured,
        srv,
    ));
    facts.push(fact(
        "dropped_frames",
        "Dropped frames",
        m.dropped_frames.map(|v| v.to_string()),
        measured,
        cli,
    ));
    facts.push(fact(
        "throughput_bps",
        "Measured download rate",
        m.throughput_bps.map(|v| v.to_string()),
        measured,
        cli,
    ));

    // --- Findings: delivery
    if !transcoding {
        findings.push(finding(
            "direct_play",
            HealthSeverity::Ok,
            "Playing the original file",
            "The server is sending the file unchanged, so there is no quality loss from conversion.",
            None,
        ));
    } else {
        match &session.transcode_reason {
            Some(TranscodeReason::ContainerNotSupported) => findings.push(finding(
                "container_unsupported",
                HealthSeverity::Warning,
                "This device cannot play the file container",
                format!(
                    "The file is {}; the device did not report support for it, so the server is converting it.",
                    session.source_container
                ),
                Some("Playback works as is. If quality matters, try another device or app that supports this container."),
            )),
            Some(TranscodeReason::VideoCodecNotSupported) => findings.push(finding(
                "video_codec_unsupported",
                HealthSeverity::Warning,
                "This device cannot decode the video codec",
                format!(
                    "The file uses {}; the device did not report support for it, so the server is converting it to {}.",
                    playarr_transcode::normalise_codec(&session.source_codec),
                    playarr_transcode::normalise_codec(&session.target_codec)
                ),
                Some("Playback works as is. Another device with hardware support for this codec would avoid conversion."),
            )),
            Some(TranscodeReason::VideoBitrateExceedsLimit) => findings.push(finding(
                "bitrate_over_limit",
                HealthSeverity::Warning,
                "The file is above the bitrate this device or link can take",
                "The original is above the maximum bitrate the client asked for, so a lower bitrate copy is being produced.",
                Some("Run the connection test. On a faster connection choose Original quality."),
            )),
            Some(TranscodeReason::Other(code)) if code == "quality_selection" => {
                findings.push(finding(
                    "quality_selected",
                    HealthSeverity::Info,
                    "A lower quality was chosen",
                    "You picked a quality below Original, so the server is converting the video.",
                    Some("Choose Original quality to play the file unchanged."),
                ))
            }
            Some(TranscodeReason::Other(code)) if code == "audio_selection" => {
                findings.push(finding(
                    "audio_selection",
                    HealthSeverity::Info,
                    "A non-default audio track needs conversion",
                    "Playing a different audio track means the server prepares a stream with that track.",
                    Some("Choose the default audio track to play the file unchanged."),
                ))
            }
            other => findings.push(finding(
                "transcoding",
                HealthSeverity::Info,
                "The server is converting this video",
                format!(
                    "Reason code: {}.",
                    other
                        .as_ref()
                        .map(reason_code)
                        .unwrap_or_else(|| "not recorded".into())
                ),
                Some("Open technical detail for the exact values."),
            )),
        }
    }

    // --- Findings: HDR / Dolby Vision (never inferred from advertisements)
    match source_range {
        Some(range) if range.is_hdr() && transcoding => {
            let advertised = r
                .display_hdr_formats
                .iter()
                .chain(r.hdr_formats.iter())
                .any(|f| f == range.wire());
            findings.push(finding(
                "hdr_to_sdr",
                HealthSeverity::Warning,
                &format!("{} was converted to SDR", range.label()),
                if advertised {
                    "The device reports HDR support, but the server's converted stream is SDR, so colours and brightness are reduced."
                } else {
                    "The source is HDR and the converted stream is SDR, so colours and brightness are reduced."
                },
                Some(
                    "To keep HDR the file must play unchanged: choose Original quality on a device and display that support it.",
                ),
            ));
        }
        Some(range) if range.is_hdr() => {
            let dv = range == DynamicRange::DolbyVision;
            match m.hdr_active {
                Some(true) => findings.push(finding(
                    "hdr_confirmed",
                    HealthSeverity::Ok,
                    &format!("HDR output confirmed ({} source)", range.label()),
                    "The player reported an active HDR output mode. The server cannot independently see the display.",
                    None,
                )),
                Some(false) => findings.push(finding(
                    "hdr_to_sdr",
                    HealthSeverity::Warning,
                    &format!("{} is being shown without HDR", range.label()),
                    "The file is sent unchanged, but the player reports it is not outputting HDR (device, display or settings).",
                    Some("Check that the TV's HDR mode is on for this input and that the device output is set to HDR."),
                )),
                None => findings.push(finding(
                    if dv { "dolby_vision_not_confirmed" } else { "hdr_not_confirmed" },
                    HealthSeverity::Info,
                    if dv {
                        "Dolby Vision is not confirmed"
                    } else {
                        "HDR output is not confirmed"
                    },
                    if dv {
                        "The file is Dolby Vision and is sent unchanged. Whether you see Dolby Vision, an HDR10 fallback or SDR depends on the player and display, and this device has not measured it."
                    } else {
                        "The file is HDR and is sent unchanged. This device has not measured whether HDR is actually being output."
                    },
                    Some("Look for your TV's HDR indicator while playing."),
                )),
            }
        }
        _ => {}
    }

    // --- Findings: audio
    if let Some(codec) = delivered_audio.as_deref() {
        if !transcoding
            && !r.audio_codecs.is_empty()
            && !r
                .audio_codecs
                .iter()
                .any(|c| playarr_transcode::codecs_match(c, codec))
        {
            findings.push(finding(
                "audio_codec_unsupported",
                HealthSeverity::Warning,
                "The audio codec may not be supported",
                format!(
                    "The file's audio is {codec}, which the device did not report supporting. Sound may be missing or downmixed."
                ),
                Some("Pick another audio track, or use a lower quality so the server converts the audio."),
            ));
        }
        if !transcoding && is_passthrough_codec(&codec.to_ascii_lowercase()) {
            match m.audio_passthrough {
                Some(true) => {}
                Some(false) => findings.push(finding(
                    "audio_passthrough_not_confirmed",
                    HealthSeverity::Info,
                    "Audio is being decoded, not passed through",
                    "The player reports it is decoding this audio itself rather than sending it untouched to a receiver.",
                    Some("Check the device's audio output setting if you expect surround from a receiver."),
                )),
                None => findings.push(finding(
                    "audio_passthrough_not_confirmed",
                    HealthSeverity::Info,
                    "Surround passthrough is not confirmed",
                    "The file has surround audio and is sent unchanged. This device has not measured whether it is passed through to a receiver.",
                    None,
                )),
            }
        }
    }

    // --- Findings: decode and connection
    if m.decoder_kind.as_deref() == Some("software") {
        findings.push(finding(
            "software_decode",
            HealthSeverity::Warning,
            "Video is decoded in software",
            "The device has no hardware decoder in use for this video, which can cause dropped frames and heat.",
            Some("Choose a lower quality, or use a device with hardware support for this codec."),
        ));
    }
    if let Some(dropped) = m.dropped_frames.filter(|d| *d >= 60) {
        findings.push(finding(
            "dropped_frames",
            HealthSeverity::Warning,
            "Frames are being dropped",
            format!("The player has dropped {dropped} frames in this session."),
            Some("Choose a lower quality or close other apps."),
        ));
    }
    let rebuffers = m.rebuffer_count.unwrap_or(0).max(session.buffering_events);
    let rebuffer_ms = m.rebuffer_ms.unwrap_or(0).max(session.buffering_ms_total);
    if rebuffers >= 3 || rebuffer_ms >= 5_000 {
        findings.push(finding(
            "buffering",
            HealthSeverity::Problem,
            "Playback has been buffering",
            format!("{rebuffers} pauses to buffer, {} s in total.", rebuffer_ms / 1000),
            Some("Run the connection test, then choose a lower quality or move closer to the router."),
        ));
    }
    if let (Some(rate), Some(need)) = (
        m.throughput_bps,
        session.target_bitrate.or(session.source_bitrate),
    ) {
        if rate > 0 && (rate as f64) < (need as f64) * 1.25 {
            findings.push(finding(
                "bandwidth_low",
                HealthSeverity::Warning,
                "The connection is close to or below what this video needs",
                format!(
                    "Measured about {:.1} Mbit/s against a {:.1} Mbit/s stream.",
                    rate as f64 / 1e6,
                    need as f64 / 1e6
                ),
                Some("Choose a lower quality."),
            ));
        }
    }
    if m.is_empty() {
        findings.push(finding(
            "telemetry_unavailable",
            HealthSeverity::Info,
            "This device did not send player measurements",
            "What the player actually decoded or output is unknown. The values above come from the server and the device's declared capabilities.",
            None,
        ));
    }

    let severity = findings
        .iter()
        .map(|f| f.severity)
        .max()
        .unwrap_or(HealthSeverity::Ok);
    let headline = match severity {
        HealthSeverity::Problem => "Playback is having problems",
        HealthSeverity::Warning => "Playing, with limitations",
        HealthSeverity::Info if transcoding => "Playing a converted copy",
        _ => "Playing well",
    }
    .to_string();

    let export = PlaybackHealthExport {
        schema: "playarr.playback-health.v1".into(),
        generated_at: Utc::now(),
        client_platform: session.client_platform.wire_name().to_string(),
        client_version: sanitise_text(&session.client_version).unwrap_or_else(|| "unknown".into()),
        play_method: session.play_method,
        transcode_reason: session.transcode_reason.as_ref().map(reason_code),
        facts: facts
            .iter()
            .map(|f| HealthExportFact {
                key: f.key.clone(),
                value: f.value.clone(),
                provenance: f.provenance,
            })
            .collect(),
        finding_codes: findings.iter().map(|f| f.code.clone()).collect(),
        redaction: "Identifiers, titles, paths, URLs, addresses and tokens are never included."
            .into(),
    };

    PlaybackHealthReport {
        headline,
        severity,
        play_method: session.play_method,
        facts,
        findings,
        qualification: HealthQualification {
            status: "not_assessed".into(),
            note: "Hardware qualification results are not available yet. A device advertising a feature is not proof that it works.".into(),
        },
        export,
    }
}

#[utoipa::path(
    post,
    path = "/api/v1/playback/sessions/{session_id}/health",
    tag = "playback",
    params(("session_id" = Uuid, Path, description = "PlaybackSession id, from PlaybackInfoResponse.session_id")),
    request_body = ClientPlaybackReport,
    responses(
        (status = 200, description = "Readable explanation of how this session is being played, with provenance for every fact and a redacted export", body = PlaybackHealthReport),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "session_id does not belong to the caller"),
        (status = 404, description = "Unknown or already-closed session_id")
    )
)]
pub async fn playback_health_handler(
    State(state): State<AppState>,
    streaming: StreamingUser,
    Path(session_id): Path<Uuid>,
    Json(body): Json<ClientPlaybackReport>,
) -> Result<Json<PlaybackHealthReport>, ApiError> {
    let session = state
        .session_registry
        .get(session_id)
        .ok_or_else(|| ApiError::not_found(format!("unknown or closed session {session_id}")))?;
    if session.user_id != streaming.user_id {
        return Err(forbidden("session does not belong to this account"));
    }
    let media_file = state.media_files.get(session.media_file_id).await;
    if let Some(file) = &media_file {
        crate::auth_extractor::ensure_media_access(&state, &streaming, file).await?;
    }

    let (source_range, source_audio_codec, source_audio_channels) = match &media_file {
        Some(file) => {
            let path = playarr_model::resolve_media_path(&file.path);
            let range = probe_dynamic_range(&path).await;
            let audio = crate::media::probe_media_audio_tracks(&path)
                .await
                .ok()
                .and_then(|tracks| {
                    tracks
                        .iter()
                        .find(|t| t.is_default)
                        .or_else(|| tracks.first())
                        .cloned()
                });
            (
                range,
                audio.as_ref().and_then(|t| t.codec.clone()),
                audio.and_then(|t| t.channels),
            )
        }
        None => (None, None, None),
    };

    let client = cap_report(&body);
    Ok(Json(build_report(ReportInputs {
        session: &session,
        source_range,
        source_audio_codec,
        source_audio_channels,
        client: &client,
    })))
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

const CONNECTION_TEST_DEFAULT_BYTES: u64 = 1024 * 1024;
const CONNECTION_TEST_MAX_BYTES: u64 = 4 * 1024 * 1024;
const CONNECTION_TEST_MAX_CONCURRENT: usize = 4;

static CONNECTION_TEST_SLOTS: OnceLock<Arc<Semaphore>> = OnceLock::new();
const CONNECTION_TEST_CHUNK: usize = 64 * 1024;

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct ConnectionTestQuery {
    /// Payload size in bytes. Default 1 MiB, clamped to 4 MiB.
    pub bytes: Option<u64>,
}

pub(crate) fn clamp_test_bytes(requested: Option<u64>) -> u64 {
    requested
        .unwrap_or(CONNECTION_TEST_DEFAULT_BYTES)
        .clamp(1, CONNECTION_TEST_MAX_BYTES)
}

#[utoipa::path(
    get,
    path = "/api/v1/playback/connection-test",
    tag = "playback",
    params(ConnectionTestQuery),
    responses(
        (status = 200, description = "A bounded zero-filled payload for measuring latency and download rate", content_type = "application/octet-stream"),
        (status = 401, description = "Missing or invalid access token"),
        (status = 403, description = "Caller does not have Playarr streaming access"),
        (status = 429, description = "Too many connection tests are running")
    )
)]
pub async fn connection_test_handler(
    _streaming: StreamingUser,
    Query(query): Query<ConnectionTestQuery>,
) -> Result<Response, ApiError> {
    let slots = CONNECTION_TEST_SLOTS
        .get_or_init(|| Arc::new(Semaphore::new(CONNECTION_TEST_MAX_CONCURRENT)))
        .clone();
    let permit = slots.try_acquire_owned().map_err(|_| {
        ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "too_many_requests",
            "too many connection tests are running; try again shortly",
        )
    })?;
    let total = clamp_test_bytes(query.bytes) as usize;
    // The slot is held until the body is dropped (finished, cancelled or the
    // client went away), so the limit bounds real concurrent transfers.
    let chunk = axum::body::Bytes::from(vec![0u8; CONNECTION_TEST_CHUNK.min(total)]);
    let stream = futures::stream::unfold((total, permit), move |(remaining, permit)| {
        let chunk = chunk.clone();
        async move {
            if remaining == 0 {
                return None;
            }
            let take = remaining.min(chunk.len());
            Some((
                Ok::<_, std::convert::Infallible>(chunk.slice(..take)),
                (remaining - take, permit),
            ))
        }
    });
    let mut response = Response::new(Body::from_stream(stream));
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_LENGTH, HeaderValue::from(total as u64));
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use playarr_model::ClientPlatform;

    fn session(method: PlayMethod, reason: Option<TranscodeReason>) -> PlaybackSession {
        PlaybackSession {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            device_id: Uuid::new_v4(),
            media_file_id: Uuid::new_v4(),
            rendition_id: None,
            started_at: Utc::now(),
            ended_at: None,
            play_method: method,
            transcode_reason: reason,
            source_codec: "hevc".into(),
            source_container: "mkv".into(),
            source_bitrate: Some(40_000_000),
            target_codec: if method == PlayMethod::Transcode {
                "h264"
            } else {
                "hevc"
            }
            .into(),
            target_container: if method == PlayMethod::Transcode {
                "hls"
            } else {
                "mkv"
            }
            .into(),
            target_bitrate: Some(4_000_000),
            client_platform: ClientPlatform::Web,
            client_version: "1.2.3".into(),
            ip_address: Some("192.168.1.20".into()),
            bytes_streamed: 0,
            buffering_events: 0,
            buffering_ms_total: 0,
            stop_reason: None,
        }
    }

    fn build(
        s: &PlaybackSession,
        range: Option<DynamicRange>,
        audio: Option<&str>,
        client: &ClientPlaybackReport,
    ) -> PlaybackHealthReport {
        build_report(ReportInputs {
            session: s,
            source_range: range,
            source_audio_codec: audio.map(str::to_string),
            source_audio_channels: Some(6),
            client,
        })
    }

    fn codes(r: &PlaybackHealthReport) -> Vec<&str> {
        r.findings.iter().map(|f| f.code.as_str()).collect()
    }

    fn fact_of<'a>(r: &'a PlaybackHealthReport, key: &str) -> &'a HealthFact {
        r.facts.iter().find(|f| f.key == key).unwrap()
    }

    #[test]
    fn direct_play_without_client_telemetry_is_ok_and_marks_unknowns() {
        let s = session(PlayMethod::DirectPlay, None);
        let r = build(
            &s,
            Some(DynamicRange::Sdr),
            Some("aac"),
            &Default::default(),
        );
        assert!(codes(&r).contains(&"direct_play"));
        assert!(codes(&r).contains(&"telemetry_unavailable"));
        assert_eq!(
            fact_of(&r, "decoder_kind").provenance,
            HealthProvenance::Unknown
        );
        assert_eq!(
            fact_of(&r, "play_method").provenance,
            HealthProvenance::Measured
        );
        assert_eq!(r.qualification.status, "not_assessed");
    }

    #[test]
    fn codec_fallback_is_explained_with_reason() {
        let s = session(
            PlayMethod::Transcode,
            Some(TranscodeReason::VideoCodecNotSupported),
        );
        let r = build(
            &s,
            Some(DynamicRange::Sdr),
            Some("aac"),
            &Default::default(),
        );
        assert!(codes(&r).contains(&"video_codec_unsupported"));
        assert_eq!(
            fact_of(&r, "delivered_video").value.as_deref(),
            Some("h264 in hls")
        );
    }

    #[test]
    fn encoder_names_are_shown_as_codecs() {
        let mut s = session(
            PlayMethod::Transcode,
            Some(TranscodeReason::VideoCodecNotSupported),
        );
        s.source_codec = "x265".into();
        s.target_codec = "libx264".into();
        let r = build(
            &s,
            Some(DynamicRange::Sdr),
            Some("aac"),
            &Default::default(),
        );
        assert_eq!(
            fact_of(&r, "source_video").value.as_deref(),
            Some("hevc in mkv")
        );
        assert_eq!(
            fact_of(&r, "delivered_video").value.as_deref(),
            Some("h264 in hls")
        );
    }

    #[test]
    fn hdr_source_transcode_is_stated_as_sdr_even_if_display_advertises_hdr() {
        let s = session(
            PlayMethod::Transcode,
            Some(TranscodeReason::VideoCodecNotSupported),
        );
        let client = ClientPlaybackReport {
            reported: ReportedCapabilities {
                display_hdr_formats: vec!["hdr10".into()],
                ..Default::default()
            },
            ..Default::default()
        };
        let r = build(&s, Some(DynamicRange::Hdr10), Some("eac3"), &client);
        assert!(codes(&r).contains(&"hdr_to_sdr"));
        assert_eq!(
            fact_of(&r, "delivered_dynamic_range").value.as_deref(),
            Some("sdr")
        );
        assert!(r.severity >= HealthSeverity::Warning);
    }

    #[test]
    fn dolby_vision_is_never_confirmed_from_advertisement() {
        let s = session(PlayMethod::DirectPlay, None);
        let client = ClientPlaybackReport {
            reported: ReportedCapabilities {
                hdr_formats: vec!["dolby_vision".into()],
                display_hdr_formats: vec!["dolby_vision".into()],
                ..Default::default()
            },
            ..Default::default()
        };
        let r = build(&s, Some(DynamicRange::DolbyVision), Some("aac"), &client);
        assert!(codes(&r).contains(&"dolby_vision_not_confirmed"));
        assert!(!codes(&r).contains(&"hdr_confirmed"));
        assert_eq!(
            fact_of(&r, "hdr_output").provenance,
            HealthProvenance::Unknown
        );
        assert_eq!(
            fact_of(&r, "decoder_hdr_formats").provenance,
            HealthProvenance::Reported
        );
    }

    #[test]
    fn measured_hdr_off_is_reported_as_a_limitation() {
        let s = session(PlayMethod::DirectPlay, None);
        let client = ClientPlaybackReport {
            measured: MeasuredPlayback {
                hdr_active: Some(false),
                video_codec: Some("hevc".into()),
                ..Default::default()
            },
            ..Default::default()
        };
        let r = build(&s, Some(DynamicRange::Hdr10), Some("aac"), &client);
        assert!(codes(&r).contains(&"hdr_to_sdr"));
        assert!(!codes(&r).contains(&"telemetry_unavailable"));
    }

    #[test]
    fn passthrough_is_not_inferred_from_output_advertisement() {
        let s = session(PlayMethod::DirectPlay, None);
        let client = ClientPlaybackReport {
            reported: ReportedCapabilities {
                audio_output: Some("passthrough".into()),
                audio_codecs: vec!["eac3".into()],
                ..Default::default()
            },
            ..Default::default()
        };
        let r = build(&s, Some(DynamicRange::Sdr), Some("eac3"), &client);
        assert!(codes(&r).contains(&"audio_passthrough_not_confirmed"));
        assert_eq!(
            fact_of(&r, "audio_passthrough").provenance,
            HealthProvenance::Unknown
        );
    }

    #[test]
    fn unsupported_audio_codec_is_flagged_on_direct_play() {
        let s = session(PlayMethod::DirectPlay, None);
        let client = ClientPlaybackReport {
            reported: ReportedCapabilities {
                audio_codecs: vec!["aac".into()],
                ..Default::default()
            },
            ..Default::default()
        };
        let r = build(&s, Some(DynamicRange::Sdr), Some("truehd"), &client);
        assert!(codes(&r).contains(&"audio_codec_unsupported"));
    }

    #[test]
    fn buffering_and_low_bandwidth_become_problems_with_actions() {
        let mut s = session(PlayMethod::DirectPlay, None);
        s.buffering_events = 4;
        s.buffering_ms_total = 9_000;
        let client = ClientPlaybackReport {
            measured: MeasuredPlayback {
                throughput_bps: Some(3_000_000),
                decoder_kind: Some("software".into()),
                ..Default::default()
            },
            ..Default::default()
        };
        let r = build(&s, None, None, &client);
        assert_eq!(r.severity, HealthSeverity::Problem);
        assert!(codes(&r).contains(&"buffering"));
        assert!(codes(&r).contains(&"bandwidth_low"));
        assert!(codes(&r).contains(&"software_decode"));
        assert!(r
            .findings
            .iter()
            .filter(|f| f.severity >= HealthSeverity::Warning)
            .all(|f| f.next_action.is_some()));
    }

    #[test]
    fn export_contains_no_identifiers_addresses_or_paths() {
        let s = session(
            PlayMethod::Transcode,
            Some(TranscodeReason::Other("quality_selection".into())),
        );
        let client = ClientPlaybackReport {
            reported: ReportedCapabilities {
                video_codecs: vec!["h264".into(), "https://evil.example/?token=abc".into()],
                audio_output: Some("10.0.0.5".into()),
                ..Default::default()
            },
            measured: MeasuredPlayback {
                video_codec: Some("a1b2c3d4-e5f6-4789-a012-b3c4d5e6f708".into()),
                decoder_kind: Some("user@example.com".into()),
                ..Default::default()
            },
        };
        let capped = cap_report(&client);
        let r = build(&s, Some(DynamicRange::Sdr), Some("aac"), &capped);
        let json = serde_json::to_string(&r.export).unwrap();
        for needle in [
            s.id.to_string(),
            s.user_id.to_string(),
            s.device_id.to_string(),
            s.media_file_id.to_string(),
            "192.168".into(),
            "10.0.0.5".into(),
            "evil.example".into(),
            "token=".into(),
            "example.com".into(),
            "a1b2c3d4".into(),
            "/media".into(),
        ] {
            assert!(!json.contains(&needle), "export leaked {needle}: {json}");
        }
        assert!(json.contains("h264"));
    }

    #[test]
    fn sanitise_text_drops_sensitive_values_and_caps_length() {
        assert_eq!(
            sanitise_text("  Dolby Vision "),
            Some("Dolby Vision".into())
        );
        assert_eq!(sanitise_text("http://x"), None);
        assert_eq!(sanitise_text("fe80::1:2"), None);
        assert_eq!(sanitise_text("192.168.0.4"), None);
        assert_eq!(sanitise_text("Bearer abc"), None);
        assert_eq!(sanitise_text(&"a".repeat(200)), None);
        assert_eq!(
            sanitise_text(&format!("x {}", "y".repeat(100))).map(|s| s.len()),
            Some(MAX_TEXT)
        );
    }

    #[test]
    fn dynamic_range_classification_from_ffprobe_json() {
        let hdr10 = br#"{"streams":[{"color_transfer":"smpte2084"}]}"#;
        let hlg = br#"{"streams":[{"color_transfer":"arib-std-b67"}]}"#;
        let dv = br#"{"streams":[{"color_transfer":"smpte2084","side_data_list":[{"side_data_type":"DOVI configuration record"}]}]}"#;
        let sdr = br#"{"streams":[{"color_transfer":"bt709"}]}"#;
        assert_eq!(parse_dynamic_range(hdr10), Some(DynamicRange::Hdr10));
        assert_eq!(parse_dynamic_range(hlg), Some(DynamicRange::Hlg));
        assert_eq!(parse_dynamic_range(dv), Some(DynamicRange::DolbyVision));
        assert_eq!(parse_dynamic_range(sdr), Some(DynamicRange::Sdr));
        assert_eq!(parse_dynamic_range(br#"{"streams":[]}"#), None);
        assert_eq!(parse_dynamic_range(b"nope"), None);
    }

    #[test]
    fn connection_test_size_is_clamped() {
        assert_eq!(clamp_test_bytes(None), 1024 * 1024);
        assert_eq!(clamp_test_bytes(Some(0)), 1);
        assert_eq!(clamp_test_bytes(Some(u64::MAX)), 4 * 1024 * 1024);
    }

    use crate::test_support::{
        bearer_header, mint_access_token, seed_movie, seed_streaming_user, test_state,
    };
    use axum::http::Request;
    use tower::ServiceExt;

    /// The slot limit is process-wide, so tests that use it run one at a time.
    static CONNECTION_TEST_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    fn req(method: &str, uri: &str, token: &str, body: serde_json::Value) -> Request<Body> {
        let mut request = Request::builder()
            .method(method)
            .uri(uri)
            .header("Authorization", bearer_header(token))
            .header("Content-Type", "application/json")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap();
        request
            .extensions_mut()
            .insert(axum::extract::ConnectInfo(std::net::SocketAddr::from((
                [127, 0, 0, 1],
                4000,
            ))));
        request
    }

    #[tokio::test]
    async fn health_endpoint_checks_ownership_and_existence() {
        let (router, state) = test_state().await;
        let owner = Uuid::new_v4();
        seed_streaming_user(&state, owner).await;
        let other = Uuid::new_v4();
        seed_streaming_user(&state, other).await;
        let mut s = session(PlayMethod::DirectPlay, None);
        s.user_id = owner;
        state.app.session_registry.insert(s.clone());
        let uri = format!("/api/v1/playback/sessions/{}/health", s.id);

        let ok = router
            .clone()
            .oneshot(req(
                "POST",
                &uri,
                &mint_access_token(&state, owner),
                serde_json::json!({}),
            ))
            .await
            .unwrap();
        assert_eq!(ok.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(ok.into_body(), usize::MAX)
            .await
            .unwrap();
        let report: PlaybackHealthReport = serde_json::from_slice(&bytes).unwrap();
        assert!(report.findings.iter().any(|f| f.code == "direct_play"));
        let text = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(!text.contains("192.168.1.20"), "client address leaked");

        let forbidden = router
            .clone()
            .oneshot(req(
                "POST",
                &uri,
                &mint_access_token(&state, other),
                serde_json::json!({}),
            ))
            .await
            .unwrap();
        assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

        let missing = router
            .clone()
            .oneshot(req(
                "POST",
                &format!("/api/v1/playback/sessions/{}/health", Uuid::new_v4()),
                &mint_access_token(&state, owner),
                serde_json::json!({}),
            ))
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
        let _ = seed_movie;
    }

    #[tokio::test]
    async fn connection_test_holds_its_slot_until_the_body_is_dropped() {
        let _serial = CONNECTION_TEST_TEST_LOCK.lock().await;
        let (router, state) = test_state().await;
        let user = Uuid::new_v4();
        seed_streaming_user(&state, user).await;
        let token = mint_access_token(&state, user);
        let uri = "/api/v1/playback/connection-test?bytes=4194304";

        let mut held = Vec::new();
        for _ in 0..CONNECTION_TEST_MAX_CONCURRENT {
            let response = router
                .clone()
                .oneshot(req("GET", uri, &token, serde_json::json!(null)))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()["content-length"], "4194304");
            held.push(response);
        }
        let refused = router
            .clone()
            .oneshot(req("GET", uri, &token, serde_json::json!(null)))
            .await
            .unwrap();
        assert_eq!(refused.status(), StatusCode::TOO_MANY_REQUESTS);

        // Cancelling (dropping) one transfer frees its slot.
        held.pop();
        let again = router
            .clone()
            .oneshot(req("GET", uri, &token, serde_json::json!(null)))
            .await
            .unwrap();
        assert_eq!(again.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn connection_test_is_bounded_and_authenticated() {
        let _serial = CONNECTION_TEST_TEST_LOCK.lock().await;
        let (router, state) = test_state().await;
        let user = Uuid::new_v4();
        seed_streaming_user(&state, user).await;
        let token = mint_access_token(&state, user);

        let big = router
            .clone()
            .oneshot(req(
                "GET",
                "/api/v1/playback/connection-test?bytes=999999999",
                &token,
                serde_json::json!(null),
            ))
            .await
            .unwrap();
        assert_eq!(big.status(), StatusCode::OK);
        assert_eq!(big.headers()["cache-control"], "no-store");
        let bytes = axum::body::to_bytes(big.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(bytes.len(), 4 * 1024 * 1024);

        let anon = router
            .oneshot(
                Request::builder()
                    .uri("/api/v1/playback/connection-test")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(anon.status(), StatusCode::UNAUTHORIZED);
    }
}
