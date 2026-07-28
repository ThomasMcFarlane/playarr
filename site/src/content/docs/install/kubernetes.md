---
title: Kubernetes
summary: Deploy Streamarr to a Kubernetes cluster with the bundled Helm chart or the Kustomize overlays, splitting the API and worker roles into independently scaled Deployments.
group: Install
order: 4
badge: Preview
---

Kubernetes is the third and largest deployment tier. It suits operators who already run a cluster and want the API and the background worker pool scaled independently, against a PostgreSQL instance that exists as infrastructure in its own right. Everything lives in `infra/kubernetes/` in the repository: a Helm chart at `infra/kubernetes/helm/streamarr/`, and a plain Kustomize skeleton at `infra/kubernetes/base/` with `dev`, `staging` and `prod` overlays. Pick one per cluster — they are not designed to be layered on top of each other.

> **Status: Preview.** The chart and the overlays are real, checked-in manifests, but they have only been validated by local rendering — `helm lint`, `helm template` and `kustomize build`. Nobody has run `helm install` against a live cluster. There is also no published Helm chart repository and no published backend container image release yet, so you install from a repository checkout and supply your own image. Read the "Known rough edges" section before you commit to this tier.

## What you need before you start

| Requirement | Notes |
| --- | --- |
| A Kubernetes cluster and `kubectl` | Any conformant cluster. The chart renders `autoscaling/v2` HorizontalPodAutoscalers and `policy/v1` PodDisruptionBudgets, so v1.23+. |
| Helm 3 | Only for the chart route. The Kustomize route needs `kustomize` (or `kubectl apply -k`). |
| A checkout of the repository | There is no chart repository to `helm repo add`. |
| A PostgreSQL instance | **The chart never provisions one.** `Chart.yaml` declares no subchart dependencies. |
| A container image the cluster can pull | No backend release has been tagged yet — build and push your own, see below. |
| Storage the pods can read your media from | Not provided by either path. You supply the volumes; see "Storage". |
| Optional: Prometheus Operator CRDs | Only if you set `serviceMonitor.enabled: true`. |
| Optional: Redis | Only if you want Redis-backed caching and pub/sub instead of PostgreSQL `LISTEN`/`NOTIFY`. |

Streamarr picks its coordination and caching strategy from the shape of `DATABASE_URL`, not from a flag. A `postgres://` or `postgresql://` URL selects the multi-node PostgreSQL coordinator; adding a non-empty `REDIS_URL` on top of that moves caching and pub/sub onto Redis. Pointing several pods at a `sqlite:` URL is a real misconfiguration hazard that neither path prevents — always use PostgreSQL here.

## How the roles map onto Deployments

Both paths deploy **two** Deployments from the **same image**, distinguished only by the `STREAMARR_ROLE` environment variable. Neither Deployment overrides the image's `command` or `args`; the image's default `CMD ["/app/streamarr", "serve"]` runs unchanged, and `serve` takes no role flag.

| Deployment | `STREAMARR_ROLE` | Serves | Scaled by |
| --- | --- | --- | --- |
| `streamarr-api` | `api` | The full HTTP/JSON API, authentication, playback negotiation, and a built web UI served as the router's fallback at `/`. Fronted by a `ClusterIP` Service. | `api.autoscaling` — an HPA, 2–6 replicas at 70% CPU by default. |
| `streamarr-worker` | `worker` | No application traffic. Runs the reconciliation pollers, peer-sync pollers and background transcode dispatch. Behind a headless `ClusterIP` Service used only for probes and metrics scraping. | `worker.autoscaling` — an HPA, 1–8 replicas at 75% CPU by default, plus a PodDisruptionBudget. |

> **There is no coordinator Deployment.** Coordination is in-process. Every pod constructs the same PostgreSQL-backed coordinator from `DATABASE_URL` and uses advisory locks and leader election so that only one node runs any given background loop. You do not deploy, scale or configure a coordinator separately — there is no third workload to run.

