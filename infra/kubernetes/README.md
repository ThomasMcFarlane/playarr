# infra/kubernetes

Three independent ways to deploy Playarr Server to Kubernetes. Pick one per
cluster/environment - they are not meant to be layered on top of each
other.

1. **`helm/playarr-standalone/`** - one `PLAYARR_ROLE=all` Pod for adopting an
   existing SQLite instance in place. It supports a retained local volume,
   fixed-node scheduling and optional Emissary routing without moving data.
2. **`helm/playarr/`** - a real Helm chart. This is the more complete,
   more opinionated path (autoscaling, PDB, optional Prometheus
   ServiceMonitor) and is the recommended default for new multi-node installs.
3. **`base/` + `overlays/{dev,staging,prod}/`** - a plain kustomize
   skeleton, for teams that don't want a Helm release object in-cluster or
   that already standardise on kustomize elsewhere. Deliberately kept
   minimal (no HPA/PDB/ServiceMonitor yet) - see "kustomize skeleton" below
   for what's out of scope today.

The separate **`helm/vidaa-installer/`** chart is an optional companion, not a
third Playarr Server deployment path. It supplies the app-owned DNS policy and
Emissary route needed for an experimental VIDAA launcher installation on a
cluster that already runs the permanent LAN resolver. It is inert by default;
see its [operator guide](./helm/vidaa-installer/README.md).

The multi-node Helm and Kustomize paths deploy the same two workloads:

- **`playarr-api`** - a Deployment running the `playarr` binary with
  `PLAYARR_ROLE=api`, fronted by a ClusterIP Service.
- **`playarr-worker`** - a separate Deployment running the same binary
  with `PLAYARR_ROLE=worker`, with its own PodDisruptionBudget (Helm
  path) so voluntary disruptions (node drains, cluster upgrades) never take
  every worker offline at once.

Both roles expose the same two ports from the same binary:

| Port | Purpose |
|------|---------|
| `8484` (`http`) | Application traffic (api) / probe-only (worker) - see `probes.port` |
| `9090` (`metrics`) | Prometheus `/metrics` |

And the same two probe paths:

| Path | Used by |
|------|---------|
| `/healthz` | `livenessProbe` |
| `/readyz` | `readinessProbe` |

These four values (ports + paths) are assumptions made while scaffolding
this chart, not something read from the actual `playarr` binary's source.
If the real API/worker binary uses different ports or probe paths, update
`values.yaml`'s `probes.*` / `config.*` (Helm) or the hardcoded values in
`base/*.yaml` (kustomize) - both paths were built to make that a small,
localized edit.

## Helm chart (`helm/playarr/`)

```
helm/playarr/
  Chart.yaml            # name=playarr, appVersion tracks the app release
  values.yaml            # image.tag is pinned to Chart.yaml's appVersion -
                          # never "latest"; see "Image tags" below
  templates/
    _helpers.tpl          # name/label/selector helpers
    deployment-api.yaml    # PLAYARR_ROLE=api
    deployment-worker.yaml # PLAYARR_ROLE=worker
    hpa-api.yaml            # HorizontalPodAutoscaler for the api Deployment
    hpa-worker.yaml         # HorizontalPodAutoscaler for the worker Deployment
    service.yaml             # ClusterIP Service for api + a headless
                              # ClusterIP Service for worker (metrics/probe
                              # routing only - worker takes no ingress traffic)
    pdb-worker.yaml          # PodDisruptionBudget for the worker Deployment
    configmap.yaml            # non-secret config (values.config)
    secret.yaml                # opt-in Secret placeholder for
                                # DATABASE_URL/REDIS_URL (see below)
    serviceaccount.yaml         # ServiceAccount (values.serviceAccount.create)
    servicemonitor.yaml          # optional, values.serviceMonitor.enabled
    NOTES.txt                     # `helm install` post-install summary
```

### Image tags

`values.yaml`'s `image.tag` is set to the same value as `Chart.yaml`'s
`appVersion` (`0.1.0` in this scaffold) and the Deployment templates render
it as `image.tag | default .Chart.AppVersion` - so even an empty
`image.tag` falls back to a real pinned version, never to `latest`. Bumping
the deployed version means bumping both `Chart.yaml appVersion` and
`values.yaml image.tag` together (in a PR, or automated - see
[`flux-image-automation.example.yaml`](./flux-image-automation.example.yaml)).

### Secrets: DATABASE_URL / REDIS_URL

Both Deployments read `DATABASE_URL` and `REDIS_URL` from a Secret named by
`secret.name` (defaults to `<release-fullname>-secrets`) via
`secretKeyRef` - they are never accepted as plain env vars or ConfigMap
entries.

- `secret.create: false` (the default) - the chart assumes that Secret
  already exists in the target namespace, provisioned out-of-band (External
  Secrets Operator, Sealed Secrets, Vault, or a manually-run
  `kubectl create secret generic <name> --from-literal=DATABASE_URL=... \
  --from-literal=REDIS_URL=...`). Pods will sit in `CreateContainerConfigError`
  until that Secret exists - `helm install --wait` will time out, which is
  intentional (fail loud, not silently start with an empty DB URL).
