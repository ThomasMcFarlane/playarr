# Deploying Streamarr: Kubernetes (Tier 3 — scaled cluster)

Tier 3 is for operators running Streamarr as shared infrastructure:
autoscaled API capacity, a separate worker pool for background transcode
work, and a Postgres instance that already exists as cluster-managed or
externally managed infrastructure — the chart never provisions Postgres
itself. Coordination uses `PostgresCoordinator`
(`backend/crates/streamarr-coordination`) automatically, the same as any
other deployment whose `DATABASE_URL` is a `postgres://`/`postgresql://`
URL (see [`../distributed-design.md`](../distributed-design.md) and
[ADR 0001](../adr/0001-storage-engine.md)) — there is no
Kubernetes-specific coordination mode, and no gossip-membership
implementation exists in the codebase today.

## Two deployment paths

`infra/kubernetes/` ships two independent ways to deploy, meant to be
picked one per cluster/environment rather than layered on top of each
other:

1. **`helm/streamarr/`** — a real Helm chart: autoscaling for both roles,
   a PodDisruptionBudget for the worker pool, and an optional Prometheus
   `ServiceMonitor`. This is the more complete path and what the rest of
   this document focuses on.
2. **`base/` + `overlays/{dev,staging,prod}/`** — a plain kustomize
   skeleton for teams that don't want a Helm release object in-cluster.
   Deliberately minimal — no HorizontalPodAutoscaler/PodDisruptionBudget/
   ServiceMonitor equivalents yet.

Both paths deploy the same two workloads from the same image
(`ghcr.io/streamarr/streamarr`, built from `infra/docker/backend.Dockerfile`):
a `streamarr-api` Deployment (`STREAMARR_ROLE=api`) behind a `ClusterIP`
Service, and a separate `streamarr-worker` Deployment
(`STREAMARR_ROLE=worker`) behind its own headless `ClusterIP` Service used
only for probe/metrics routing. **Neither Deployment overrides the
container's command or args** — the image's default
`CMD ["/app/streamarr", "serve"]` (from `backend.Dockerfile`) runs
unchanged; role selection is entirely the `STREAMARR_ROLE` environment
variable, matching how `serve` actually works in `backend/src/main.rs`
today (the `serve` subcommand itself takes no `--role`, or any other,
flag). Tier 2's `docker-compose.prod.yml` used to override `command:` with
a nonexistent `--role` flag — see [`docker-compose.md`](docker-compose.md)
for that (since-fixed) history; it now follows the same
env-var-only-selects-role pattern as this chart.

Both roles expose the same two ports from the same binary:

| Port | Purpose |
|------|---------|
| `8484` (`http`) | Application traffic (`api`) / probe-only (`worker`) |
| `9090` (`metrics`) | Prometheus `/metrics` |

and the same two probe paths, both real, tested routes in `streamarr-api`
(`backend/crates/streamarr-api/src/lib.rs`):

| Path | Used by |
|------|---------|
| `/healthz` | `livenessProbe` |
| `/readyz` | `readinessProbe` |

There is **no Ingress or Gateway API resource** anywhere in this chart or
the kustomize skeleton — fronting the `streamarr-api` Service with an
ingress controller/gateway of your choice is left entirely to the cluster
operator.

## The Helm chart (`infra/kubernetes/helm/streamarr/`)

```
helm/streamarr/
  Chart.yaml               # name=streamarr, appVersion="0.1.0", no subchart dependencies
  values.yaml                # image, probes, config (ConfigMap), secret, api.*, worker.*, serviceMonitor
  templates/
    _helpers.tpl              # name/label/selector helpers
    deployment-api.yaml        # STREAMARR_ROLE=api
    deployment-worker.yaml     # STREAMARR_ROLE=worker
    hpa-api.yaml                 # HorizontalPodAutoscaler for the api Deployment
    hpa-worker.yaml               # HorizontalPodAutoscaler for the worker Deployment
    service.yaml                    # ClusterIP for api, headless ClusterIP for worker
    pdb-worker.yaml                   # PodDisruptionBudget for the worker Deployment
    configmap.yaml                      # non-secret config (values.config), consumed via envFrom
    secret.yaml                           # opt-in Secret placeholder for DATABASE_URL/REDIS_URL
    serviceaccount.yaml                     # ServiceAccount (values.serviceAccount.create)
    servicemonitor.yaml                       # optional, values.serviceMonitor.enabled
    NOTES.txt                                   # helm install post-install summary
```

