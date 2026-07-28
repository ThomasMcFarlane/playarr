/**
 * infra/k6/transcode-stress.js
 *
 * Transcode job submission burst: fires a spike of job-creation requests at
 * the transcode queue and watches (a) how fast submissions are accepted
 * under burst load and (b) how the queue drains afterwards -- distinct from
 * infra/k6/load.js, which stresses *playback* (read-heavy, HLS fetches),
 * this stresses the *write* path into an async job queue
 * (playarr-transcode / playarr-tdarr-client, both currently stub
 * crates).
 *
 * "open-model" burst: each submitted job requests an open (non-proprietary,
 * no hardware-vendor-licensed codec/toolchain) encode profile -- e.g.
 * SVT-AV1 rather than an NVENC/QuickSync hardware path -- since that's the
 * profile most likely to be CPU/queue-bound and therefore the one worth
 * burst-testing for backpressure. ASSUMPTION, called out because neither
 * playarr-transcode nor playarr-tdarr-client has landed a real job
 * schema yet to confirm the field names/values against; TARGET_PROFILE is
 * overridable via env var for whenever that contract is confirmed.
 *
 * Endpoint shapes are ASSUMED (see the same caveat in load.js) but kept
 * consistent with the confirmed `VersionEnvelope<T>` response envelope and
 * with `PlayMethod`/`TranscodeReason` naming conventions already committed
 * in backend/crates/playarr-model/src/playback.rs:
 *
 *   POST /api/transcode/jobs   { sourceMediaFileId, targetProfile, priority }
 *     -> 202 VersionEnvelope<{ jobId, status }>
 *   GET  /api/transcode/jobs/{jobId}
 *     -> 200 VersionEnvelope<{ jobId, status, progressPercent }>
 *
 * Run:
 *   k6 run infra/k6/transcode-stress.js
 *   k6 run -e BASE_URL=https://dev.playarr.example \
 *          -e SOURCE_MEDIA_FILE_IDS=<uuid1>,<uuid2> \
 *          infra/k6/transcode-stress.js
 *
 * NOTE: authored as scaffolding against a backend that doesn't exist yet.
 * Not executed here.
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";
import { SharedArray } from "k6/data";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8484";
const TARGET_PROFILE = __ENV.TARGET_PROFILE || "av1-1080p-open";
// Whether to poll the created job until it leaves the queue. Off by default
// because this script's job is to characterise *submission* burst
// behaviour; polling to completion is a much longer-running, different
// kind of test (real transcodes can take minutes) that would dominate the
// run's duration and metrics if left on unconditionally.
const POLL_UNTIL_DONE = (__ENV.POLL_UNTIL_DONE || "false") === "true";
const POLL_TIMEOUT_S = Number(__ENV.POLL_TIMEOUT_S || 30);
const POLL_INTERVAL_S = Number(__ENV.POLL_INTERVAL_S || 2);

const sourceMediaFileIds = new SharedArray("sourceMediaFileIds", function () {
  const raw = __ENV.SOURCE_MEDIA_FILE_IDS || "00000000-0000-4000-8000-000000000000";
  return raw.split(",").map((s) => s.trim());
});

const submitDuration = new Trend("playarr_transcode_submit_duration", true);
const submitFailureRate = new Rate("playarr_transcode_submit_failure_rate");
const jobsSubmitted = new Counter("playarr_transcode_jobs_submitted");
const jobsRejected = new Counter("playarr_transcode_jobs_rejected");
const timeToFirstStatus = new Trend("playarr_transcode_time_to_first_status", true);

export const options = {
  scenarios: {
    // A burst, not a ramp: arrival-rate executors model "N submissions/sec
    // regardless of how long each takes to respond", which is what a burst
    // of users all hitting "watch this" (triggering an on-demand transcode)
    // within the same few seconds actually looks like -- a VU-based
    // executor would instead throttle itself to however fast responses
    // come back, understating real burst pressure on the queue.
    submission_burst: {
      executor: "ramping-arrival-rate",
      startRate: 5,
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { target: 5, duration: "10s" }, // warm up at baseline
        { target: 50, duration: "20s" }, // spike: burst of submissions
        { target: 50, duration: "20s" }, // hold at burst rate
        { target: 0, duration: "10s" }, // drain
      ],
    },
  },
  thresholds: {
    // Looser than load.js on purpose: this scenario is explicitly stressing
    // the system past comfortable capacity to find where backpressure
    // kicks in, so some elevated failure/latency is expected and even the
    // point of the test -- these thresholds catch "queue fell over
    // entirely", not "queue is under pressure".
    http_req_failed: ["rate<0.15"],
    "playarr_transcode_submit_duration": ["p(95)<2000"],
    "playarr_transcode_submit_failure_rate": ["rate<0.15"],
  },
};

export default function () {
  const sourceMediaFileId =
    sourceMediaFileIds[Math.floor(Math.random() * sourceMediaFileIds.length)];

  let job;
  group("submit transcode job", function () {
    const res = http.post(
      `${BASE_URL}/api/transcode/jobs`,
      JSON.stringify({
        sourceMediaFileId,
        targetProfile: TARGET_PROFILE,
        priority: "normal",
      }),
      {
        headers: { "Content-Type": "application/json" },
        tags: { endpoint: "transcode_submit" },
      }
    );
    submitDuration.add(res.timings.duration);

    // 202 Accepted = queued; 429 = the queue is deliberately shedding load,
    // which is a valid, even desirable, outcome under burst -- tracked
    // separately from hard failures (5xx/network errors) rather than
    // counted as one undifferentiated failure rate.
    const accepted = res.status === 202;
    const shed = res.status === 429;
    const hardFailure = !accepted && !shed;

    submitFailureRate.add(hardFailure);
    if (accepted) {
      jobsSubmitted.add(1);
    } else if (shed) {
      jobsRejected.add(1);
    }

    check(res, {
      "submit accepted (202) or load-shed (429), not a hard failure": () => !hardFailure,
    });

    if (accepted) {
      const body = safeJson(res.body);
      if (body && body.data) job = body.data;
    }
  });

  if (job && job.jobId) {
    group("first status poll", function () {
      const start = Date.now();
      const res = http.get(`${BASE_URL}/api/transcode/jobs/${job.jobId}`, {
        tags: { endpoint: "transcode_status" },
      });
      timeToFirstStatus.add(Date.now() - start);
      check(res, {
        "status poll reaches a known job": (r) => r.status === 200,
      });
    });

    if (POLL_UNTIL_DONE) {
      group("poll until done", function () {
        const deadline = Date.now() + POLL_TIMEOUT_S * 1000;
        let status;
        do {
          sleep(POLL_INTERVAL_S);
          const res = http.get(`${BASE_URL}/api/transcode/jobs/${job.jobId}`, {
            tags: { endpoint: "transcode_status" },
          });
          const body = safeJson(res.body);
          status = body && body.data ? body.data.status : undefined;
        } while (
          Date.now() < deadline &&
          status !== "completed" &&
          status !== "failed"
        );
        check(
          { status },
          { "job reached a terminal state before timeout": (s) => s.status === "completed" || s.status === "failed" }
        );
      });
    }
  }

  sleep(1);
}

function safeJson(body) {
  try {
    return JSON.parse(body);
  } catch (_e) {
    return null;
  }
}