> **Which web UI lands at `/` depends on the image you build.** The API router serves whatever directory `STREAMARR_WEB_ASSETS_DIR` names, falling back to a `web/` directory beside the binary, and serves API-only if neither contains an `index.html`. `infra/docker/backend.Dockerfile` currently builds the `@streamarr-tv/web` workspace (the Playarr web client) into `/app/web`, while `streamarr-api`'s own documentation describes that slot as Streamarr Admin (`clients/tv-web/admin/dist`). The two disagree in the repository today. If you want Streamarr Admin on this origin, build `clients/tv-web/admin`, mount its `dist/` output into the pods, and point `STREAMARR_WEB_ASSETS_DIR` at it — the chart exposes no value for that, so it needs the same volume patching described under "Storage".

Both roles listen on the same two ports. The chart configures the same probe paths for both, though the `worker` role does not actually serve `/readyz` — see "Known rough edges":

| Port | Name | Purpose |
| --- | --- | --- |
| `8484` | `http` | Application traffic for `api`; probe-only for `worker`. |
| `9090` | `metrics` | Prometheus `/metrics`, served unconditionally by every role. |

| Path | Probe |
| --- | --- |
| `/healthz` | `livenessProbe` |
| `/readyz` | `readinessProbe` — see the worker caveat under "Known rough edges" |

## Step 1 — Build and push an image

The chart's default `image.repository` is `ghcr.io/streamarr/streamarr`, which the repository's own README labels a placeholder. No backend image has been published, so build one from the repository root — the Dockerfile's build context must be the root, because it also builds the web assets:

```bash
git clone https://github.com/ThomasMcFarlane/streamarr.git
cd streamarr

docker build \
  -f infra/docker/backend.Dockerfile \
  -t <YOUR-REGISTRY>/streamarr:<YOUR-TAG> \
  .

docker push <YOUR-REGISTRY>/streamarr:<YOUR-TAG>
```

The resulting image runs as uid/gid `10001`, exposes `8484` and `9090`, bundles `ffmpeg` and `ffprobe` for thumbnailing, subtitle extraction and on-demand transcoding, and works with a read-only root filesystem. Both the SQLite and PostgreSQL drivers are compiled in; the backend is chosen at runtime from `DATABASE_URL`.

## Step 2 — Prepare PostgreSQL

Create a database and a role for Streamarr on your existing PostgreSQL instance. Nothing else is required: schema migrations are embedded in the binary and run automatically at pod startup, on every tier.

```sql
CREATE ROLE streamarr LOGIN PASSWORD '<YOUR-DB-PASSWORD>';
CREATE DATABASE streamarr OWNER streamarr;
```

Because migrations run at startup, a rolling update where old and new pods overlap will briefly have both schema versions in play. Keep `maxSurge: 1` / `maxUnavailable: 0` (the shipped strategy) and roll one version at a time.

> **Backups are your responsibility.** The chart never provisions PostgreSQL, so the backup and restore story belongs to whatever did. No backup script, restore procedure or snapshot tooling exists anywhere in the repository.

## Step 3 — Create the namespace and the Secret

`DATABASE_URL` and `REDIS_URL` are only ever read through `secretKeyRef`. The chart will not accept them as plaintext `values.yaml` entries, and `secret.create` defaults to `false`, meaning the chart expects the Secret to already exist.

```bash
kubectl create namespace streamarr

kubectl create secret generic streamarr-secrets \
  --namespace streamarr \
  --from-literal=DATABASE_URL='postgres://streamarr:<YOUR-DB-PASSWORD>@postgres.databases.svc:5432/streamarr' \
  --from-literal=REDIS_URL=''
```

> **Both keys must exist, even if you do not run Redis.** The Deployments reference `REDIS_URL` unconditionally and without `optional: true`, so a missing key leaves pods stuck in `CreateContainerConfigError`. An empty string is safe: the config loader treats an empty value as unset, so an empty `REDIS_URL` keeps the deployment on PostgreSQL `LISTEN`/`NOTIFY`. Set it to `redis://redis.cache.svc:6379/0` when you do want Redis.

Pods deliberately fail loudly rather than starting with an empty database URL. If you install before the Secret exists, `helm install --wait` will time out — that is intended behaviour, not a bug.

In production, prefer managing that Secret with External Secrets Operator, Sealed Secrets or Vault, so the connection strings never round-trip through `helm template` or `helm get values`. `secret.create: true` renders a Secret from `secret.data.databaseUrl` / `secret.data.redisUrl` instead, and is intended for local and development use only.

