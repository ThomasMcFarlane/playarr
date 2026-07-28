# Playarr Server k6 performance harness

Three [k6](https://k6.io) scripts, written against the *planned* API shape
(health/readiness probes confirmed from `infra/kubernetes`; playback and
transcode endpoints assumed, since `playarr-api`/`playarr-transcode`
are still stub crates) so they're ready to point at a real backend as soon
as it lands, rather than being written retroactively.

| Script | What it stresses | Executor |
|---|---|---|
| `smoke.js` | `/healthz`, `/readyz`, `/api/system/version` -- fast, tight-threshold sanity check | `constant-vus` (3 VUs, 30s) |
| `load.js` | Concurrent playback sessions: start session -> fetch HLS manifest -> fetch segments at real-time pace | `ramping-vus` (0 -> 100 over ~7m) |
| `transcode-stress.js` | Burst of transcode job submissions against the async job queue | `ramping-arrival-rate` (5 -> 50 req/s burst) |

## Environment gap

**`k6` is not installed in the environment these scripts were authored in**,
so none of the three have been executed here -- they're validated by eye
and (for JS syntax only, not k6-API correctness) `node --check`. Install
k6 (`brew install k6`, or see <https://grafana.com/docs/k6/latest/set-up/install-k6/>)
before running them for real:

```sh
k6 run infra/k6/smoke.js
k6 run -e BASE_URL=http://localhost:8484 infra/k6/load.js
k6 run -e BASE_URL=http://localhost:8484 infra/k6/transcode-stress.js
```

## Assumptions to revisit once the backend lands

- **Base URL / port**: defaults to `http://localhost:8484`, matching
  `HTTP_PORT` in `infra/kubernetes/helm/playarr/values.yaml`.
- **`/healthz` and `/readyz`**: confirmed against
  `infra/kubernetes/base/deployment-api.yaml` and the Helm chart's
  `probes.livenessPath`/`probes.readinessPath` -- not a guess.
- **`/api/system/version`, `/api/playback/sessions`, `/api/transcode/jobs`**:
  not yet confirmed against any route table (`playarr-api` has no routes
  yet). Shaped to be consistent with the confirmed `VersionEnvelope<T>`
  response envelope (`clients/tv-web/packages/domain`) and the confirmed
  `PlaybackSession`/`PlayMethod` naming in
  `backend/crates/playarr-model/src/playback.rs`. Update the path/body
  constants at the top of each script once real routes exist -- each one
  calls out its own assumptions in a header comment.
- **`transcode-stress.js`'s "open-model" interpretation**: read as "an
  open (non-proprietary/non-hardware-vendor) encode profile", since no
  transcode job schema exists yet to confirm against. See that file's
  header comment.

## Metrics

Each script defines endpoint-specific custom `Trend`/`Rate`/`Counter`
metrics (e.g. `playarr_segment_fetch_duration`,
`playarr_transcode_submit_failure_rate`) in addition to k6's built-in
`http_req_duration`/`http_req_failed`, and gates on both in `options.thresholds`
-- global thresholds catch a total meltdown, per-endpoint ones catch a
single slow route hiding in an otherwise-healthy aggregate.
