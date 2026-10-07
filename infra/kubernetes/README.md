# infra/kubernetes

Three independent ways to deploy Playarr Server to Kubernetes. Pick one per
cluster/environment - they are not meant to be layered on top of each
other.

1. **`helm/playarr-standalone/`** - one `PLAYARR_ROLE=all` Pod for adopting an
   existing SQLite instance in place. It supports a retained local volume,
   fixed-node scheduling and optional Emissary routing without moving data.
2. **`helm/playarr/`** - a real Helm chart: a single-replica StatefulSet with a
   PersistentVolumeClaim for the SQLite database, a Service and an optional
   Prometheus ServiceMonitor. The recommended default for new installs.
3. **`base/` + `overlays/{dev,staging,prod}/`** - a plain kustomize
   skeleton, for teams that don't want a Helm release object in-cluster or
   that already standardise on kustomize elsewhere. Deliberately kept
   minimal (no ServiceMonitor yet) - see "kustomize skeleton" below
   for what's out of scope today.

The separate **`helm/vidaa-installer/`** chart is an optional companion, not a
third Playarr Server deployment path. It supplies the app-owned DNS policy and
Emissary route needed for an experimental VIDAA launcher installation on a
cluster that already runs the permanent LAN resolver. It is inert by default;
see its [operator guide](./helm/vidaa-installer/README.md).

Playarr is SQLite-only ([ADR 0002](../../docs/architecture/adr/0002-sqlite-only-storage.md)).
The Helm and Kustomize paths deploy one workload:

- **`playarr`** - a StatefulSet with one replica running the `playarr` binary
  with `PLAYARR_ROLE=all` (API and background workers in one process), its
  SQLite database on a PersistentVolumeClaim mounted at `/data`, fronted by a
  ClusterIP Service. SQLite does not support several pods writing one
  database, so the replica count is fixed at 1. A multi-node deployment is
  several independent installs (one per node or cluster), each with its own
  database, that synchronise through peer sync.

The binary exposes two ports:

| Port | Purpose |
|------|---------|
| `8484` (`http`) | Application traffic and probes - see `probes.port` |
| `9090` (`metrics`) | Prometheus `/metrics` |

And the same two probe paths:

| Path | Used by |
|------|---------|
| `/healthz` | `livenessProbe` |
| `/readyz` | `readinessProbe` |

These four values (ports + paths) match the real binary: `8484` and `9090`
are the defaults of `PLAYARR_HTTP_BIND_ADDR` and `PLAYARR_METRICS_BIND_ADDR`,
and `/healthz` and `/readyz` are served by the API router. If you change the
bind addresses, update `values.yaml`'s `probes.*` / `config.*` (Helm) or the
hardcoded values in `base/*.yaml` (kustomize) together.

## Helm chart (`helm/playarr/`)

```
helm/playarr/
  Chart.yaml            # name=playarr, appVersion tracks the app release
  values.yaml            # image.tag is pinned to Chart.yaml's appVersion -
                          # never "latest"; see "Image tags" below
  templates/
    _helpers.tpl          # name/label/selector helpers
    statefulset.yaml        # PLAYARR_ROLE=all, SQLite on a PVC, 1 replica
    service.yaml             # ClusterIP Service (http + metrics)
    configmap.yaml            # non-secret config (values.config)
    serviceaccount.yaml         # ServiceAccount (values.serviceAccount.create)
    servicemonitor.yaml          # optional, values.serviceMonitor.enabled
    NOTES.txt                     # `helm install` post-install summary
```

### Image tags

`values.yaml`'s `image.tag` is set to the same value as `Chart.yaml`'s
`appVersion` (`0.1.0` in this scaffold) and the StatefulSet template renders
it as `image.tag | default .Chart.AppVersion` - so even an empty
`image.tag` falls back to a real pinned version, never to `latest`. Bumping
the deployed version means bumping both `Chart.yaml appVersion` and
`values.yaml image.tag` together (in a PR, or automated - see
[`flux-image-automation.example.yaml`](./flux-image-automation.example.yaml)).

### Storage

`DATABASE_URL` is not a value: the chart sets `sqlite://<persistence.mountPath>/playarr.db`
and mounts a PersistentVolumeClaim (`persistence.size`,
`persistence.storageClassName`) there. A `postgres://` URL is rejected by the
server at startup. Do not copy the live database file out from under a running
server. The chart does not enable the server's backup feature (age-encrypted
archives, see `docs/architecture/server-backups.md`): it stays off until you
set `PLAYARR_BACKUP_DIR` and `PLAYARR_BACKUP_RECIPIENTS` through `config`.
Point `PLAYARR_BACKUP_DIR` at a path on the PVC (for example `/data/backups`) or
another volume; a backup on the same PVC does not survive losing the volume, so
download archives from the Admin page or configure the optional
`PLAYARR_BACKUP_S3_*` replica. Restore is an offline CLI action, run with the
server stopped.

### ServiceMonitor

`serviceMonitor.enabled: false` by default. Set to `true` on clusters
running kube-prometheus-stack (or any Prometheus Operator install) to get a
`ServiceMonitor` scraping the `metrics` Service port. Requires the
`monitoring.coreos.com/v1` CRDs to already be installed - the template does
not check for them, so enabling this on a cluster without the Operator will
fail `helm install`/`upgrade`.

### Validating locally

This was validated with `helm lint` and `helm template` (multiple value
combinations - defaults and `serviceMonitor.enabled=true`) during scaffolding. It was **not** validated
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
  statefulset.yaml      # PLAYARR_ROLE=all, SQLite on a PVC, 1 replica
  service.yaml
  configmap.yaml
overlays/
  dev/kustomization.yaml       # namespace=playarr-dev, PLAYARR_LOG=debug
  staging/kustomization.yaml   # namespace=playarr-staging, PLAYARR_LOG=info
  prod/kustomization.yaml      # namespace=playarr-prod, PLAYARR_LOG=warn
```

Deliberately minimal: no ServiceMonitor equivalent (the Helm chart is the
fuller-featured path). There is no database Secret: the database is a SQLite
file on the StatefulSet's PVC.

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
  update `values.yaml` / `base/statefulset.yaml` /
  `base/kustomization.yaml`'s `images.name` together if the real registry
  differs.
- No `Ingress`/`Gateway API` resource is included in either path - fronting
  the Service with an ingress controller / gateway is left to the
  cluster operator, since ingress class, TLS issuer, and hostname are all
  cluster-specific.
- No live-cluster validation was performed (no `helm install`, no
  `kubectl apply`) - only local rendering/linting (`helm lint`, `helm
  template`, `kustomize build`), deliberately, to avoid touching any real
  infrastructure from this scaffolding task.