## Step 4 — Write a values file

Every key below exists in `infra/kubernetes/helm/streamarr/values.yaml`. Anything you put under `config:` is rendered into a ConfigMap and consumed by both Deployments via `envFrom`, so any environment variable the binary reads can go there.

```yaml
# my-values.yaml
image:
  repository: <YOUR-REGISTRY>/streamarr
  tag: "<YOUR-TAG>"
  pullPolicy: IfNotPresent

imagePullSecrets:
  - name: <YOUR-REGISTRY-PULL-SECRET>

secret:
  create: false
  name: streamarr-secrets

config:
  STREAMARR_LOG: "info"
  STREAMARR_HTTP_BIND_ADDR: "0.0.0.0:8484"
  STREAMARR_METRICS_BIND_ADDR: "0.0.0.0:9090"
  # Caches must land on a writable mount. The only writable mount the chart
  # creates is the emptyDir at /tmp, so these point there — ephemeral, and
  # rebuilt per pod. See "Storage" for making them persistent.
  STREAMARR_ARTWORK_CACHE_DIR: "/tmp/streamarr-cache/artwork"
  STREAMARR_SUBTITLE_CACHE_DIR: "/tmp/streamarr-cache/subtitles"

probes:
  port: 8484
  livenessPath: /healthz
  readinessPath: /readyz
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 3
  successThreshold: 1

metricsPort: 9090

terminationGracePeriodSeconds: 30
preStopSleepSeconds: 15

api:
  role: api
  replicaCount: 2
  service:
    type: ClusterIP
    port: 80
    targetPort: 8484
  resources:
    requests: { cpu: 100m, memory: 128Mi }
    limits: { cpu: 1000m, memory: 512Mi }
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 6
    targetCPUUtilizationPercentage: 70

worker:
  role: worker
  replicaCount: 2
  service:
    port: 8484
    targetPort: 8484
  resources:
    requests: { cpu: 200m, memory: 256Mi }
    limits: { cpu: 2000m, memory: 1Gi }
  autoscaling:
    enabled: true
    minReplicas: 1
    maxReplicas: 8
    targetCPUUtilizationPercentage: 75
  podDisruptionBudget:
    enabled: true
    minAvailable: 1
    maxUnavailable: null
  # Any label you have already applied to the nodes you want workers on.
  # This is your cluster's label, not one Streamarr defines.
  nodeSelector:
    <YOUR-NODE-LABEL-KEY>: <YOUR-NODE-LABEL-VALUE>

serviceMonitor:
  enabled: false
```

> **`probes.port` and `metricsPort` are not derived from the bind addresses.** Kubernetes port fields need a plain integer, while the binary takes a full socket address string. If you change the port inside `STREAMARR_HTTP_BIND_ADDR` or `STREAMARR_METRICS_BIND_ADDR`, you must change `probes.port` or `metricsPort` by hand to match. Nothing checks this for you.

A few more notes on the values above:

- `image.tag` renders as `image.tag | default .Chart.AppVersion`, so even an empty tag falls back to a pinned version and never resolves to `latest`.
- When `api.autoscaling.enabled` is `true`, the Deployment omits `replicas` entirely and the HPA owns it; `api.replicaCount` only applies when autoscaling is off. The same is true for the worker.
- `worker.podDisruptionBudget` expects exactly one of `minAvailable` / `maxUnavailable` to be set, with the other left `null`.
- Worker autoscaling is CPU-driven. `hpa-worker.yaml` carries a commented example of adding an `External` queue-depth metric once you have KEDA or the Prometheus Adapter installed — better suited to bursty background work, but it needs an adapter you install yourself.
- `serviceMonitor.enabled: true` requires the `monitoring.coreos.com/v1` CRDs to already exist. The template does not check, so enabling it on a cluster without the Prometheus Operator fails the install outright.

## Step 5 — Install

Render and inspect first, then install:

```bash
helm lint infra/kubernetes/helm/streamarr

helm template streamarr infra/kubernetes/helm/streamarr \
  --namespace streamarr \
  -f my-values.yaml | less

helm install streamarr infra/kubernetes/helm/streamarr \
  --namespace streamarr --create-namespace \
  -f my-values.yaml
```

