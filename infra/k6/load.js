/**
 * infra/k6/load.js
 *
 * Concurrent-session load test: ramps up virtual "playback sessions", each
 * of which starts a session, fetches its HLS manifest, then fetches
 * segments off that manifest at (roughly) real-time pace -- the shape of
 * load a living-room full of devices actually produces, as opposed to a
 * flat request-per-second hammer.
 *
 * Endpoint shapes are ASSUMED (streamarr-api's routes don't exist yet --
 * see backend/crates/streamarr-api, currently a stub) but grounded in the
 * confirmed domain model in backend/crates/streamarr-model/src/playback.rs
 * and its TS mirror clients/tv-web/packages/domain (`PlaybackSession`,
 * `MediaFile.streamUrl`, `VersionEnvelope<T>`):
 *
 *   POST /api/playback/sessions   { mediaFileId, clientPlatform, deviceId }
 *     -> 201 VersionEnvelope<{ sessionId, manifestUrl }>
 *   GET  <manifestUrl>             an HLS master or media playlist (.m3u8)
 *   GET  <segment URI from manifest>   (resolved relative to the manifest URL)
 *   POST /api/playback/sessions/{sessionId}/heartbeat   (best-effort, not
 *     gated by a threshold -- mirrors PlaybackEventKind::Heartbeat, a
 *     fire-and-forget analytics ping real clients send periodically)
 *
 * Media to "play" comes from MEDIA_FILE_IDS (comma-separated UUIDs) so this
 * script can be pointed at whatever a given dev/staging catalog actually
 * has seeded once streamarr-catalog exists; falls back to a single
 * placeholder UUID otherwise (every request will 404 against a real
 * backend until you override it -- that's expected and fine pre-catalog).
 *
 * Run:
 *   k6 run infra/k6/load.js
 *   k6 run -e BASE_URL=https://dev.streamarr.example \
 *          -e MEDIA_FILE_IDS=<uuid1>,<uuid2>,<uuid3> \
 *          infra/k6/load.js
 *
 * NOTE: authored as scaffolding against a backend that doesn't exist yet.
 * Not executed here.
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";
import { SharedArray } from "k6/data";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const CLIENT_PLATFORM = __ENV.CLIENT_PLATFORM || "web";
const SEGMENTS_PER_SESSION = Number(__ENV.SEGMENTS_PER_SESSION || 6);
// HLS segments are commonly ~6s each; sleeping ~6s between segment fetches
// approximates real-time playback pacing instead of hammering segments as
// fast as the network allows (which would model a mass-download, not
// concurrent viewers).
const SEGMENT_INTERVAL_S = Number(__ENV.SEGMENT_INTERVAL_S || 6);

const mediaFileIds = new SharedArray("mediaFileIds", function () {
  const raw = __ENV.MEDIA_FILE_IDS || "00000000-0000-4000-8000-000000000000";
  return raw.split(",").map((s) => s.trim());
});

const sessionStartDuration = new Trend("streamarr_session_start_duration", true);
const manifestFetchDuration = new Trend("streamarr_manifest_fetch_duration", true);
const segmentFetchDuration = new Trend("streamarr_segment_fetch_duration", true);
const segmentFetchFailureRate = new Rate("streamarr_segment_fetch_failure_rate");
const sessionsStarted = new Counter("streamarr_sessions_started");

export const options = {
  scenarios: {
    concurrent_sessions: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 20 }, // ramp: a quiet evening starting up
        { duration: "3m", target: 100 }, // peak: primetime concurrent viewers
        { duration: "2m", target: 100 }, // hold at peak
        { duration: "1m", target: 0 }, // ramp down
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    // Starting a session (auth + catalog/rendition lookup) is allowed more
    // budget than serving static-ish manifest/segment bytes.
    "streamarr_session_start_duration": ["p(95)<800", "p(99)<1500"],
    "streamarr_manifest_fetch_duration": ["p(95)<500"],
    "streamarr_segment_fetch_duration": ["p(95)<1000", "p(99)<2000"],
    "streamarr_segment_fetch_failure_rate": ["rate<0.02"],
  },
};

export default function () {
  const mediaFileId = mediaFileIds[Math.floor(Math.random() * mediaFileIds.length)];
  const deviceId = `k6-${__VU}-${__ITER}`;

  let session;
  group("start session", function () {
    const res = http.post(
      `${BASE_URL}/api/playback/sessions`,
      JSON.stringify({
        mediaFileId,
        clientPlatform: CLIENT_PLATFORM,
        deviceId,
      }),
      {
        headers: { "Content-Type": "application/json" },
        tags: { endpoint: "session_start" },
      }
    );
    sessionStartDuration.add(res.timings.duration);
    sessionsStarted.add(1);

    const ok = check(res, {
      "session start status is 201": (r) => r.status === 201,
      "session start has manifestUrl": (r) => {
        const body = safeJson(r.body);
        return !!body && !!body.data && typeof body.data.manifestUrl === "string";
      },
    });

    if (ok) {
      const body = safeJson(res.body);
      session = body.data;
    }
  });

  if (!session) {
    // No manifest to fetch -- most likely hitting a backend/catalog that
    // doesn't exist yet (pre-launch) or an invalid MEDIA_FILE_IDS override.
    // Bail this iteration rather than throwing, so one bad response doesn't
    // take the VU down for the whole run.
    sleep(1);
    return;
  }

  let segmentUris = [];
  group("fetch manifest", function () {
    const res = http.get(session.manifestUrl, { tags: { endpoint: "manifest" } });
    manifestFetchDuration.add(res.timings.duration);
    const ok = check(res, {
      "manifest status is 200": (r) => r.status === 200,
      "manifest looks like m3u8": (r) => typeof r.body === "string" && r.body.includes("#EXTM3U"),
    });
    if (ok) {
      segmentUris = parseHlsSegmentUris(res.body, session.manifestUrl);
    }
  });

  group("fetch segments", function () {
    const toFetch = segmentUris.slice(0, SEGMENTS_PER_SESSION);
    for (const segmentUrl of toFetch) {
      const res = http.get(segmentUrl, { tags: { endpoint: "segment" } });
      segmentFetchDuration.add(res.timings.duration);
      const ok = res.status === 200;
      segmentFetchFailureRate.add(!ok);
      check(res, { "segment status is 200": () => ok });
      sleep(SEGMENT_INTERVAL_S);
    }
  });
}

/**
 * Extract segment/sub-playlist URIs from an HLS playlist body (any
 * non-comment, non-blank line is a URI per RFC 8216), resolving them
 * relative to the manifest's own URL the way every real HLS client does --
 * segment URIs are virtually always relative, not absolute.
 */
function parseHlsSegmentUris(playlistBody, manifestUrl) {
  if (typeof playlistBody !== "string") return [];
  const base = manifestUrl.substring(0, manifestUrl.lastIndexOf("/") + 1);
  return playlistBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => (/^https?:\/\//.test(line) ? line : base + line));
}

function safeJson(body) {
  try {
    return JSON.parse(body);
  } catch (_e) {
    return null;
  }
}