Representative shape of the `api` Deployment template
(`templates/deployment-api.yaml`):

```yaml
containers:
  - name: streamarr-api
    image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
    env:
      - name: STREAMARR_ROLE
        value: {{ .Values.api.role | quote }}   # "api"
      - name: DATABASE_URL
        valueFrom: { secretKeyRef: { name: <secret.name>, key: DATABASE_URL } }
      - name: REDIS_URL
        valueFrom: { secretKeyRef: { name: <secret.name>, key: REDIS_URL } }
    envFrom:
      - configMapRef: { name: <configmap-name> }   # STREAMARR_LOG/STREAMARR_HTTP_BIND_ADDR/STREAMARR_METRICS_BIND_ADDR
    ports:
      - { name: http, containerPort: 8484 }
      - { name: metrics, containerPort: 9090 }
    readinessProbe: { httpGet: { path: /readyz, port: 8484 } }
    livenessProbe:  { httpGet: { path: /healthz, port: 8484 } }
```

The `worker` Deployment template is identical apart from
`STREAMARR_ROLE: worker` and its own `HorizontalPodAutoscaler`
(`hpa-worker.yaml` carries a commented example of wiring in an `External`
queue-depth metric via KEDA/Prometheus Adapter once one is installed — CPU
utilization is the only real scaling target today).

### `DATABASE_URL`/`REDIS_URL` are always Secret-sourced

Both Deployments read `DATABASE_URL` and `REDIS_URL` exclusively via
`secretKeyRef` against a Secret named `secret.name` (defaults to
`<release-fullname>-secrets`) — they are never accepted as plain values in
`values.yaml`. `secret.create: false` (the default) assumes that Secret
already exists in the target namespace, provisioned out-of-band (External
Secrets Operator, Sealed Secrets, Vault, or a manual `kubectl create
secret generic ... --from-literal=DATABASE_URL=... --from-literal=REDIS_URL=...`);
pods sit in `CreateContainerConfigError` until it does, which is
intentional — `helm install --wait` timing out beats silently starting
with an empty `DATABASE_URL`. `secret.create: true` (e.g. `--set
secret.create=true --set secret.data.databaseUrl=...`) renders the Secret
from `values.yaml` instead, for local/dev use only — don't commit real
credentials there.

There is **no bundled Postgres subchart dependency** of any kind
(`Chart.yaml` declares none): this chart never provisions a database
itself. Be aware that `streamarr-config` resolves the deployment tier from
`DATABASE_URL`'s URL scheme alone — pointing more than one `api`/`worker`
pod at a non-Postgres URL (e.g. a shared `sqlite:` path) is a real
misconfiguration hazard the chart does nothing to prevent.

### Config keys, and the manual sync a fixed bug left behind

`values.yaml`'s non-secret `config:` block (`STREAMARR_LOG: "info"`,
`STREAMARR_HTTP_BIND_ADDR: "0.0.0.0:8484"`,
`STREAMARR_METRICS_BIND_ADDR: "0.0.0.0:9090"`) is rendered into a
ConfigMap and consumed via `envFrom` — these are the real names
`streamarr-config::Config::from_env` reads (`backend/crates/streamarr-config`).
An earlier pass of this chart instead shipped `APP_ENV`/`LOG_LEVEL`/
`LOG_FORMAT`/`METRICS_ENABLED`/`METRICS_PORT`/`HTTP_PORT`, none of which
the binary read at all; fixed.

The container/Service port fields (`containerPort`/`port` in
`deployment-{api,worker}.yaml` and `service.yaml`) can't reference
`STREAMARR_METRICS_BIND_ADDR` directly — it's a full socket address
string (`"0.0.0.0:9090"`), and Kubernetes port fields need a plain
integer — so a separate top-level `metricsPort: 9090` value exists
specifically for that (same reasoning as `probes.port: 8484` for the HTTP
side, which already existed). **Nothing derives one from the other**:
`metricsPort`/`probes.port` and the port numbers embedded in
`config.STREAMARR_METRICS_BIND_ADDR`/`STREAMARR_HTTP_BIND_ADDR` must be
kept in sync by hand if either changes. (An earlier pass had the port
fields read `{{ get .Values.config "METRICS_PORT" | int }}` directly,
which broke when that ConfigMap key was renamed to the real
`STREAMARR_METRICS_BIND_ADDR` name above — fixed by introducing
`metricsPort` as its own value.)