For a throwaway development cluster you can let the chart create the Secret itself:

```bash
helm install streamarr infra/kubernetes/helm/streamarr \
  --namespace streamarr --create-namespace \
  --set secret.create=true \
  --set secret.data.databaseUrl='postgres://streamarr:<YOUR-DB-PASSWORD>@postgres:5432/streamarr' \
  --set secret.data.redisUrl=''
```

With a release named `streamarr` and the chart named `streamarr`, the fullname helper collapses to `streamarr`, so the objects created are `streamarr-api` and `streamarr-worker` (Deployments, Services, HPAs), `streamarr-worker` (PDB), `streamarr-config` (ConfigMap) and `streamarr` (ServiceAccount).

## Step 6 — Verify the rollout

```bash
kubectl -n streamarr rollout status deployment/streamarr-api
kubectl -n streamarr rollout status deployment/streamarr-worker

kubectl -n streamarr get pods -l app.kubernetes.io/name=streamarr -o wide
kubectl -n streamarr get svc,hpa,pdb
```

Then check the API answers from inside the cluster:

```bash
kubectl -n streamarr port-forward svc/streamarr-api 8484:80

# in another shell
curl -fsS http://127.0.0.1:8484/healthz
curl -fsS http://127.0.0.1:8484/readyz
curl -fsS http://127.0.0.1:8484/api/system/version
```

`/readyz` returns 200 only once the API's HTTP listener is bound, which happens after the pool has connected and migrations have applied; it returns 503 before that. Confirm the pods really are running the roles you expect:

```bash
kubectl -n streamarr get deploy streamarr-api \
  -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="STREAMARR_ROLE")].value}{"\n"}'
kubectl -n streamarr get deploy streamarr-worker \
  -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="STREAMARR_ROLE")].value}{"\n"}'
```

On a completely empty database the API bootstraps a single admin account and logs its generated password exactly once, at WARN level. Capture it now — it is never shown again:

```bash
kubectl -n streamarr logs deployment/streamarr-api | grep 'bootstrap admin'
```

Set `STREAMARR_BOOTSTRAP_ADMIN_USERNAME` and `STREAMARR_BOOTSTRAP_ADMIN_PASSWORD` in `config:` beforehand if you would rather choose them yourself — though a password in a ConfigMap is visible to anyone who can read the namespace.

Common failure signatures:

| Symptom | Cause |
| --- | --- |
| Pods in `CreateContainerConfigError` | The Secret named by `secret.name` does not exist, or is missing the `DATABASE_URL` or `REDIS_URL` key. |
| `CrashLoopBackOff` with a config error in the logs | `DATABASE_URL` unset or empty; the process exits before telemetry even starts. |
| API pods Ready, worker pods never Ready | The `/readyz` probe on worker pods — see below. |
| `helm install --wait` times out with no events | Almost always the missing Secret. |

## Scaling each role independently

This is the whole reason to run Tier 3. The two Deployments have separate HPAs, separate resource envelopes and separate scheduling constraints:

```bash
# Temporarily override the autoscaler bounds
helm upgrade streamarr infra/kubernetes/helm/streamarr \
  --namespace streamarr -f my-values.yaml \
  --set api.autoscaling.maxReplicas=10 \
  --set worker.autoscaling.maxReplicas=16

kubectl -n streamarr get hpa -w
```

To pin a fixed replica count instead, disable the relevant autoscaler and set the count:

```bash
helm upgrade streamarr infra/kubernetes/helm/streamarr \
  --namespace streamarr -f my-values.yaml \
  --set worker.autoscaling.enabled=false \
  --set worker.replicaCount=4
```

Give the worker pool its own nodes with `worker.nodeSelector`, `worker.tolerations` and `worker.affinity` — transcoding is CPU-hungry and you rarely want it competing with API latency on the same machines. The worker PodDisruptionBudget (`minAvailable: 1` by default) keeps node drains and cluster upgrades from taking every worker offline at once.

## Storage: media and state

This is the part the chart does not do for you, and the part to plan before you install.

**What the chart mounts today:** one `emptyDir` at `/tmp` per pod, and nothing else. It creates no PersistentVolumeClaim, references no `storageClassName`, and mounts no media volume. There is no object-storage backend of any kind in Streamarr; every cache is a local directory.

