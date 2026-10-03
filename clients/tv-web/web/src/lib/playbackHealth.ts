import type {
  ApiClient,
  ClientPlaybackReport,
  ConnectionTestResult,
  HealthFact,
  HealthFinding,
  HealthSeverity,
  PlaybackHealthReport,
} from "@playarr-tv/api-client";
import type { PlaybackCapabilities } from "@playarr-tv/api-client/react";

export type { PlaybackCapabilities };

const CONNECTION_TEST_BYTES = 1024 * 1024;
const CONNECTION_TEST_TIMEOUT_MS = 8000;

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

/** The subset of an HTMLVideoElement the report reads, so tests can fake it. */
export interface VideoTelemetrySource {
  videoWidth: number;
  videoHeight: number;
  getVideoPlaybackQuality?: () => { droppedVideoFrames: number };
}

/**
 * Builds the client half of a playback health request. Capability lists are
 * what this build declares (`reported`); only values the browser actually
 * observed go under `measured`. The browser exposes no decoder kind, HDR
 * output state or audio passthrough state, so those are left out and the
 * server shows them as unknown instead of guessing.
 */
export function buildClientReport(
  capabilities: PlaybackCapabilities,
  video: VideoTelemetrySource | null,
  options: { displayHdr?: boolean; throughputBps?: number } = {}
): ClientPlaybackReport {
  const measured: NonNullable<ClientPlaybackReport["measured"]> = {};
  if (video) {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      measured.width = video.videoWidth;
      measured.height = video.videoHeight;
    }
    const quality = video.getVideoPlaybackQuality?.();
    if (quality && Number.isFinite(quality.droppedVideoFrames)) {
      measured.dropped_frames = Math.max(0, Math.floor(quality.droppedVideoFrames));
    }
  }
  if (options.throughputBps && options.throughputBps > 0) {
    measured.throughput_bps = Math.round(options.throughputBps);
  }
  return {
    reported: {
      video_codecs: csv(capabilities.videoCodecs),
      audio_codecs: csv(capabilities.audioCodecs),
      // `(dynamic-range: high)` says the display can show HDR, not which format.
      display_hdr_formats: options.displayHdr ? ["hdr"] : [],
    },
    measured,
  };
}

export function displayAdvertisesHdr(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(dynamic-range: high)").matches;
  } catch {
    return false;
  }
}

const SEVERITY_ORDER: HealthSeverity[] = ["problem", "warning", "info", "ok"];

/** Most important findings first, stable within a severity. */
export function sortFindings(findings: HealthFinding[]): HealthFinding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.finding.severity) -
          SEVERITY_ORDER.indexOf(b.finding.severity) || a.index - b.index
    )
    .map((entry) => entry.finding);
}

/** Facts worth showing in the simple view: values the viewer can act on or compare. */
const SUMMARY_FACT_KEYS = new Set([
  "play_method",
  "source_video",
  "delivered_video",
  "delivered_dynamic_range",
  "delivered_audio",
]);

export function summaryFacts(facts: HealthFact[]): HealthFact[] {
  return facts.filter((fact) => SUMMARY_FACT_KEYS.has(fact.key));
}

export function provenanceLabelKey(
  fact: HealthFact
): "measured" | "reported" | "unknown" {
  if (fact.value === null || fact.value === undefined) return "unknown";
  return fact.provenance;
}

export function formatBitrate(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbit/s`;
  return `${Math.round(bps / 1000)} kbit/s`;
}

/** The only text that leaves the device, built from the server-redacted export. */
export function exportText(report: PlaybackHealthReport): string {
  return JSON.stringify(report.export, null, 2);
}

export function exportFileName(now: Date = new Date()): string {
  return `playarr-playback-health-${now.toISOString().slice(0, 10)}.json`;
}

export interface ConnectionTestHandle {
  cancel: () => void;
  done: Promise<ConnectionTestResult | "cancelled">;
}

/**
 * One bounded request: 1 MiB, aborted after 8 s or on cancel. Never parallel,
 * so it cannot saturate the link the way a multi-stream speed test would.
 */
export function startConnectionTest(client: ApiClient): ConnectionTestHandle {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CONNECTION_TEST_TIMEOUT_MS);
  const done = client
    .runConnectionTest({ bytes: CONNECTION_TEST_BYTES, signal: controller.signal })
    .catch((error: unknown) => {
      if (controller.signal.aborted && !timedOut) return "cancelled" as const;
      throw timedOut ? new Error("The connection test took too long.") : error;
    })
    .finally(() => clearTimeout(timer));
  return { cancel: () => controller.abort(), done };
}