### Autoscaling, PDB, ServiceMonitor

- `api.autoscaling`/`worker.autoscaling` (both `enabled: true` by default)
  render a `HorizontalPodAutoscaler` each: `api` targets 70% CPU
  utilization between 2–6 replicas; `worker` targets 75% CPU between 1–8
  replicas.
- `worker.podDisruptionBudget.enabled: true` renders a PDB with
  `minAvailable: 1` by default, so voluntary disruptions (node drains,
  cluster upgrades) never take every worker offline at once.
- `serviceMonitor.enabled: false` by default; set `true` on clusters
  running kube-prometheus-stack (or any Prometheus Operator install) to
  scrape both `api` and `worker` `metrics` Service ports at `/metrics`.
  Requires the `monitoring.coreos.com/v1` CRDs to already be installed —
  the template does not check for them, so enabling this on a cluster
  without the Operator fails `helm install`/`upgrade`.

## Installing

```bash
helm install streamarr infra/kubernetes/helm/streamarr \
  --namespace streamarr --create-namespace \
  -f my-values.yaml
```

There is no published chart repository yet — install directly from a
checkout of this repository, as above. `my-values.yaml` at minimum needs
`secret.name` (or `secret.create=true` for local/dev) pointing at a Secret
holding `DATABASE_URL`/`REDIS_URL`. `values.yaml`'s `image.tag` is pinned
to `Chart.yaml`'s `appVersion` (`"0.1.0"`) by convention — the Deployment
templates render `image.tag | default .Chart.AppVersion`, so even an
empty `image.tag` falls back to a real pinned version, never `latest`.
Database migrations run automatically as part of pod startup, identically
to Tiers 1 and 2 (`sqlx::migrate!`, per [ADR 0001](../adr/0001-storage-engine.md)).
`terminationGracePeriodSeconds: 30` plus a `preStopSleepSeconds: 15` sleep
in each container's `preStop` hook gives in-flight requests/jobs time to
drain, and the load balancer/kube-proxy time to notice a pod is
terminating, before SIGTERM.

## Self-update story: GitOps/Flux only — never self-updating

Kubernetes is the one tier where Streamarr **never** updates itself, by
design — there is no opt-in escape hatch equivalent to Tier 1's
`streamarr update` subcommand or Tier 2's Watchtower overlay (and, per
[`systemd.md`](systemd.md#self-update-story-opt-in-check-only-and-today-largely-stubbed),
that subcommand's real update logic is still a stub everywhere it exists
today, so this tier isn't giving up much by not having it). No component
in this repository reaches out to the registry, calls the Kubernetes API
to patch its own workload, or otherwise self-updates from inside the
cluster.

`infra/kubernetes/flux-image-automation.example.yaml` documents the
sanctioned path — **an example file, not wired into any live Flux
Kustomization/HelmRelease in this repository**:

- An `ImageRepository` watching `ghcr.io/streamarr/streamarr` for new
  tags (5 minute interval).
- An `ImagePolicy` selecting the highest tag matching a semver range
  (`>=0.1.0` in the example — narrow this per environment, e.g. dev
  tracking pre-releases and prod not).
- An `ImageUpdateAutomation` that commits the resulting tag bump back into
  *this git repository* (recommended to a side branch,
  `flux-image-updates`, behind a PR — not straight to `main`) at whatever
  file carries a `# {"$imagepolicy": "flux-system:streamarr:tag"}` marker
  comment next to an image reference. For the Helm chart, that's
  `values.yaml`'s `image.tag` field; for the kustomize skeleton, it's
  `base/kustomization.yaml`'s `images[].newTag`. **Neither file in this
  repo carries that marker comment by default** — adding it is a
  deliberate, per-environment opt-in, since it changes who/what is
  allowed to author commits against that file.

None of this is wired into a running Flux `Kustomization`/`HelmRelease` in
this repository — a Flux bootstrap, plus a reconciling `Kustomization`/
`HelmRelease` pointing at `infra/kubernetes/overlays/<env>` (or the Helm
release's values), are prerequisites this example file assumes but
doesn't provide. The result, once wired up, is that every version change
to a Tier 3 deployment exists as a Git commit before it ever exists as a
running pod — reviewable and revertable with `git revert`, rather than
cluster state that could differ from what's declared in Git.