That leaves three storage concerns for you to satisfy:

| What | Where it lives | Access mode | Notes |
| --- | --- | --- | --- |
| Your media files | Wherever your library already is — NFS, CephFS, SMB, or a CSI volume | `ReadWriteMany` if more than one pod must read it | Both roles need it: the API serves direct-play and HLS from it, the worker reads it for background work. |
| Artwork, thumbnail and subtitle caches | `STREAMARR_ARTWORK_CACHE_DIR`, `STREAMARR_THUMBNAIL_CACHE_DIR`, `STREAMARR_SUBTITLE_CACHE_DIR` | `ReadWriteMany` to share; otherwise each pod caches separately | **Set these explicitly.** `STREAMARR_ARTWORK_CACHE_DIR` also roots the thumbnail cache (under an `episode-thumbnails/` subdirectory) unless `STREAMARR_THUMBNAIL_CACHE_DIR` overrides it. |
| On-demand transcode segments | A `streamarr-transcode` directory inside the process temp directory — `/tmp/streamarr-transcode` unless `TMPDIR` says otherwise | Per pod | No Streamarr-specific variable exposes this path. It lands in the `emptyDir` at `/tmp`, which by default consumes node ephemeral storage. Size your nodes accordingly, or replace the volume. |

> **Do not leave the cache paths unset on a PostgreSQL deployment.** With no `DATABASE_URL` that looks like SQLite, the artwork cache falls back to the process temp directory, but the **thumbnail and subtitle caches fall back to the process working directory** — `/app` in the published image. Under the chart's `securityContext.readOnlyRootFilesystem: true`, that path is not writable, so those two caches fail to write rather than quietly filling an `emptyDir`. Point all three at a writable mount.

Because the chart sets `securityContext.readOnlyRootFilesystem: true` and runs pods as uid `10001`, every writable path must be an explicitly mounted volume whose permissions allow that uid. The chart's `podSecurityContext.fsGroup: 10001` handles that for volumes that honour `fsGroup`. The Kustomize base sets **no** `securityContext` or `podSecurityContext` at all, so on that route the container filesystem is writable and the pod runs as whatever the image declares (uid `10001`) — the same hardening, if you want it, is yours to add.

Neither the chart's `values.yaml` nor the Kustomize base exposes a value for extra volumes, so adding media and cache mounts means one of:

- editing `infra/kubernetes/base/deployment-api.yaml` and `deployment-worker.yaml` directly, if you are on the Kustomize route (this is the simpler option);
- adding a strategic-merge patch in your own Kustomize overlay that layers the volumes onto the rendered manifests;
- forking the chart's Deployment templates, or rendering it through a post-renderer such as `helm template … | kustomize build`.

If your library manager reports paths under a different root from the one the pods see, map them with the two path-substitution variables — **both** must be set or the substitution is skipped entirely:

```yaml
config:
  STREAMARR_MEDIA_REMOTE_ROOT: "/media"
  STREAMARR_MEDIA_LOCAL_ROOT: "/mnt/library"
```

> **Not built yet: hardware-accelerated transcoding.** There is no VAAPI, NVENC, QSV, CUDA or VideoToolbox support in the backend, and no `/dev/dri` passthrough, NVIDIA runtime or GPU resource request anywhere in the Kubernetes manifests. Transcoding uses a software encoder. Budget CPU, not GPU, when sizing the worker pool.

## Ingress and TLS

**Neither path ships an Ingress or Gateway API resource.** Ingress class, TLS issuer and hostname are all cluster-specific, so fronting the `streamarr-api` Service is left to you. A minimal ingress-nginx plus cert-manager example you write yourself:

```yaml
# streamarr-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: streamarr
  namespace: streamarr
  annotations:
    cert-manager.io/cluster-issuer: <YOUR-CLUSTER-ISSUER>
    nginx.ingress.kubernetes.io/proxy-body-size: "0"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - <YOUR-SERVER-HOSTNAME>
      secretName: streamarr-tls
  rules:
    - host: <YOUR-SERVER-HOSTNAME>
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: streamarr-api
                port:
                  number: 80
```

```bash
kubectl apply -f streamarr-ingress.yaml
```