- `secret.create: true` - the chart renders the Secret itself from
  `secret.data.databaseUrl` / `secret.data.redisUrl`. Intended for local/dev
  use only (e.g. `helm install --set secret.create=true --set
  secret.data.databaseUrl=... --set secret.data.redisUrl=...`); do not put
  real credentials in a values file that lands in git.

### Autoscaling, PDB, ServiceMonitor

- `api.autoscaling` / `worker.autoscaling` (both `enabled: true` by
  default) render a `HorizontalPodAutoscaler` each, targeting CPU
  utilization by default. `worker`'s HPA carries a commented example of
  wiring in an `External` queue-depth metric (KEDA / Prometheus Adapter)
  once one is installed - CPU-only autoscaling is a reasonable default but
  not ideal for a job-queue worker.
- `worker.podDisruptionBudget.enabled: true` renders a PDB with
  `minAvailable: 1` by default.
- `serviceMonitor.enabled: false` by default. Set to `true` on clusters
  running kube-prometheus-stack (or any Prometheus Operator install) to get
  a `ServiceMonitor` scraping both the api and worker `metrics` Service
  ports. Requires the `monitoring.coreos.com/v1` CRDs to already be
  installed - the template does not check for them, so enabling this on a
  cluster without the Operator will fail `helm install`/`upgrade`.

### Validating locally

This was validated with `helm lint` and `helm template` (multiple value
combinations - defaults, autoscaling disabled, `secret.create=true` +
`serviceMonitor.enabled=true`) during scaffolding. It was **not** validated
against a live cluster (`helm install`, `kubectl apply --dry-run=server`)
as part of this scaffold - do that before trusting it in a real
environment:

```sh
helm lint helm/playarr
helm template playarr helm/playarr | less
helm install playarr helm/playarr --dry-run --debug
```

## Kustomize skeleton (`base/` + `overlays/`)

```
base/
  kustomization.yaml
  deployment-api.yaml
  deployment-worker.yaml
  service.yaml
  configmap.yaml
  secret.yaml           # placeholder, empty stringData - see comments in-file
overlays/
  dev/kustomization.yaml       # namespace=playarr-dev, replicas=1
  staging/kustomization.yaml   # namespace=playarr-staging, replicas=2
  prod/kustomization.yaml      # namespace=playarr-prod, replicas=3
```

Deliberately minimal, per the brief: no HorizontalPodAutoscaler,
PodDisruptionBudget, or ServiceMonitor equivalents yet (the Helm chart is
the fuller-featured path). If this path becomes the primary one, port
those three templates over as either static manifests in `base/` or a
`components/autoscaling` kustomize component overlays opt into.

`base/secret.yaml` ships with empty `stringData` purely so `kustomize
build` produces a complete, applyable manifest set out of the box. Every
overlay has a comment block explaining how to replace it for real use
(`secretGenerator` from an untracked env file, or delegate the Secret
entirely to Sealed Secrets / External Secrets Operator) - **do not** apply
`base/secret.yaml`'s placeholder as-is against staging/prod.

Validated locally with `kustomize build` against `base` and all three
overlays during scaffolding; not validated against a live cluster.

```sh
kustomize build base | less
kustomize build overlays/dev | less
kustomize build overlays/staging | less
kustomize build overlays/prod | less
```

## GitOps image auto-update: the sanctioned path

[`flux-image-automation.example.yaml`](./flux-image-automation.example.yaml)
is a heavily-commented **example, not wired into any live Flux
Kustomization/HelmRelease**. It documents the only sanctioned way image
tags get bumped in a real deployment of this chart/skeleton: Flux's
`image-reflector-controller` + `image-automation-controller` watch the
registry, resolve a new tag against a semver `ImagePolicy`, and commit the
bump back into this git repo (ideally onto a side branch behind a PR) -
Flux's normal Kustomization/HelmRelease reconciliation then applies that
commit exactly like a human-authored change.

**There is no in-cluster self-update mechanism anywhere in this chart or
skeleton, and there must never be one.** No Deployment, controller, or
running Playarr Server process patches its own image, reaches the Kubernetes API
to mutate its own workload, or otherwise updates itself from inside the
cluster. Every version bump is a git commit, reviewed and audited like any
other change.

## Known gaps / assumptions made while scaffolding

- **Ports and probe paths** (`8484`/`9090`, `/healthz`/`/readyz`) are
  assumptions, not read from the real `playarr` binary - see the table
  above.
- **Image repository** (`ghcr.io/playarr/playarr`) is a placeholder;
  update `values.yaml` / `base/deployment-*.yaml` /
  `base/kustomization.yaml`'s `images.name` together if the real registry
  differs.
- No `Ingress`/`Gateway API` resource is included in either path - fronting
  the api Service with an ingress controller / gateway is left to the
  cluster operator, since ingress class, TLS issuer, and hostname are all
  cluster-specific.
- No live-cluster validation was performed (no `helm install`, no
  `kubectl apply`) - only local rendering/linting (`helm lint`, `helm
  template`, `kustomize build`), deliberately, to avoid touching any real
  infrastructure from this scaffolding task.
