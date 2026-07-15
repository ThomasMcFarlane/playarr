/**
 * infra/k6/smoke.js
 *
 * Smoke test: the fastest possible "is the backend even up and not lying
 * about it" check. Light VU count, tight thresholds, short duration --
 * meant to run on every deploy (or every `dev-up.sh` if you want a sanity
 * check before poking around manually), not as a load test.
 *
 * Hits:
 *   GET /healthz            liveness probe -- see infra/kubernetes/base/*
 *                            and infra/kubernetes/helm/streamarr/values.yaml
 *                            (probes.livenessPath), which is where this path
 *                            is confirmed rather than assumed.
 *   GET /readyz              readiness probe, same source.
 *   GET /api/system/version  ASSUMED path -- docs/versioning-policy.md
 *                            (referenced from docs/architecture/overview.md)
 *                            does not exist yet, so the exact route for a
 *                            version envelope isn't confirmed. Shaped after
 *                            @streamarr-tv/domain's `VersionEnvelope<T>`
 *                            (apiVersion, schemaVersion, data), which *is*
 *                            confirmed (clients/tv-web/packages/domain).
 *                            Override via SYSTEM_VERSION_PATH if/when the
 *                            real route lands under a different path.
 *
 * Run:
 *   k6 run infra/k6/smoke.js
 *   k6 run -e BASE_URL=https://dev.streamarr.example infra/k6/smoke.js
 *
 * NOTE: authored as scaffolding against a backend that doesn't exist yet
 * (see backend/crates/streamarr-api, currently a stub). Not executed here.
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const SYSTEM_VERSION_PATH = __ENV.SYSTEM_VERSION_PATH || "/api/system/version";

const healthzDuration = new Trend("streamarr_healthz_duration", true);
const readyzDuration = new Trend("streamarr_readyz_duration", true);
const versionDuration = new Trend("streamarr_system_version_duration", true);

export const options = {
  scenarios: {
    smoke: {
      executor: "constant-vus",
      vus: 3,
      duration: "30s",
      gracefulStop: "5s",
    },
  },
  thresholds: {
    // Global safety net: smoke tests should never see meaningful failure.
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<200"],
    // Per-endpoint tightenings -- these three routes are trivial reads
    // (no DB/catalog joins expected), so 150ms p95 is a deliberately tight
    // bar; a smoke test that passes at "load test" thresholds isn't doing
    // its job of catching regressions early.
    "streamarr_healthz_duration": ["p(95)<100"],
    "streamarr_readyz_duration": ["p(95)<150"],
    "streamarr_system_version_duration": ["p(95)<150"],
  },
};

export default function () {
  group("healthz", function () {
    const res = http.get(`${BASE_URL}/healthz`, { tags: { endpoint: "healthz" } });
    healthzDuration.add(res.timings.duration);
    check(res, {
      "healthz status is 200": (r) => r.status === 200,
    });
  });

  group("readyz", function () {
    const res = http.get(`${BASE_URL}/readyz`, { tags: { endpoint: "readyz" } });
    readyzDuration.add(res.timings.duration);
    check(res, {
      "readyz status is 200": (r) => r.status === 200,
    });
  });

  group("system version", function () {
    const res = http.get(`${BASE_URL}${SYSTEM_VERSION_PATH}`, {
      tags: { endpoint: "system_version" },
    });
    versionDuration.add(res.timings.duration);
    check(res, {
      "system version status is 200": (r) => r.status === 200,
      "system version has apiVersion": (r) => {
        const body = safeJson(r.body);
        return !!body && typeof body.apiVersion === "string";
      },
      "system version has schemaVersion": (r) => {
        const body = safeJson(r.body);
        return !!body && typeof body.schemaVersion === "number";
      },
    });
  });

  sleep(1);
}

function safeJson(body) {
  try {
    return JSON.parse(body);
  } catch (_e) {
    return null;
  }
}