Route only the `http` port (`80` on the Service, targeting container port `8484`). **Do not expose port `9090`** — `/metrics` is unauthenticated and belongs on the internal network only, scraped by Prometheus.

The generous read timeout matters: HLS playback and long-lived streaming responses will be cut off by a default 60-second proxy timeout. Adjust the equivalent annotation for whichever controller you run.

The binary can also terminate TLS itself, via static certificate paths or built-in ACME, but no chart value wires either up, and the ACME cache directory would need a persistent volume the chart does not provide. Terminating at the ingress is the practical route here.

## Known rough edges

These follow directly from the manifests and the backend source. None has been observed on a live cluster, because none has been run on one.

**Worker pods are unlikely to report Ready.** In `worker`-only mode the binary serves a minimal HTTP listener with just `GET /healthz`. The chart's readiness probe targets `/readyz`, which that listener does not serve, so the probe should receive a 404 and never pass. Two workarounds:

```bash
# Simplest: point readiness at /healthz for both Deployments.
# Trade-off: the API loses genuine readiness gating during startup.
helm upgrade streamarr infra/kubernetes/helm/streamarr \
  --namespace streamarr -f my-values.yaml \
  --set probes.readinessPath=/healthz
```

On the Kustomize route you can be more precise and change the readiness path in `base/deployment-worker.yaml` alone, leaving the API's `/readyz` probe intact. Verify whichever you choose:

```bash
kubectl -n streamarr get pods -l app.kubernetes.io/component=worker
kubectl -n streamarr describe pod -l app.kubernetes.io/component=worker | grep -A3 Readiness
```

**Set `STREAMARR_JWT_SECRET` or sign-ins will break across replicas.** If it is unset, or shorter than 32 bytes, each process generates a fresh boot-lifetime secret. With two or more API replicas that means a token minted by one pod is rejected by the next, and every restart signs everyone out. The chart's Secret only carries `DATABASE_URL` and `REDIS_URL`, and there is no `envFrom` for a Secret, so the two honest options are to put it in `config:` (a ConfigMap, which is not a secure home for a signing key) or to patch an `envFrom.secretRef` onto both Deployments:

```bash
openssl rand -hex 32   # 64 characters, comfortably over the 32-byte minimum
```

**Splitting roles disables one transcode promotion path.** The in-process channel that promotes a live on-demand transcode into a durable background-produced rendition only works when a single process runs both roles (`STREAMARR_ROLE=all`). In a split `api` / `worker` deployment the send fails closed. Ordinary background dispatch is unaffected.

**On-demand transcode sessions are not node-affine.** A playback session that started on one API pod dies with that pod. Keep `terminationGracePeriodSeconds` and `preStopSleepSeconds` at their defaults so rolling updates drain gracefully.

**The default image repository is a placeholder.** `ghcr.io/streamarr/streamarr` appears in `values.yaml` and in `base/kustomization.yaml`; the repository's own README calls it a placeholder. Always set your own.

## The Kustomize route

For teams that would rather not have a Helm release object in-cluster. It is deliberately minimal: **no HorizontalPodAutoscaler, no PodDisruptionBudget, no ServiceMonitor.** If you need those, use the chart.

```
infra/kubernetes/
  base/
    kustomization.yaml     # commonLabels, resource list, images[] tag pin
    deployment-api.yaml    # STREAMARR_ROLE=api, 2 replicas
    deployment-worker.yaml # STREAMARR_ROLE=worker, 2 replicas
    service.yaml           # ClusterIP for api, headless ClusterIP for worker
    configmap.yaml         # STREAMARR_LOG / *_BIND_ADDR
    secret.yaml            # placeholder with empty stringData
  overlays/
    dev/                   # namespace streamarr-dev, 1 replica each, STREAMARR_LOG=debug
    staging/               # namespace streamarr-staging, 2 replicas each, STREAMARR_LOG=info
    prod/                  # namespace streamarr-prod, 3 replicas each, STREAMARR_LOG=warn
```

Render, inspect, apply. Applying the overlay as it stands ships `base/secret.yaml`'s **empty** `DATABASE_URL`, which makes every pod exit at startup, so overwrite the Secret straight after applying — or replace it with a `secretGenerator` first, as under point 1 below:

```bash
kustomize build infra/kubernetes/base | less
kustomize build infra/kubernetes/overlays/dev | less

kubectl create namespace streamarr-dev
kustomize build infra/kubernetes/overlays/dev | kubectl apply -f -

# The applied Secret is the empty placeholder — give it real values.
kubectl -n streamarr-dev create secret generic streamarr-secrets \
  --from-literal=DATABASE_URL='postgres://streamarr:<YOUR-DB-PASSWORD>@postgres.databases.svc:5432/streamarr' \
  --from-literal=REDIS_URL='' \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n streamarr-dev rollout restart deployment/streamarr-api deployment/streamarr-worker
kubectl -n streamarr-dev rollout status deployment/streamarr-api
```

The Kustomize base sets no image pull secret either, so if your registry is private, add an `imagePullSecrets` patch in your overlay before the pods can pull at all.

Two things to change before this touches anything real:

1. **Replace the placeholder Secret.** `base/secret.yaml` ships with empty `stringData` purely so `kustomize build base` produces a complete, applyable manifest set. Never apply it as-is to staging or production. Either point a `secretGenerator` at an untracked env file, or drop the resource and let Sealed Secrets or External Secrets Operator own the real object:

   ```yaml
   # overlays/prod/kustomization.yaml
   secretGenerator:
     - name: streamarr-secrets
       behavior: replace
       envs:
         - streamarr-secrets.prod.env   # untracked, gitignored
   ```

2. **Set the image.** Update `images[].name` and `images[].newTag` in `base/kustomization.yaml`, or override per overlay:

   ```yaml
   images:
     - name: ghcr.io/streamarr/streamarr
       newName: <YOUR-REGISTRY>/streamarr
       newTag: "<YOUR-TAG>"
   ```

Each overlay sets its namespace, patches both Deployments' replica counts, and merges a `STREAMARR_LOG` override into the ConfigMap — so adding your own config keys, volumes or probe changes is a `configMapGenerator` merge or a strategic-merge patch in the overlay.

## Upgrading

Kubernetes is the one tier where Streamarr never updates itself, by design. Nothing in the repository reaches out to a registry, patches its own workload through the Kubernetes API, or otherwise self-updates from inside the cluster — and nothing should.

The ordinary upgrade is a values change plus a `helm upgrade`:

```bash
# Bump image.tag in my-values.yaml, then:
helm upgrade streamarr infra/kubernetes/helm/streamarr \
  --namespace streamarr -f my-values.yaml

kubectl -n streamarr rollout status deployment/streamarr-api
kubectl -n streamarr rollout status deployment/streamarr-worker
```

Migrations run automatically as pods start, exactly as on the other tiers. Roll back with `helm rollback streamarr <REVISION>` or `kubectl -n streamarr rollout undo deployment/streamarr-api` — but note that a rollback moves the application back, not the database schema, so treat migrations as forward-only.

For GitOps, `infra/kubernetes/flux-image-automation.example.yaml` documents the sanctioned automation path: an `ImageRepository` watching the registry, an `ImagePolicy` selecting the highest tag matching a semver range, and an `ImageUpdateAutomation` committing the resulting tag bump back into your Git repository — ideally to a side branch behind a pull request. It is a heavily commented **example only**, not wired into any live Flux `Kustomization` or `HelmRelease`, and neither `values.yaml` nor `base/kustomization.yaml` carries the `# {"$imagepolicy": …}` marker comment by default. Adding it is a deliberate, per-environment opt-in, because it changes what is allowed to author commits against that file.

## Uninstalling

```bash
helm uninstall streamarr --namespace streamarr
kubectl delete namespace streamarr
```

The Secret you created out-of-band is deleted with the namespace; your PostgreSQL database is not, and neither are any volumes you provisioned yourself.

## Next steps

With a healthy rollout and the bootstrap admin password in hand, sign in to Streamarr Admin — at your ingress hostname if you built an image that serves it at `/` (see the note under "How the roles map onto Deployments"), otherwise wherever you host it — to set the instance display name, register the library-management applications you already run, and invite the people in your household.

> The bootstrap admin account is created with `can_stream: false`: it exists to run the admin surface, not as a viewing account. Create a separate account for ordinary playback.
